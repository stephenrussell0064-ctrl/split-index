-- Follow-up to migration 031 — user feedback: "There is also no options in
-- settings to make profile public for the feeds, i also want to make this
-- public on default for friends and people can turn it private if they
-- wish." Safe to run whether or not 031 was already applied:
--  - If 031 hasn't run yet: this is a no-op (031, already updated to
--    DEFAULT true, creates the column correctly on its own).
--  - If 031 already ran with its original DEFAULT false: this flips the
--    column default for future rows AND backfills every existing profile
--    that's still sitting on the old false default to true — this is
--    meant to change the experience for people who already exist, not
--    just new signups from here on.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS share_activities_with_friends BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE profiles
  ALTER COLUMN share_activities_with_friends SET DEFAULT true;

UPDATE profiles
SET share_activities_with_friends = true
WHERE share_activities_with_friends = false;
