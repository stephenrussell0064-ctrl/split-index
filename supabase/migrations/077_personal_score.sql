-- Numbered 077 on purpose, not 064.
--
-- Production follows main's migration sequence, where 064 is already applied
-- as 064_display_name_is_never_an_email.sql. Supabase records applied
-- migrations by that leading version number, so a file reusing 064 is read as
-- already-done and skipped in silence — this schema would never be created,
-- and the failure would surface as a missing column at runtime rather than as
-- a failed push. 076-078 is free on every branch and tag in the repo.
--
-- Do not renumber this down to follow this branch's own 062. That sequence is
-- itself a renumbering of migrations already applied to production under
-- different numbers, which the submission runbook defers to after approval.

-- Two scores per session: against the population, and against yourself.
--
-- `sport_index` has always been the population score — this session measured
-- against the sport's calibrated standards for someone of this athlete's sex
-- and age. It keeps that meaning exactly, and every index, roll-up and
-- leaderboard that reads it is untouched.
--
-- `personal_index` is the new one: the same session measured against the
-- recency-weighted median of the athlete's OWN recent sessions in that sport,
-- at a comparable heart rate. 500 means "your normal", above is a better day
-- than usual, below is a worse one. See lib/scoring/personal-score.ts.
--
-- Why a column rather than a key inside score_breakdown, where the engine
-- also writes it: the logbook, the feed and the Lab render a list of sessions
-- and need both numbers per row. Reading them out of a JSONB blob means
-- fetching every session's full breakdown — the cardio result, the strength
-- results, the index snapshot — to display two integers.
--
-- NULL is a real and expected value, not missing data: an athlete with fewer
-- than three comparable sessions in the trailing 90 days has nothing honest
-- to be compared against, and the UI says "calibrating" rather than inventing
-- a number. Rows written before this migration are also NULL; a recompute
-- (POST /api/activities/recompute, or scripts/recompute-all-users.ts) fills
-- them in.

ALTER TABLE workout_scores
  ADD COLUMN IF NOT EXISTS personal_index INTEGER
    CHECK (personal_index IS NULL OR (personal_index >= 0 AND personal_index <= 999));

COMMENT ON COLUMN workout_scores.personal_index IS
  'Session scored against this athlete''s own recent same-sport history at a comparable heart rate; 500 = their norm. NULL while calibrating (fewer than 3 comparable sessions).';

-- Per-lift personal scores, so the Lab can show a lift against its own
-- history the way a run is shown against its own history.
ALTER TABLE strength_scores
  ADD COLUMN IF NOT EXISTS personal_index INTEGER
    CHECK (personal_index IS NULL OR (personal_index >= 0 AND personal_index <= 999));

COMMENT ON COLUMN strength_scores.personal_index IS
  'This lift scored against the athlete''s own recent sessions of the same lift; 500 = their norm. NULL while calibrating.';
