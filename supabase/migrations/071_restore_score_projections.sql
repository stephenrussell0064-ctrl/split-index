-- 071: Recreate the four score projections that 064 dropped with CASCADE.
--
-- Numbered 070 when written and renumbered on the way in: a peer session
-- landed its own 070 the same afternoon. If you already ran the file when it
-- was called 070, this is the same SQL and re-running it is a no-op.
--
-- WHAT HAPPENED
-- -------------
-- 064 rebuilt public_profiles to stop display_name publishing an email
-- address, and opened with:
--
--   DROP VIEW IF EXISTS public_profiles CASCADE;
--
-- CASCADE was needed — the two profile views are depended on — and it does
-- exactly what it says. public_strength_scores, public_workout_scores,
-- public_index_history and public_leaderboard_entries all carry
-- `WHERE EXISTS (SELECT 1 FROM public_profiles pp ...)`, so all four were
-- dropped with it. 064 recreated the two views it was rewriting and not the
-- four it took down on the way, and nothing said so: CASCADE reports what it
-- drops as a NOTICE, and the migration applied cleanly.
--
-- Confirmed against production before writing this, rather than reasoned
-- about: all four answer PGRST205 "Could not find the table", while
-- public_profiles and leaderboard_profiles answer 200.
--
-- The effect is the whole social surface. The feed, both leaderboards, the
-- dimension leaderboards and the index-history comparison all read these four
-- and nothing else provides them.
--
-- WHY THIS IS A COPY OF 061 AND NOT A REWRITE
-- -------------------------------------------
-- These definitions were correct. Nothing about them was part of the
-- display_name change, and they were never meant to be touched. So this
-- restores them verbatim from 061 — extracted from the file rather than
-- retyped — and the diff against 061 is empty by construction. A "while I am
-- here" improvement to a view during an outage fix is how the next one starts.
--
-- The email-verification gate they enforce is inherited rather than repeated:
-- each derives from public_profiles, which 064 rebuilt WITH the
-- `email_confirmed_at IS NOT NULL` join intact. That was the point of deriving
-- rather than restating the rule in six places, and it is why this recreation
-- cannot silently drop the gate.
--
-- SAFE TO RUN TWICE. Every statement is DROP IF EXISTS then CREATE, and the
-- grants are REVOKE-then-GRANT.

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

-- Grants are restated because DROP VIEW discards them. Same set as 061: none of
-- these four is readable by anon. public_profiles is the only view anon may
-- read, and that has not changed.

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
