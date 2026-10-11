-- 091: `public_profiles` and `leaderboard_profiles` stop reading auth.users.
--
-- NUMBERING. 091 because 090 is the highest version on any branch or tag in
-- this repo (origin/main carries 090_logging_effort_views), checked with the
-- loop in the header of 085. This file was first drafted as 090 on 11 Oct
-- 2026; a concurrent session landed and applied its own 090 the same morning,
-- so this one was renumbered BEFORE its ledger row was written. The ledger
-- records it as 091.
--
-- WHAT THE SUPABASE EMAIL IS ABOUT
-- --------------------------------
-- The Security Advisor (dashboard → Advisors → Security) reports 12 errors.
-- Two are CRITICAL, lint `auth_users_exposed`:
--
--   Exposed Auth Users   public.public_profiles
--   Exposed Auth Users   public.leaderboard_profiles
--
-- Both views `JOIN auth.users u ON u.id = p.user_id` so they can require
-- `u.email_confirmed_at IS NOT NULL` (061: an unverified account may not appear
-- in public). Both run `security_invoker = off`, so the join executes as the
-- view's owner, which CAN read auth.users — and the lint flags any view in a
-- PostgREST-exposed schema whose definition depends on auth.users and is
-- granted to anon or authenticated. It does not read the column list. It is
-- right to be nervous: one careless `CREATE OR REPLACE` adding `u.email` to
-- either view would publish every address through the anon key.
--
-- Today neither view EMITS an auth.users column — the join is a filter only.
-- So nothing is leaking. But the design is one edit away from leaking, and the
-- advisor email will keep arriving until the dependency is gone.
--
-- THE FIX
-- -------
-- Carry the one fact the views need — "has this account confirmed its
-- address" — on `profiles` itself, kept current by the auth trigger that
-- already exists (007/081) plus one new trigger for the confirmation UPDATE.
-- Then rebuild both views to read `p.email_confirmed_at` and never touch the
-- auth schema. This is the remediation Supabase's own docs give for this lint.
--
-- The other ten errors are `security_definer_view`, one per projection view.
-- They are NOT fixed here and should not be: every view in this schema is
-- `security_invoker = off` on purpose — 056 explains why, 085 restates it, and
-- `src/lib/social/public-projections.test.ts` fails the build if it changes.
-- Flipping it on would empty every leaderboard. See the AFTERWARDS section.
--
-- WHY A COLUMN AND NOT A SECURITY DEFINER FUNCTION
-- ------------------------------------------------
-- A `private.email_confirmed(uuid)` helper would satisfy the lint too, but
-- 061 rejected a user-id-taking confirmation function as an enumeration
-- oracle, and a function the views call per row is still a read of
-- auth.users on every leaderboard query. A column on `profiles` is a plain
-- fact the app already owns a copy of, costs nothing to read, and the view
-- genuinely no longer depends on auth.* at all.
--
-- WHY `CREATE OR REPLACE` AND NOT `DROP ... CASCADE`
-- -------------------------------------------------
-- 064 dropped `public_profiles` with CASCADE. Four other views (061/071:
-- public_strength_scores, public_workout_scores, public_index_history,
-- public_leaderboard_entries) have `EXISTS (SELECT 1 FROM public_profiles ...)`
-- in their WHERE, so CASCADE would drop them too and they would need
-- rebuilding here. The column lists of both views are UNCHANGED by this
-- migration, which is the one case where CREATE OR REPLACE VIEW is allowed,
-- and it leaves dependents, grants and reloptions in place.
--
-- RE-RUNNABLE. ADD COLUMN IF NOT EXISTS, CREATE OR REPLACE, idempotent
-- backfill, DROP TRIGGER IF EXISTS. Safe to run twice.

BEGIN;

-- ─── 1. The fact, on the table that already owns the rest of the profile ────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_confirmed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.profiles.email_confirmed_at IS
  'Mirror of auth.users.email_confirmed_at, kept current by handle_new_user() '
  'at signup and sync_profile_email_confirmed() on confirmation. Exists so the '
  'public projection views can gate on verification without depending on the '
  'auth schema (Supabase lint auth_users_exposed). Never written by the app.';

-- Owner-only RLS on profiles already covers it: an athlete can read their own
-- confirmation timestamp, which they already know. It is NOT added to any
-- projection view's column list — the views use it in WHERE only.

-- ─── 2. Backfill from the source of truth, once ─────────────────────────────
UPDATE public.profiles p
   SET email_confirmed_at = u.email_confirmed_at
  FROM auth.users u
 WHERE u.id = p.user_id
   AND p.email_confirmed_at IS DISTINCT FROM u.email_confirmed_at;

-- ─── 3. Keep it current ─────────────────────────────────────────────────────
-- 3a. At signup. Reproduced from 081 with one extra column; everything else
--     — the NULLIF/TRIM on the provider name, the '@' guard, ON CONFLICT —
--     is carried through unchanged. Admin-created and auto-confirmed accounts
--     arrive with email_confirmed_at already set, so it has to be copied here
--     and not only on UPDATE.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provided_name TEXT;
BEGIN
  provided_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');

  IF provided_name IS NOT NULL AND provided_name LIKE '%@%' THEN
    provided_name := NULL;
  END IF;

  INSERT INTO public.profiles (user_id, display_name, email_confirmed_at)
  VALUES (NEW.id, provided_name, NEW.email_confirmed_at)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- 3b. At confirmation. GoTrue sets email_confirmed_at with an UPDATE on
