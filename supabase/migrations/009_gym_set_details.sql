-- Per-set weight/reps customization: an exercise's sets are rarely uniform
-- (e.g. a ramping or pyramid scheme), so store the full per-set breakdown.
-- Additive/nullable — existing rows and any code not yet updated keep working
-- off the flat weight_kg/sets/reps/rpe columns, which are now a "best set"
-- summary (weight_kg/reps/rpe of the heaviest-estimated-1RM set, sets = count)
-- kept in sync by the API for backward compatibility.
ALTER TABLE gym_exercises
  ADD COLUMN IF NOT EXISTS set_details JSONB;

COMMENT ON COLUMN gym_exercises.set_details IS
  'Per-set breakdown: array of {weight_kg, reps, rpe}. When present, takes precedence over the flat weight_kg/sets/reps/rpe columns, which are kept as a best-set summary for backward compatibility.';
