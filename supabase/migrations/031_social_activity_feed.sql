-- Social activity feed (Slice 1) — user feedback: "I also want a feed of
-- activities on the logbook which other users who are friends with you are
-- able to see, and this is an option you can select in your profile to
-- turn on or off as some users may want to keep their activities private,
-- and other users are able to interact with their activities on public
-- accounts such as by scoring their run out of 10 and able to leave
-- comments on them, similar to stravas concept, but for both gym and other
-- cardio activities."

-- ─── Privacy toggle ─────────────────────────────────────────────────────────
-- Off by default — private-by-default is the safer default absent an
-- explicit user choice; the settings UI invites users who want this on to
-- turn it on, rather than opting everyone in silently.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS share_activities_with_friends BOOLEAN NOT NULL DEFAULT false;

-- ─── Reactions (1-10 score, Strava-kudos-equivalent but numeric) ──────────────
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

-- ─── Comments ───────────────────────────────────────────────────────────────
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

-- A single, reusable visibility predicate: is `check_activity_id` visible to
-- the current user? True for the owner always; true for an accepted friend
-- only when the owner has opted into sharing and the activity isn't a
-- draft. Used identically across the activities/reactions/comments
-- policies below so the three surfaces can never disagree about who can
-- see what.
CREATE OR REPLACE FUNCTION activity_is_visible_to(check_activity_id UUID, viewer_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM activities a
    JOIN profiles p ON p.user_id = a.user_id
    WHERE a.id = check_activity_id
      AND a.is_draft = false
      AND (
        a.user_id = viewer_id
        OR (
          p.share_activities_with_friends = true
          AND EXISTS (
            SELECT 1 FROM friends f
            WHERE f.status = 'accepted'
              AND (
                (f.user_id = viewer_id AND f.friend_id = a.user_id)
                OR (f.friend_id = viewer_id AND f.user_id = a.user_id)
              )
          )
        )
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Friends (with sharing enabled) can now see the shared activity rows
-- themselves — previously "Users manage own activities" (FOR ALL) was the
-- only policy, so any query for someone else's activities silently
-- returned nothing under RLS, same class of gap public_read_strength_scores
-- fixed for strength_scores. Additive: a user's own activities are still
-- governed by the existing FOR ALL policy: RLS OR's every permissive
-- policy for a given command together.
CREATE POLICY "Friends view shared activities" ON activities FOR SELECT
  USING (activity_is_visible_to(id, auth.uid()));

CREATE POLICY "View reactions on visible activities" ON activity_reactions FOR SELECT
  USING (activity_is_visible_to(activity_id, auth.uid()));
CREATE POLICY "Add reactions to visible activities" ON activity_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid() AND activity_is_visible_to(activity_id, auth.uid()));
CREATE POLICY "Manage own reactions" ON activity_reactions FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY "Delete own reactions" ON activity_reactions FOR DELETE
  USING (user_id = auth.uid());

CREATE POLICY "View comments on visible activities" ON activity_comments FOR SELECT
  USING (activity_is_visible_to(activity_id, auth.uid()));
CREATE POLICY "Add comments to visible activities" ON activity_comments FOR INSERT
  WITH CHECK (user_id = auth.uid() AND activity_is_visible_to(activity_id, auth.uid()));
CREATE POLICY "Delete own comments" ON activity_comments FOR DELETE
  USING (user_id = auth.uid());