--     auth.users when the six-digit OTP is accepted. The WHEN clause below is
--     what limits this to confirmation: GoTrue also UPDATEs auth.users on
--     every sign-in (last_sign_in_at), and `UPDATE OF <column>` alone fires
--     whenever the column is in the SET list, changed or not.
--
--     The EXCEPTION block is deliberate. A trigger on auth.users runs inside
--     GoTrue's transaction; if it raises, the athlete's confirmation FAILS and
--     they cannot sign in. A stale mirror (fixable by re-running part 2) is a
--     much smaller failure than that, so the error is logged and swallowed.
CREATE OR REPLACE FUNCTION public.sync_profile_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
     SET email_confirmed_at = NEW.email_confirmed_at
   WHERE user_id = NEW.id
     AND email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'sync_profile_email_confirmed: % (user %)', SQLERRM, NEW.id;
  RETURN NEW;
END;
$$;

ALTER FUNCTION public.sync_profile_email_confirmed() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.sync_profile_email_confirmed() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_email_confirmed() TO postgres, service_role;

COMMENT ON FUNCTION public.sync_profile_email_confirmed() IS
  'Mirrors auth.users.email_confirmed_at onto profiles.email_confirmed_at so the '
  'public projection views can gate on verification without reading auth.users. '
  'Swallows errors on purpose: a failure here must never block a confirmation.';

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS DISTINCT FROM NEW.email_confirmed_at)
  EXECUTE FUNCTION public.sync_profile_email_confirmed();

-- ─── 4. The views, without the auth schema ──────────────────────────────────
-- Column lists are byte-for-byte those of 064 (the current definitions; 081
-- did not rebuild the views). Only the FROM/WHERE differ: the auth.users join
-- is gone and the verified-email gate reads the mirrored column instead. The
-- '@' guard on display_name from 064 is carried through unchanged.

CREATE OR REPLACE VIEW public_profiles (
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
WHERE p.username IS NOT NULL
  AND p.email_confirmed_at IS NOT NULL;

ALTER VIEW public_profiles SET (security_invoker = off);
GRANT SELECT ON public_profiles TO anon, authenticated;

CREATE OR REPLACE VIEW leaderboard_profiles (
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
  CASE
    WHEN eff.age BETWEEN 18 AND 29 THEN '18-29'
    WHEN eff.age BETWEEN 30 AND 39 THEN '30-39'
    WHEN eff.age BETWEEN 40 AND 49 THEN '40-49'
    WHEN eff.age >= 50            THEN '50+'
    ELSE NULL
  END,
  CASE
    WHEN p.weight_kg IS NULL   THEN NULL
    WHEN p.weight_kg < 70      THEN 'light'
    WHEN p.weight_kg < 85      THEN 'middle'
    WHEN p.weight_kg < 100     THEN 'heavy'
    ELSE 'super'
  END,
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
  CASE
    WHEN p.weight_kg IS NULL THEN NULL
    WHEN p.weight_kg < 50    THEN 'Under 50kg'
    ELSE (50 + FLOOR((p.weight_kg - 50) / 10) * 10)::INT::TEXT
         || '-'
         || (60 + FLOOR((p.weight_kg - 50) / 10) * 10)::INT::TEXT
         || 'kg'
  END,
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
WHERE p.username IS NOT NULL
  AND p.email_confirmed_at IS NOT NULL;

ALTER VIEW leaderboard_profiles SET (security_invoker = off);
REVOKE ALL ON leaderboard_profiles FROM anon;
GRANT SELECT ON leaderboard_profiles TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- AFTERWARDS
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The mirror must agree with auth.users for every profile. Want 0:
--
--   SELECT count(*)
--   FROM public.profiles p
--   JOIN auth.users u ON u.id = p.user_id
--   WHERE p.email_confirmed_at IS DISTINCT FROM u.email_confirmed_at;
--
-- 2. No view in public may mention the auth schema any more. Want 0 rows:
--
--   SELECT viewname FROM pg_views
--   WHERE schemaname = 'public' AND definition ILIKE '%auth.users%';
--
-- 3. The views return exactly what they did before. Run both BEFORE applying,
--    note the numbers, and run again after — they must not move:
--
--   SELECT count(*) FROM public_profiles;
--   SELECT count(*) FROM leaderboard_profiles;
--
-- 4. The grants did not move. Want true, false, true:
--
--   SELECT has_table_privilege('anon',          'public.public_profiles',      'SELECT');
--   SELECT has_table_privilege('anon',          'public.leaderboard_profiles', 'SELECT');
--   SELECT has_table_privilege('authenticated', 'public.leaderboard_profiles', 'SELECT');
--
-- 5. In the dashboard, Advisors → Security → "Rerun linter". The two
--    `Exposed Auth Users` rows go. The ten `Security Definer View` rows stay,
--    and that is the correct state for this schema: see 056. If the advisor
--    email keeps coming for those ten alone, the remaining options are to
--    accept it, or to open a Supabase support ticket asking for the lint to be
--    muted on this project — there is no per-item ignore in the dashboard as
--    of October 2026.
--
-- 6. Record a row in docs/pre-launch/migration-reconciliation.md §1. A
--    migration is not done until it has a ledger row.
