-- Track last quality cardio effort for time-based prediction decay (Part E2).
ALTER TABLE predicted_benchmarks
  ADD COLUMN IF NOT EXISTS last_quality_at TIMESTAMPTZ;

-- Backfill: treat last update as last quality until replayed via recompute.
UPDATE predicted_benchmarks
SET last_quality_at = updated_at
WHERE last_quality_at IS NULL;
