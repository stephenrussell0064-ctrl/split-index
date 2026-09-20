-- Numbered 076 on purpose, not 063.
--
-- Production follows main's migration sequence, where 063 is already applied
-- as 063_security_events.sql. Supabase records applied
-- migrations by that leading version number, so a file reusing 063 is read as
-- already-done and skipped in silence — this schema would never be created,
-- and the failure would surface as a missing column at runtime rather than as
-- a failed push. 076-078 is free on every branch and tag in the repo.
--
-- Do not renumber this down to follow this branch's own 062. That sequence is
-- itself a renumbering of migrations already applied to production under
-- different numbers, which the submission runbook defers to after approval.

-- Hybrid Plan Engine — block continuity (constants 3.0.0).
--
-- Every visit to the plan screen used to regenerate the whole block from
-- week one and anchor it to that Monday, so the athlete was permanently in
-- week one: the deload "at week 4", the ramp, the quality progression and
-- the phase ladder were re-projected forward from today and never arrived.
--
-- A plan now records the Monday its week one began on, the goal it was built
-- for, and the week it was last (re)generated from. The route serves the
-- current block positioned at the current week, and regenerates only the
-- remaining weeks — carrying the lived ones through — when the diagnostic,
-- the goal or the calendar week has moved.
--
-- The extra session columns let a stored week be carried over into a
-- continued plan with everything the scheduler and the feasibility model
-- read: intensity, the heavy-lower flag, the lift, the hard sets per lift.

ALTER TABLE hpe_plans
  ADD COLUMN IF NOT EXISTS starts_on DATE,
  ADD COLUMN IF NOT EXISTS goal_hash TEXT,
  ADD COLUMN IF NOT EXISTS generated_for_week SMALLINT NOT NULL DEFAULT 1,
  -- Per-week metadata the sessions alone cannot carry: notes, allocation,
  -- stress, ACWR, delivered dose. Keyed by week number.
  ADD COLUMN IF NOT EXISTS week_meta JSONB NOT NULL DEFAULT '{}';

-- Existing rows were anchored to their generation week; keep that reading.
UPDATE hpe_plans SET starts_on = (generated_at AT TIME ZONE 'UTC')::date WHERE starts_on IS NULL;

ALTER TABLE hpe_sessions
  ADD COLUMN IF NOT EXISTS label TEXT,
  ADD COLUMN IF NOT EXISTS lift TEXT,
  ADD COLUMN IF NOT EXISTS intensity NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS is_heavy_lower BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_deadlift BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS stress NUMERIC(8, 2),
  ADD COLUMN IF NOT EXISTS lift_sets JSONB,
  ADD COLUMN IF NOT EXISTS prescription_notes JSONB;

CREATE INDEX IF NOT EXISTS idx_hpe_plans_user_current
  ON hpe_plans (user_id, generated_at DESC)
  WHERE superseded_at IS NULL;
