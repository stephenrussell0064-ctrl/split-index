-- ─────────────────────────────────────────────────────────────────────────────
-- Athletes' email addresses are readable from the internet. Close it.
--
-- THE CHAIN. `handle_new_user()` (migration 007) fires on auth.users INSERT and
-- writes COALESCE(raw_user_meta_data->>'full_name', NEW.email) into
-- profiles.display_name. For every ordinary email/password signup the provider
-- supplies no name, so the fallback is the athlete's email address. Migration
-- 056 then put display_name into `public_profiles` and granted SELECT on it to
-- `anon` — and the anon key ships in the client bundle by design.
--
-- So: GET /rest/v1/public_profiles?select=username,display_name returns a list
-- of email addresses to anyone on the internet who reads one JS file.
-- `leaderboard_profiles` carries the same column to every authenticated user.
--
-- Commit 8623658 stopped onboarding writing the address and added a TypeScript
-- guard (publicDisplayName) at every render site. Neither reaches this:
-- PostgREST does not run TypeScript, and the trigger fires at signup, before
-- onboarding has run at all.
--
-- WHAT THIS MIGRATION DOES, AND DELIBERATELY DOES NOT DO.
--
-- It stops the trigger writing an address, and it stops both views emitting one
-- that is already stored. It does NOT rewrite a single existing row. Masking at
-- the view closes the exposure for the rows that already hold an address while
-- leaving the underlying value intact and recoverable — a destructive UPDATE
-- over production profiles is the owner's decision, not a migration's, and it
-- is not needed to make the data private.
--
-- A CHECK constraint would be the wrong tool: it would make the signup trigger's
-- INSERT fail, turning a privacy leak into a signup outage.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Stop the trigger writing an address ─────────────────────────────────
-- The provider-supplied name is still used when there is one. When there is
-- not, display_name stays NULL and every render site falls back to the username
-- the athlete chooses during onboarding, which is the name they picked to be
-- known by. Null is a better default than an address in any case: it is the
-- honest statement that they have not chosen a display name yet.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    NULLIF(TRIM(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), '')
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- ─── 2. Never publish an address that is already stored ─────────────────────
-- `LIKE '%@%'` rather than a full address pattern, on purpose. This is a filter
-- on what may be published, not a validator: the question is "could this be an
-- address", and anything containing an @ is answered yes and withheld. A real
-- display name containing an @ is vanishingly rare and loses nothing but the
-- fallback to their username.
--
-- Both views are rebuilt in full because Postgres cannot alter a view's column
-- expressions in place. Column lists, filters and security_invoker settings are
-- reproduced exactly as migration 056 defined them; only display_name changes.

DROP VIEW IF EXISTS public_profiles;
CREATE VIEW public_profiles (
  user_id,
  username,
  display_name,
  avatar_url,
  bio,
  country,
  preferred_sports,
  injury_status,
  created_at,
  current_split_index,
  current_endurance_index,
  current_strength_index
) AS
SELECT
  p.user_id,
  p.username,
  CASE WHEN p.display_name LIKE '%@%' THEN NULL ELSE p.display_name END,
  p.avatar_url,
  p.bio,
  p.country,
  COALESCE(p.preferred_sports, '{}'),
  p.injury_status,
  p.created_at,
  p.current_split_index,
  p.current_endurance_index,
  p.current_strength_index
FROM profiles p
-- Same row rule the dropped policy used, now gating twelve columns instead of
-- the whole table.
WHERE p.username IS NOT NULL;

ALTER VIEW public_profiles SET (security_invoker = off);
GRANT SELECT ON public_profiles TO anon, authenticated;

