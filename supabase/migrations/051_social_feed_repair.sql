-- Finish 031 on a database where it was never fully applied.
--
-- 031 created the reactions and comments tables, the visibility function, and
-- eight policies. Its tables use IF NOT EXISTS and its function uses CREATE OR
-- REPLACE, so those halves are replayable. Its eight CREATE POLICY statements
-- are not, and 049 legitimately re-creates the first of them —
-- "Friends view shared activities" on activities — because without it the
-- owner-only SELECT rule from 001 is the only rule and every friend-feed query
-- returns nothing under RLS.
--
-- So on a database that has had 049, re-running 031 aborts at its first policy
-- with 42710, and because the SQL editor runs the script in a transaction,
-- nothing else in the file lands either. The advice to "just run 031 as well"
-- could therefore never work. This migration is the repair: it reaches the
-- same end state as 031 from any starting point.
--
-- DROP ... IF EXISTS before each CREATE is what makes that true. The policy
-- bodies here are byte-identical to 031's and to 049's, so dropping and
-- re-creating changes no behaviour on a healthy database — it only removes the
-- dependence on what happens to be there already. Read it as "assert these
-- policies are exactly this", not as a change.

--
-- Locking.
--
-- DROP POLICY and ALTER TABLE both take ACCESS EXCLUSIVE locks. Run against a
-- live database, this file wants exclusive locks on four tables while the
-- running app holds share locks on the same ones, and the first attempt at it
-- deadlocked: the migration waited on `activities` while an app query waited
-- on a table the migration already held.
--
-- `lock_timeout` is the fix. Rather than queueing behind app traffic until two
-- waiters form a cycle, each statement gives up after five seconds and the
-- file rolls back cleanly — a fast, obvious failure you retry, instead of a
-- deadlock that kills whichever side Postgres happens to pick. Retrying in a
-- quiet moment then succeeds.
--
-- If it still times out, run the sections below one at a time. Each touches a
-- single table, so each holds one lock, which cannot deadlock against the app.
SET lock_timeout = '5s';

-- The column and the two tables, in case 031 never ran at all.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS share_activities_with_friends BOOLEAN NOT NULL DEFAULT true;

-- Copied verbatim from 031 rather than paraphrased. An earlier draft of this
-- file invented plausible-looking definitions — gen_random_uuid(), a TEXT
-- reaction column — which would have created the WRONG schema on any database
-- that never ran 031, and the app would have broken in a new way while
-- appearing to be repaired.
CREATE TABLE IF NOT EXISTS activity_reactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 10),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (activity_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_activity_reactions_activity ON activity_reactions(activity_id);

CREATE TABLE IF NOT EXISTS activity_comments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_comments_activity ON activity_comments(activity_id, created_at);

ALTER TABLE activity_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_comments ENABLE ROW LEVEL SECURITY;

-- Policies, grouped by table so this can be run in pieces.

-- activities
DROP POLICY IF EXISTS "Friends view shared activities" ON activities;
CREATE POLICY "Friends view shared activities" ON activities FOR SELECT
  USING (activity_is_visible_to(id, auth.uid()));

-- activity_reactions
DROP POLICY IF EXISTS "View reactions on visible activities" ON activity_reactions;
CREATE POLICY "View reactions on visible activities" ON activity_reactions FOR SELECT
  USING (activity_is_visible_to(activity_id, auth.uid()));

DROP POLICY IF EXISTS "Add reactions to visible activities" ON activity_reactions;
CREATE POLICY "Add reactions to visible activities" ON activity_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND activity_is_visible_to(activity_id, auth.uid()));

DROP POLICY IF EXISTS "Manage own reactions" ON activity_reactions;
CREATE POLICY "Manage own reactions" ON activity_reactions FOR UPDATE
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Delete own reactions" ON activity_reactions;
CREATE POLICY "Delete own reactions" ON activity_reactions FOR DELETE
  USING (user_id = auth.uid());

-- activity_comments
DROP POLICY IF EXISTS "View comments on visible activities" ON activity_comments;
CREATE POLICY "View comments on visible activities" ON activity_comments FOR SELECT
  USING (activity_is_visible_to(activity_id, auth.uid()));

DROP POLICY IF EXISTS "Add comments to visible activities" ON activity_comments;
CREATE POLICY "Add comments to visible activities" ON activity_comments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND activity_is_visible_to(activity_id, auth.uid()));

DROP POLICY IF EXISTS "Delete own comments" ON activity_comments;
CREATE POLICY "Delete own comments" ON activity_comments FOR DELETE
  USING (user_id = auth.uid());
