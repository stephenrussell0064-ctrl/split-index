-- Structured interval/fartlek work-piece scoring.
--
-- A logged "Interval" or "Fartlek" session previously scored off the whole-
-- session average pace, same as a steady run — diluting the hard work reps
-- down toward an easy effort. These columns let the log form optionally
-- capture the work/rest (or on/off) breakdown so cardio-activity.ts can
-- score off the work-piece pace instead (see cardio/interval-scoring.ts).
-- All nullable — omitting them falls back to the original whole-session-
-- average behaviour exactly as before.

-- `session_type` is a Postgres enum (see 001_initial_schema.sql); adding a
-- value must run outside a transaction block, so this statement should be
-- run on its own if your migration runner wraps files in a transaction.
ALTER TYPE session_type ADD VALUE IF NOT EXISTS 'fartlek';

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS interval_reps INTEGER CHECK (interval_reps > 0),
  ADD COLUMN IF NOT EXISTS interval_work_distance_meters NUMERIC(8,1) CHECK (interval_work_distance_meters > 0),
  ADD COLUMN IF NOT EXISTS interval_work_seconds NUMERIC(7,1) CHECK (interval_work_seconds > 0),
  ADD COLUMN IF NOT EXISTS interval_rest_seconds NUMERIC(7,1) CHECK (interval_rest_seconds >= 0),
  ADD COLUMN IF NOT EXISTS interval_work_avg_hr INTEGER CHECK (interval_work_avg_hr >= 40 AND interval_work_avg_hr <= 230),
  ADD COLUMN IF NOT EXISTS fartlek_on_distance_meters NUMERIC(8,1) CHECK (fartlek_on_distance_meters > 0),
  ADD COLUMN IF NOT EXISTS fartlek_on_seconds NUMERIC(7,1) CHECK (fartlek_on_seconds > 0),
  ADD COLUMN IF NOT EXISTS fartlek_on_avg_hr INTEGER CHECK (fartlek_on_avg_hr >= 40 AND fartlek_on_avg_hr <= 230);
