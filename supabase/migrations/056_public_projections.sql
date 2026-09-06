-- WP1 — take the underlying rows off the public leaderboard.
--
-- WHAT WAS WRONG
-- --------------
-- Six policies returned whole user-owned rows to the `anon` role. Every one of
-- them was written to make a public leaderboard work, and every one is
-- row-scoped but not column-scoped, because RLS has no column dimension:
--
--   profiles              USING (username IS NOT NULL)
--   strength_scores       USING (true)          -- migration 012
--   workout_scores        USING (true)          -- migration 001
--   split_index_history   USING (true)          -- migration 001
--   challenge_participants USING (true)         -- migration 001
--   leaderboard_entries   USING (true)          -- migration 002
--
-- None carries a TO clause, so they apply to `public`, which includes `anon`,
-- and nothing in the previous 55 migrations revokes anything from `anon`.
-- Supabase publishes PostgREST to the internet by design and ships the anon key
-- in the client bundle by design — both correct, and both meaning these
-- policies were the only thing standing between one athlete's data and
-- everyone. `GET /rest/v1/profiles?select=*` returned bodyweight, height, age,
-- sex, max heart rate and stripe_customer_id for every athlete with a username.
-- strength_scores added a named, timestamped per-set bodyweight series.
-- split_index_history added fatigue and recovery scores, which are special
-- category health data.
--
-- THE RULE THIS ESTABLISHES
-- -------------------------
-- A table with a user_id column is owner-only. Anything another athlete is
-- meant to see reaches them through a view that names its columns. A policy
-- can only ever answer "which rows"; naming the columns needs a view, and the
-- leaderboard only ever wanted columns.
--
-- src/lib/social/public-projections.test.ts fails the build if a policy on a
-- user-owned table stops mentioning auth.uid(), if a view grows one of the
-- columns listed there, or if the grants below drift.
--
-- WHY THE VIEWS ARE security_invoker = off
-- ----------------------------------------
-- Read this before changing it, because the obvious-looking hardening breaks
-- the product. These views deliberately read past the owner-only policies on
-- their base tables — that is how a leaderboard sees anybody but you. With
-- security_invoker = on they would re-apply the caller's RLS, every leaderboard
-- would return one row, and the failure would look like a data problem rather
-- than a configuration one.
--
-- So the view's own column list and WHERE clause ARE the security boundary
-- here, not RLS. That is a real trade and it is why the column lists below are
-- explicit at the top of each view rather than `SELECT *`: the boundary should
-- be legible in one place. It is set explicitly rather than left to the default
-- so that a Postgres upgrade, or a linter autofix that "helpfully" turns
-- security_invoker on, cannot silently change it.
--
-- WHAT IS DELIBERATELY LEFT ALONE
-- -------------------------------
-- `sports`, `reference_values`, `achievements` and `challenges` keep their
-- permissive SELECT policies. They hold scoring standards and definitions, no
-- user rows at all, and WP1.2 asks that deliberately public data be an explicit
-- permissive policy rather than RLS switched off. That is what they are.
--
-- The `FOR ALL USING (auth.uid() = user_id)` owner policies are also left as
-- they are, rather than split into four per-verb policies. Checked rather than
-- assumed: in Postgres a FOR ALL policy with a USING clause and no WITH CHECK
-- uses the USING expression as its WITH CHECK, so INSERT is constrained and an
-- UPDATE cannot move a row to another user_id. Splitting them would be four
-- times the surface for no change in behaviour.

-- ─── 1. Owner-only, everywhere ──────────────────────────────────────────────
-- Dropped before the views are created. The owner policies on each of these
-- tables predate this file and are untouched, so an athlete never loses access
-- to their own rows for even a statement:
--
--   profiles               "Users can view own profile"           (001)
--   strength_scores        "Users manage own strength scores"     (002)
--   workout_scores         "Users manage own scores"              (001)
--   split_index_history    "Users manage own index history"       (001)
--   challenge_participants "Users manage own challenge participation" (001)
--
-- leaderboard_entries has no owner policy and needs none: it is a derived
-- ranking table written by the cron under the service role and read through
-- public_leaderboard_entries below.

DROP POLICY IF EXISTS "Public profiles readable" ON profiles;
DROP POLICY IF EXISTS "Public leaderboard strength scores" ON strength_scores;
DROP POLICY IF EXISTS "Public leaderboard scores" ON workout_scores;
DROP POLICY IF EXISTS "Public leaderboard index" ON split_index_history;
DROP POLICY IF EXISTS "Public challenge progress" ON challenge_participants;
DROP POLICY IF EXISTS "Anyone can view leaderboards" ON leaderboard_entries;

