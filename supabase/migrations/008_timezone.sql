-- User timezone for correct local-day bucketing in trends and streaks.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT;

COMMENT ON COLUMN profiles.timezone IS
  'IANA timezone (e.g. Europe/London). Used for local-day workout grouping.';
