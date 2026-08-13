-- Hybrid Plan Engine — intake changes, so the plan stops gating on questions
-- an athlete may reasonably not be able to answer.
--
-- Four product decisions, each of which needed a column:
--
--  1. An event date is no longer required. An athlete without a race still
--     deserves a plan, so they can pick a block length instead — or let the
--     engine choose one.
--  2. Strength targets are asked per lift rather than as a total. Asking for a
--     total makes an athlete do arithmetic on three numbers they may not all
--     know, and makes the whole answer unavailable if one is missing.
--  3. Availability is per-day and may vary week to week. Real clock times
--     differ by day, and the six-hour separation rule between hard sessions is
--     computed from them.
--  4. Gym access is the question, not barbell access. Someone training at home
--     needs a different plan, not a barbell plan they cannot perform.

ALTER TABLE hpe_intake
  -- 1. Horizon without an event date.
  ADD COLUMN IF NOT EXISTS plan_timeframe_weeks SMALLINT
    CHECK (plan_timeframe_weeks IS NULL OR plan_timeframe_weeks BETWEEN 4 AND 52),

  -- 2. Per-lift targets. Each independently nullable: a partial answer is
  --    still an answer, and the engine derives the total from whatever is
  --    given rather than requiring all three.
  ADD COLUMN IF NOT EXISTS target_squat_kg NUMERIC(6, 2) CHECK (target_squat_kg IS NULL OR target_squat_kg > 0),
  ADD COLUMN IF NOT EXISTS target_bench_kg NUMERIC(6, 2) CHECK (target_bench_kg IS NULL OR target_bench_kg > 0),
  ADD COLUMN IF NOT EXISTS target_deadlift_kg NUMERIC(6, 2) CHECK (target_deadlift_kg IS NULL OR target_deadlift_kg > 0),

  -- 3. Per-day windows: [{day, available, start_hour, end_hour, two_sessions}].
  --    JSONB rather than columns because it is read and written whole, and the
  --    shape belongs to hpe/intake.ts rather than to this schema.
  ADD COLUMN IF NOT EXISTS day_windows JSONB NOT NULL DEFAULT '[]'::jsonb,
  --    True when the week genuinely varies. The scheduler then produces a
  --    prioritised session list rather than fixing sessions to days — a
  --    fixed Tuesday/Thursday plan that gets ignored every second week is
  --    worse than an ordered list the athlete can place themselves.
  ADD COLUMN IF NOT EXISTS availability_varies BOOLEAN NOT NULL DEFAULT FALSE,

  -- 4. Gym access. Defaults TRUE so existing rows keep the behaviour they were
  --    generated under; a migration should not silently strip the barbell out
  --    of plans people are already following.
  ADD COLUMN IF NOT EXISTS has_gym_access BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN hpe_intake.plan_timeframe_weeks IS
  'Chosen block length when there is no event date. NULL means let the engine suggest one.';
COMMENT ON COLUMN hpe_intake.day_windows IS
  'Per-day training windows. Real clock times differ by day and the 6h separation rule is computed from them.';
COMMENT ON COLUMN hpe_intake.has_gym_access IS
  'The primary strength question. Barbell availability is a detail inside this, not a substitute for it.';
