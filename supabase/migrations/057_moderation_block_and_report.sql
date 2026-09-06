-- App Store Guideline 1.2 — User-Generated Content.
--
-- The app ships a social feed, squads, duels, friends, leaderboards and public
-- profiles, and athletes choose their own usernames, display names, avatars and
-- squad names. Apple requires FOUR things of any app that does that, and the
-- guideline is explicit that it is all four, not a subset:
--
--   1. a method for filtering objectionable material;
--   2. a mechanism to report offensive content, with a timely response;
--   3. the ability to block abusive users;
--   4. published contact information so users can reach you.
--
-- Before this migration the app had one and a half of them: a short blocked-term
-- list applied to usernames only (src/lib/utils/username.ts), and nothing else.
-- No report route, no block, no moderation table anywhere in the schema.
--
-- This adds the two that need storage. (1) is extended to display names and
-- squad names in src/lib/utils/moderation.ts, and (4) is published on the
-- marketing site and in the App Store listing.

-- ---------------------------------------------------------------------------
-- BLOCKING
-- ---------------------------------------------------------------------------
-- One row per (blocker, blocked) pair. Deliberately one-directional in storage
-- and bidirectional in effect: readers check both columns, so a block hides
-- each athlete from the other without needing two rows to stay in step.
CREATE TABLE IF NOT EXISTS blocked_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  blocker_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blocked_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Nobody can block themselves out of their own feed.
  CONSTRAINT blocked_users_not_self CHECK (blocker_id <> blocked_id),
  CONSTRAINT blocked_users_unique UNIQUE (blocker_id, blocked_id)
);

-- Both directions are queried on every feed and leaderboard read, so both get
-- an index rather than only the natural one.
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocker ON blocked_users(blocker_id);
CREATE INDEX IF NOT EXISTS idx_blocked_users_blocked ON blocked_users(blocked_id);

ALTER TABLE blocked_users ENABLE ROW LEVEL SECURITY;

-- You manage your own blocks and can read no one else's. Note the TO clause:
-- several older policies in this schema omit it, which silently grants the
-- `anon` role as well. A list of who someone has blocked is exactly the sort of
-- thing that must never be world-readable.
CREATE POLICY "Users manage own blocks" ON blocked_users
  FOR ALL TO authenticated
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

-- ---------------------------------------------------------------------------
-- REPORTING
-- ---------------------------------------------------------------------------
CREATE TYPE report_status AS ENUM ('open', 'reviewing', 'actioned', 'dismissed');

CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Who is being reported. Kept even when the report is about a specific piece
  -- of content, because moderation acts on accounts.
  reported_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- What kind of thing prompted it: 'profile', 'activity', 'squad', 'duel',
  -- 'feed_item'. Free text rather than an enum so a new surface can file a
  -- report without a migration — the value is display metadata for a human
  -- reviewer, never a branch in code.
  subject_type TEXT NOT NULL,
  -- The id of that thing, when there is one. Null for a whole-profile report.
  subject_id UUID,
  reason TEXT NOT NULL,
  -- The reporter's own words. Optional, capped in the API.
  details TEXT,
  status report_status NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_notes TEXT,
  CONSTRAINT content_reports_not_self CHECK (reporter_id <> reported_user_id)
);

CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_reports_reported ON content_reports(reported_user_id);
-- Rate limiting reads this: one report per reporter per subject per day.
CREATE UNIQUE INDEX IF NOT EXISTS idx_content_reports_dedupe
  ON content_reports(reporter_id, reported_user_id, subject_type, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), (created_at::date));

ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;

-- A reporter may file a report and read back their own. They may NOT read
-- anyone else's, and they may not update one — a reporter editing the status of
-- their own report would make the queue meaningless. Review happens through the
-- service role, which bypasses RLS.
CREATE POLICY "Users file their own reports" ON content_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Users read their own reports" ON content_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id);
