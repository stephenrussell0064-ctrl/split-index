-- WP13.3 — an unverified account may not log sessions or appear in public.
--
-- WHAT WAS WRONG
-- --------------
-- Nothing in the application ever read the verification state.
-- `grep -rn email_confirmed_at src/` returned matches only in a diagnostics
-- SQL file. The public projections added in 056 gate on `username IS NOT NULL`
-- and nothing else, so an account created with a throwaway address, never
-- confirmed, could pick a username and appear on a leaderboard. That is the
-- spam vector WP13.3 names, and it is also a way to occupy a username without
-- ever proving you can receive mail at the address you signed up with.
--
-- WHY RLS AND NOT AN API CHECK
-- ---------------------------
-- The obvious fix is a check in the activity POST handler, and it would not be
-- enforcement. `NEXT_PUBLIC_SUPABASE_ANON_KEY` is in the browser by design, so
-- anybody holding a valid session can POST straight to
-- `/rest/v1/activities` and never touch our route. The only place a rule about
-- writing rows actually binds is a policy on the table.
--
-- WHY A RESTRICTIVE POLICY
-- ------------------------
-- Postgres ORs permissive policies together, so adding a second permissive one
-- would WIDEN access rather than narrow it — a mistake that would look like
-- this migration and do the opposite of it. `AS RESTRICTIVE` is ANDed with
-- everything else, which is what "an additional requirement" means.
--
-- The existing "Users manage own activities" policy is untouched. This adds a
-- condition to INSERT and nothing else: an athlete who somehow becomes
-- unverified keeps reading, editing and deleting everything they already have.
-- Losing access to your own training history because of a mail-server problem
-- would be a far worse bug than the one being fixed.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RUN THIS BEFORE APPLYING, AND READ THE ANSWER
-- ─────────────────────────────────────────────────────────────────────────────
-- This migration is safe only if real accounts actually have
-- `email_confirmed_at` set. Split Index confirms by six-digit OTP — see the
-- signup flow and `email_not_confirmed` in lib/supabase/auth-errors.ts — so
-- they should. "Should" is not "do", and the cost of being wrong is every
-- athlete silently unable to log a session.
--
--   SELECT
--     count(*) FILTER (WHERE u.email_confirmed_at IS NOT NULL) AS verified,
--     count(*) FILTER (WHERE u.email_confirmed_at IS NULL)     AS unverified,
--     count(*) FILTER (WHERE u.email_confirmed_at IS NULL
--                        AND p.username IS NOT NULL)           AS unverified_on_leaderboard
--   FROM auth.users u
--   LEFT JOIN public.profiles p ON p.user_id = u.id;
--
-- A non-trivial `unverified` count means confirmation was off for some period
-- and those are real athletes. Backfill them before applying:
--
--   UPDATE auth.users SET email_confirmed_at = created_at
--    WHERE email_confirmed_at IS NULL AND created_at < '<the date confirmation was turned on>';
--
-- Do not backfill blindly. The point of this migration is that the unconfirmed
-- are unconfirmed.

-- ─── 1. Is the CALLER verified? ─────────────────────────────────────────────
-- Takes no argument and answers only about auth.uid(), for the same reason
-- activity_is_visible_to() was narrowed in migration 049 and
-- withdraw_article9_health_data() takes none in 057: a SECURITY DEFINER
-- function that accepts a user id is an oracle. `is_email_verified('<uuid>')`
-- would tell any authenticated caller whether an arbitrary account exists and
-- has confirmed its address, which is precisely the enumeration WP5 spent
-- effort closing on the sign-in path.
--
-- SECURITY DEFINER because `auth.users` is not readable by `authenticated`.

CREATE OR REPLACE FUNCTION public.caller_email_verified()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = auth.uid()
      AND u.email_confirmed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.caller_email_verified() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.caller_email_verified() TO authenticated;

COMMENT ON FUNCTION public.caller_email_verified() IS
  'True when the CALLING account has confirmed its email address. Takes no argument '
  'on purpose — a version accepting a user id would answer questions about other '
  'people''s accounts, which is an enumeration oracle.';

-- ─── 2. Logging a session requires a verified address ───────────────────────
-- INSERT only. RESTRICTIVE, so it is ANDed with the ownership policy rather
-- than ORed alongside it.

DROP POLICY IF EXISTS "Verified email required to log activities" ON activities;
CREATE POLICY "Verified email required to log activities" ON activities
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.caller_email_verified());

-- Same rule for the two tables a session is made of, so the requirement cannot
-- be side-stepped by writing the parts without the parent.
DROP POLICY IF EXISTS "Verified email required to log sets" ON gym_exercises;
CREATE POLICY "Verified email required to log sets" ON gym_exercises
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.caller_email_verified());

DROP POLICY IF EXISTS "Verified email required to score" ON workout_scores;
CREATE POLICY "Verified email required to score" ON workout_scores
  AS RESTRICTIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (public.caller_email_verified());

-- ─── 3. An unverified account does not appear in public ─────────────────────
-- The 056 projections are recreated with the verification predicate added.
-- They run `security_invoker = off`, so they read `auth.users` as the view
-- owner — which is why no helper function is needed here and why one taking a
-- user id would have been a mistake.
--
-- Every other column and rule is unchanged from 056. Re-stated in full rather
-- than patched, because `CREATE OR REPLACE VIEW` cannot change a column list
-- and a half-replaced projection is worse than either version.