-- ─── 2. public_profiles — the only projection the anon role can read ────────
-- The public profile page at /social/profile/[username] renders for logged-out
-- visitors, so exactly one view has to reach `anon`. This is it, and it is the
-- narrowest of the six.
--
-- injury_status is here on purpose and is not a contradiction of the Article 9
-- position. It is a two-value vocabulary the athlete sets themselves, in one
-- control that does nothing else, to explain a quiet training week to friends.
-- Nothing copies the Hybrid Plan's finer-grained injury input into it — see
-- src/lib/social/injury-status.ts and migration 053, which both state the same
-- rule. Self-chosen disclosure is a different thing from inferred health data.
--
-- Not here, all of which the anon role could read until this migration:
-- weight_kg, height_cm, age, date_of_birth, gender, max_hr, resting_hr,
-- stripe_customer_id, subscription_tier, subscription_status, timezone,
-- scoring_basis, experience, goals, training_history_years,
-- share_activities_with_friends, onboarding_completed.

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
-- Same row rule the dropped policy used, now gating twelve columns instead of
-- the whole table.
WHERE p.username IS NOT NULL;

ALTER VIEW public_profiles SET (security_invoker = off);

-- ─── 3. leaderboard_profiles — bracket keys as bands, never as values ───────
-- The leaderboard segments athletes two different ways, at two different
-- granularities, and both are represented here because both are real:
--
--   * age_bracket / weight_class — the COARSE scope filter behind the
--     leaderboard's own dropdowns. Mirrors AGE_BRACKETS and WEIGHT_CLASSES in
--     src/lib/social/constants.ts.
--   * age_band / weight_band — the FINE personal bracket ("Male · 25-34 ·
--     80-90kg") that resolveBracket widens until it finds enough peers.
--     Mirrors AGE_BANDS and weightBandFor in src/lib/social/leaderboard-brackets.ts.
--
-- The two do not nest — the coarse 30-39 straddles the fine 25-34 and 35-44 —
-- so neither can be derived from the other and both have to be projected.
--
-- Until now none of this was banded at all: the leaderboard read `age`,
-- `weight_kg` and `gender` off every profile and banded them in TypeScript,
-- which meant an exact bodyweight to one decimal place had to cross the wire
-- for all 500 fetched athletes in order to answer "how many peers am I near".
-- Banding in the view answers the same question without the number ever
-- leaving the database. It is also indexable, which the raw-value filter was
-- not.
--
-- The fine bands are the granularity the product already publishes — an
-- athlete is shown their own bracket as "Male · 25-34 · 80-90kg" — so this
-- projects no distinction the feature does not already make. It is strictly
-- coarser than what shipped before it.
--
-- These CASE expressions must agree exactly with the TypeScript that reads
-- them; src/lib/social/leaderboard-brackets.test.ts asserts the boundaries in
-- both places against each other so a change to one without the other fails
-- the build rather than silently misplacing people.
--
-- Age is derived from date_of_birth when it is set, falling back to the `age`
-- snapshot — the same precedence migration 016 established, so a band cannot
-- go stale the way a stored age does.

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

-- ─── 4. public_strength_scores — the By Exercise / By Muscle Group boards ───
-- bodyweight_kg is gone, and so is relative_strength, which is the part worth
-- pausing on: relative_strength is estimated_1rm_kg / bodyweight_kg, so
-- publishing it beside estimated_1rm_kg lets anyone divide and recover an exact
-- bodyweight. Removing the column and keeping the ratio would have looked like
-- a fix and been none.

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
-- Only rows belonging to an athlete who has a username, matching what the
-- leaderboard can display at all.
WHERE EXISTS (
  SELECT 1 FROM profiles p WHERE p.user_id = s.user_id AND p.username IS NOT NULL
);

ALTER VIEW public_strength_scores SET (security_invoker = off);

-- ─── 5. public_workout_scores — per-sport index, plus two JSON paths ────────
-- fetchLeaderboardDetail reads exactly two things out of score_breakdown: the
-- strength_activities array behind "top lifts", and cardio_activity.predictions
-- behind the race predictions. Projecting those two paths rather than the blob
-- means a future scoring change that writes bodyweight, heart rate or a
-- readiness figure into score_breakdown cannot leak through this view — which
-- was the thing that made the old workout_scores policy worse than the others.

DROP VIEW IF EXISTS public_workout_scores;
-- load_score, endurance_component and strength_component are here for the
-- friend duels, which aggregate an opponent's training load over the duel
-- window. All three are derived scores in the same family as sport_index —
-- no bodyweight, no heart rate, nothing that came off the athlete's body.

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
  -- The six the social feed surfaces on a post. Named individually rather than
  -- projecting `cardio_activity` wholesale: that object also carries internal
  -- flags and explanation strings that were never meant for another athlete's
  -- eyes, and a sub-object grows the same way the blob does.
  w.score_breakdown -> 'cardio_activity' -> 'vo2max',
  w.score_breakdown -> 'cardio_activity' -> 'executionScore',
  w.score_breakdown -> 'cardio_activity' -> 'decouplingPct',
  w.score_breakdown -> 'dots_score',
  w.score_breakdown -> 'gl_points',
  w.score_breakdown -> 'per_lift'
FROM workout_scores w
WHERE EXISTS (
  SELECT 1 FROM profiles p WHERE p.user_id = w.user_id AND p.username IS NOT NULL
);

ALTER VIEW public_workout_scores SET (security_invoker = off);

-- ─── 6. public_index_history — the four index columns and nothing else ──────
-- fatigue_score and recovery_score are gone. They characterise an athlete's
-- physical condition, which puts them in the special category tier, and no
-- caller has ever read them for anyone but their owner — the leaderboard and
-- the compare view both select the four index columns and the timestamp.

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
WHERE EXISTS (
  SELECT 1 FROM profiles p WHERE p.user_id = h.user_id AND p.username IS NOT NULL
);

ALTER VIEW public_index_history SET (security_invoker = off);

-- ─── 7. public_challenge_participation — a count, and nothing identifying ───
-- The only cross-athlete read of challenge_participants is "how many people
-- joined this challenge", so this view carries the challenge id and nothing
-- else. Not even user_id: a count does not need to say who.

DROP VIEW IF EXISTS public_challenge_participation;
CREATE VIEW public_challenge_participation (
  challenge_id
) AS
SELECT c.challenge_id
FROM challenge_participants c;

ALTER VIEW public_challenge_participation SET (security_invoker = off);

-- ─── 7b. public_leaderboard_entries — the precomputed ranking table ─────────
-- leaderboard_entries is derived: the cron writes it under the service role
-- from profiles, and it holds nothing but a user id, three index values and a
-- rank. Every column here is one the leaderboard displays anyway.
--
-- It still goes through a view rather than keeping a permissive policy, for
-- consistency rather than for any column in particular: the rule this
-- migration establishes is that a table with a user_id column is owner-only
-- and peers are reached through a named projection. A table exempted because
-- "its columns happen to be fine today" is a table nobody re-checks when a
-- column is added to it.

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
WHERE EXISTS (
  SELECT 1 FROM profiles p WHERE p.user_id = e.user_id AND p.username IS NOT NULL
);

ALTER VIEW public_leaderboard_entries SET (security_invoker = off);

-- ─── 8. Grants ──────────────────────────────────────────────────────────────
-- Explicit REVOKE before each GRANT. A view inherits nothing useful by
-- default, but stating it means the intended reader of each projection is
-- readable in one place rather than inferred from an absence.

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

REVOKE ALL ON public_challenge_participation FROM anon;
REVOKE ALL ON public_challenge_participation FROM authenticated;
GRANT SELECT ON public_challenge_participation TO authenticated;

REVOKE ALL ON public_leaderboard_entries FROM anon;
REVOKE ALL ON public_leaderboard_entries FROM authenticated;
GRANT SELECT ON public_leaderboard_entries TO authenticated;

-- ─── 9. Indexes for the bands ───────────────────────────────────────────────
-- The bracket filter moves from a TypeScript pass over 500 fetched rows to a
-- WHERE clause, so give it something to use. Partial on username IS NOT NULL
-- because that is the only population any of these views expose.

CREATE INDEX IF NOT EXISTS idx_profiles_bracket_split
  ON profiles (current_split_index DESC)
  WHERE username IS NOT NULL AND current_split_index IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_bracket_keys
  ON profiles (country, weight_kg, age)
  WHERE username IS NOT NULL;

COMMENT ON VIEW public_profiles IS
  'The only projection the anon role may read. Twelve columns of an athlete who '
  'has chosen a username. Replaces the "Public profiles readable" policy, which '
  'returned every column of the profiles row including bodyweight and '
  'stripe_customer_id. Do not add a column here without asking whether a logged-out '
  'stranger should have it.';

COMMENT ON VIEW leaderboard_profiles IS
  'Authenticated-only. Bracket keys as bands at both granularities the product uses '
  '(coarse age_bracket/weight_class for the scope dropdowns, fine age_band/weight_band '
  'for the personal bracket) so exact age, bodyweight and date of birth stay in the '
  'database. The two granularities do not nest, so neither can be derived from the '
  'other. sex is NULL rather than defaulted when unknown — a default files a real '
  'person into a competitive bracket they did not choose.';

COMMENT ON VIEW public_strength_scores IS
  'Authenticated-only. bodyweight_kg and relative_strength are both excluded: the '
  'ratio is 1RM/bodyweight, so exposing it beside estimated_1rm_kg would let anyone '
  'recover exact bodyweight by division.';

COMMENT ON VIEW public_workout_scores IS
  'Authenticated-only. Projects two named paths out of score_breakdown rather than '
  'the blob, so a future scoring change that writes bodyweight or heart rate into '
  'the breakdown cannot leak through this view.';

COMMENT ON VIEW public_index_history IS
  'Authenticated-only. The four index columns and the timestamp. fatigue_score and '
  'recovery_score are excluded as special category data.';

COMMENT ON VIEW public_challenge_participation IS
  'Authenticated-only. Challenge id alone, for participant counts. Deliberately '
  'carries no user_id — a count does not need to say who.';

COMMENT ON VIEW public_leaderboard_entries IS
  'Authenticated-only. The cron-built ranking table, projected for consistency with '
  'every other user_id-bearing table rather than because any column here is sensitive.';
