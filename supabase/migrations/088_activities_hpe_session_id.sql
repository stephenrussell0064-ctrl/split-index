-- 088: a logged activity can name the Hybrid Plan session it is the record of.
--
-- NUMBERING. 088 because 087 is the highest version on any branch or tag in
-- this repo, checked when this file was written (the rule 085's header sets
-- out), via:
--   git log --all --diff-filter=A --name-only --format= -- supabase/migrations | sort -u | tail -1
--
-- WHY
-- ---
-- Until now nothing linked an activity to a prescribed session. The plan knew
-- a session was done ONLY if the athlete tapped the three-button feedback
-- control; the gym log and the plan were two records of the same hour that
-- never met. Logging-effort plan, phase 2, makes the prescription the default
-- payload of the gym form (one tap logs it, edits only for what differed), and
-- the link is what lets the plan screen say "logged" instead of asking again,
-- lets api/activities record the feedback row for the athlete, and gives the
-- engine a labelled data point per set rather than a yes/no per session.
--
-- ADDITIVE AND NULLABLE. Every activity logged by hand, by GPS, or before this
-- migration has NULL here and nothing reads NULL as anything but "not from a
-- prescription". The API only sends the column when a prescribed session is
-- being logged, so a database that has not applied this file still saves every
-- other session unchanged.
--
-- ON DELETE SET NULL, not CASCADE. A regenerated plan supersedes its sessions
-- but does not delete them (hpe_plans.superseded_at); if a session row ever
-- does go, the athlete's logged training must not go with it. The activity is
-- the primary record; the link is a refinement on it.
--
-- REVERT. This column is the only schema change in phase 2. To undo:
--   ALTER TABLE activities DROP COLUMN IF EXISTS hpe_session_id;
-- Nothing else depends on it; the metadata key `prescribed_sets` written by
-- the same feature lives in the existing JSONB column and needs no DDL to
-- remove.

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS hpe_session_id UUID REFERENCES hpe_sessions(id) ON DELETE SET NULL;

-- The plan screen asks "which of these sessions has an activity?" for one
-- athlete's current block — a partial index keeps every hand-logged row out
-- of it.
CREATE INDEX IF NOT EXISTS idx_activities_hpe_session
  ON activities(hpe_session_id)
  WHERE hpe_session_id IS NOT NULL;

COMMENT ON COLUMN activities.hpe_session_id IS
  'The hpe_sessions row this activity was logged from, when it was logged from a Hybrid Plan prescription. NULL for every other session. Migration 088.';