DROP VIEW IF EXISTS public_profiles CASCADE;
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
  p.display_name,
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
JOIN auth.users u ON u.id = p.user_id
WHERE p.username IS NOT NULL
  AND u.email_confirmed_at IS NOT NULL;

ALTER VIEW public_profiles SET (security_invoker = off);

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
  p.display_name,
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
JOIN auth.users u ON u.id = p.user_id
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN p.date_of_birth IS NOT NULL
      THEN date_part('year', age(p.date_of_birth))::INT
    ELSE p.age
  END AS age
) eff
WHERE p.username IS NOT NULL
  AND u.email_confirmed_at IS NOT NULL;

ALTER VIEW leaderboard_profiles SET (security_invoker = off);

-- The score projections gate on the same population, so an unverified athlete
-- cannot appear on a By Exercise board either.
DROP VIEW IF EXISTS public_strength_scores;
CREATE VIEW public_strength_scores (
  user_id,
  exercise_name,
  muscle_group,
  estimated_1rm_kg,
  strength_index,
  recorded_at
) AS
SELECT
  s.user_id,
  s.exercise_name,
  s.muscle_group,
  s.estimated_1rm_kg,
  s.strength_index,
  s.recorded_at
FROM strength_scores s
WHERE EXISTS (SELECT 1 FROM public_profiles pp WHERE pp.user_id = s.user_id);

ALTER VIEW public_strength_scores SET (security_invoker = off);

DROP VIEW IF EXISTS public_workout_scores;
CREATE VIEW public_workout_scores (
  user_id,
  sport,
  sport_index,
  load_score,
  endurance_component,
  strength_component,
  created_at,
  activity_id,
  top_lifts,
  race_predictions,
  vo2max,
  execution_score,
  decoupling_pct,
  dots_score,
  gl_points,
  per_lift
) AS
SELECT
  w.user_id,
  w.sport,
  w.sport_index,
  w.load_score,
  w.endurance_component,
  w.strength_component,
  w.created_at,
  w.activity_id,
  w.score_breakdown -> 'strength_activities',
  w.score_breakdown -> 'cardio_activity' -> 'predictions',
  w.score_breakdown -> 'cardio_activity' -> 'vo2max',
  w.score_breakdown -> 'cardio_activity' -> 'executionScore',
  w.score_breakdown -> 'cardio_activity' -> 'decouplingPct',
  w.score_breakdown -> 'dots_score',
  w.score_breakdown -> 'gl_points',
  w.score_breakdown -> 'per_lift'
FROM workout_scores w
WHERE EXISTS (SELECT 1 FROM public_profiles pp WHERE pp.user_id = w.user_id);

ALTER VIEW public_workout_scores SET (security_invoker = off);

DROP VIEW IF EXISTS public_index_history;
CREATE VIEW public_index_history (
  user_id,
  split_index,
  endurance_index,
  strength_index,
  recorded_at
) AS
SELECT
  h.user_id,
  h.split_index,
  h.endurance_index,
  h.strength_index,
  h.recorded_at
FROM split_index_history h
WHERE EXISTS (SELECT 1 FROM public_profiles pp WHERE pp.user_id = h.user_id);

ALTER VIEW public_index_history SET (security_invoker = off);

DROP VIEW IF EXISTS public_leaderboard_entries;
CREATE VIEW public_leaderboard_entries (
  user_id,
  period,
  period_start,
  split_index,
  endurance_index,
  strength_index,
  rank,
  previous_rank
) AS
SELECT
  e.user_id,
  e.period,
  e.period_start,
  e.split_index,
  e.endurance_index,
  e.strength_index,
  e.rank,
  e.previous_rank
FROM leaderboard_entries e
WHERE EXISTS (SELECT 1 FROM public_profiles pp WHERE pp.user_id = e.user_id);

ALTER VIEW public_leaderboard_entries SET (security_invoker = off);

-- public_challenge_participation carries only a challenge id and no user id, so
-- there is nobody in it to be unverified. Dropped by the CASCADE above only if
-- it depended on public_profiles, which it does not — left alone deliberately.

-- ─── 4. Grants, restated ────────────────────────────────────────────────────
-- DROP VIEW discards them, so every recreated view needs its grant again. This
-- is the failure mode of recreating a view: the definition is obviously
-- different and the permissions silently reset to nothing.

REVOKE ALL ON public_profiles FROM anon, authenticated;
GRANT SELECT ON public_profiles TO anon, authenticated;

REVOKE ALL ON leaderboard_profiles FROM anon;
REVOKE ALL ON leaderboard_profiles FROM authenticated;
GRANT SELECT ON leaderboard_profiles TO authenticated;

REVOKE ALL ON public_strength_scores FROM anon;
REVOKE ALL ON public_strength_scores FROM authenticated;
GRANT SELECT ON public_strength_scores TO authenticated;

REVOKE ALL ON public_workout_scores FROM anon;
REVOKE ALL ON public_workout_scores FROM authenticated;
GRANT SELECT ON public_workout_scores TO authenticated;

REVOKE ALL ON public_index_history FROM anon;
REVOKE ALL ON public_index_history FROM authenticated;
GRANT SELECT ON public_index_history TO authenticated;

REVOKE ALL ON public_leaderboard_entries FROM anon;
REVOKE ALL ON public_leaderboard_entries FROM authenticated;
GRANT SELECT ON public_leaderboard_entries TO authenticated;

COMMENT ON VIEW public_profiles IS
  'The only projection the anon role may read. Twelve columns of an athlete who has '
  'chosen a username AND confirmed their email address. Do not add a column here '
  'without asking whether a logged-out stranger should have it.';