DROP VIEW IF EXISTS leaderboard_profiles;
CREATE VIEW leaderboard_profiles (
  user_id,
  username,
  display_name,
  avatar_url,
  country,
  injury_status,
  current_split_index,
  current_endurance_index,
  current_strength_index,
  age_bracket,
  weight_class,
  age_band,
  weight_band,
  sex
) AS
SELECT
  p.user_id,
  p.username,
  CASE WHEN p.display_name LIKE '%@%' THEN NULL ELSE p.display_name END,
  p.avatar_url,
  p.country,
  p.injury_status,
  p.current_split_index,
  p.current_endurance_index,
  p.current_strength_index,
  -- Coarse, mirrors AGE_BRACKETS. Under 18 has no bracket rather than being
  -- swept into the youngest one.
  CASE
    WHEN eff.age BETWEEN 18 AND 29 THEN '18-29'
    WHEN eff.age BETWEEN 30 AND 39 THEN '30-39'
    WHEN eff.age BETWEEN 40 AND 49 THEN '40-49'
    WHEN eff.age >= 50            THEN '50+'
    ELSE NULL
  END,
  -- Coarse, mirrors WEIGHT_CLASSES, which uses [min, max) — light is under 70,
  -- middle is 70 up to but not including 85.
  CASE
    WHEN p.weight_kg IS NULL   THEN NULL
    WHEN p.weight_kg < 70      THEN 'light'
    WHEN p.weight_kg < 85      THEN 'middle'
    WHEN p.weight_kg < 100     THEN 'heavy'
    ELSE 'super'
  END,
  -- Fine, mirrors AGE_BANDS labels exactly.
  CASE
    WHEN eff.age IS NULL       THEN NULL
    WHEN eff.age <= 19         THEN 'Under 20'
    WHEN eff.age <= 24         THEN '20-24'
    WHEN eff.age <= 34         THEN '25-34'
    WHEN eff.age <= 44         THEN '35-44'
    WHEN eff.age <= 54         THEN '45-54'
    WHEN eff.age <= 64         THEN '55-64'
    ELSE '65+'
  END,
  -- Fine, mirrors weightBandFor: a floor at 50kg, then 10kg bands labelled
  -- "min-maxkg". Cast through int so 80.0 renders as "80-90kg", not "80.0-90.0kg".
  CASE
    WHEN p.weight_kg IS NULL THEN NULL
    WHEN p.weight_kg < 50    THEN 'Under 50kg'
    ELSE (50 + FLOOR((p.weight_kg - 50) / 10) * 10)::INT::TEXT
         || '-'
         || (60 + FLOOR((p.weight_kg - 50) / 10) * 10)::INT::TEXT
         || 'kg'
  END,
  -- scoring_basis first (it is the answer to "which standards", which is what
  -- a bracket is asking), then gender where it happens to answer the same
  -- question. Deliberately NOT falling back to DEFAULT_SCORING_BASIS the way
  -- the scoring engine does: defaulting an unknown to 'male' is defensible when
  -- the alternative is refusing to score, and indefensible when it silently
  -- files a real person into a competitive bracket they never chose. NULL here
  -- means "no sex bracket", not "male".
  CASE
    WHEN COALESCE(p.scoring_basis, p.gender::TEXT) IN ('male', 'female')
      THEN COALESCE(p.scoring_basis, p.gender::TEXT)
    ELSE NULL
  END
FROM profiles p
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN p.date_of_birth IS NOT NULL
      THEN date_part('year', age(p.date_of_birth))::INT
    ELSE p.age
  END AS age
) eff
WHERE p.username IS NOT NULL;

ALTER VIEW leaderboard_profiles SET (security_invoker = off);
GRANT SELECT ON leaderboard_profiles TO authenticated;

-- ─── 3. What is left, and why it is not here ────────────────────────────────
-- The addresses are no longer published, but they are still stored. Whether to
-- erase them is the owner's call, not a migration's, so run this first to see
-- the scale:
--
--   SELECT count(*) FILTER (WHERE display_name LIKE '%@%')            AS holding_an_address,
--          count(*) FILTER (WHERE display_name LIKE '%@%'
--                             AND username IS NOT NULL)               AS were_publicly_readable,
--          count(*)                                                   AS profiles_total
--   FROM profiles;
--
-- and then, only if the owner decides to erase rather than merely withhold:
--
--   UPDATE profiles SET display_name = NULL WHERE display_name LIKE '%@%';
--
-- That is irreversible and unnecessary for privacy — after this migration the
-- value reaches no client through any granted view, and publicDisplayName in
-- src/lib/social/shareable-name.ts covers the paths that read the base table
-- directly. It is worth doing anyway if the position is that the app should not
-- hold the address in that column at all, which is a reasonable position.
