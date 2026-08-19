-- Manual overrides for the values the engine proposes.
--
-- The intake shows a 1RM derived from logged sets, and a max/resting heart
-- rate taken from the profile, as read-only facts. They are estimates: the
-- adaptive 1RM is inferred from submaximal work, and an estimated max HR is
-- age-derived arithmetic that is wrong for most individuals by a wide margin.
-- An athlete who knows better — who has actually tested a single, or worn a
-- strap through a maximal effort — had no way to say so, and the plan was
-- built on the estimate anyway.
--
-- Nullable throughout, and null means "use what the engine proposed". The
-- override is stored separately from the derived value rather than writing
-- back over it, so the proposal stays visible next to the correction and a
-- stale override can be cleared back to the live estimate.

ALTER TABLE hpe_intake
  ADD COLUMN IF NOT EXISTS squat_1rm_override NUMERIC,
  ADD COLUMN IF NOT EXISTS bench_1rm_override NUMERIC,
  ADD COLUMN IF NOT EXISTS deadlift_1rm_override NUMERIC,
  ADD COLUMN IF NOT EXISTS max_hr_override INTEGER,
  ADD COLUMN IF NOT EXISTS resting_hr_override INTEGER;

-- Ranges that catch a typo without arguing with a genuine outlier. A 500kg
-- squat and a 20bpm resting heart rate are both real for somebody; 5000kg and
-- 0bpm are a slipped decimal point.
ALTER TABLE hpe_intake
  ADD CONSTRAINT hpe_intake_1rm_override_range CHECK (
    (squat_1rm_override IS NULL OR squat_1rm_override BETWEEN 1 AND 600)
    AND (bench_1rm_override IS NULL OR bench_1rm_override BETWEEN 1 AND 600)
    AND (deadlift_1rm_override IS NULL OR deadlift_1rm_override BETWEEN 1 AND 600)
  ),
  ADD CONSTRAINT hpe_intake_hr_override_range CHECK (
    (max_hr_override IS NULL OR max_hr_override BETWEEN 100 AND 230)
    AND (resting_hr_override IS NULL OR resting_hr_override BETWEEN 25 AND 120)
  );
