-- Capacitor-conversion brief, Part 3: background GPS run tracking feeds
-- the exact same activities table as manual entry — one more source, not a
-- separate system. is_partial_track is the load-bearing part: a session
-- where background tracking was interrupted (permission revoked, OS killed
-- the process under memory pressure, a gap in samples beyond what a normal
-- GPS dropout explains) must never be scored as if it were a complete,
-- clean effort — the exact class of "confidently wrong" bug already fixed
-- once in this project (the cardio monotonicity bug). This flag is how the
-- UI and scoring pipeline both know to treat it differently.
--
-- `activity_source` is a Postgres enum; adding a value must run outside a
-- transaction block if your migration runner wraps files in one (same rule
-- as 021_outdoor_cycling.sql's sport_type addition).
ALTER TYPE activity_source ADD VALUE IF NOT EXISTS 'gps';

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS is_partial_track BOOLEAN NOT NULL DEFAULT FALSE;
