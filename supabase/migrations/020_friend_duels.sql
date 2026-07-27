-- Friend-vs-friend duels (Slice C, item 3 of the monetization plan): a
-- lightweight 1v1 competition on a shared metric for a fixed window, solving
-- the competitive cold-start problem without needing platform-wide scale —
-- it can matter with just 2 users, unlike the existing global `challenges`
-- table (any-user open pool, no pairing concept at all).
--
-- Standings are computed live from workout_scores at read time (same
-- pattern as computeRecentLoads/fetchCompareHistory) rather than maintained
-- as a running counter — simpler and can't drift out of sync.

CREATE TYPE duel_status AS ENUM ('pending', 'accepted', 'declined', 'cancelled');
CREATE TYPE duel_metric AS ENUM ('sessions', 'load');

CREATE TABLE duels (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  challenger_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  opponent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  metric duel_metric NOT NULL DEFAULT 'sessions',
  sport sport_type,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status duel_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  CHECK (challenger_id != opponent_id),
  CHECK (end_date > start_date)
);

CREATE INDEX idx_duels_challenger ON duels(challenger_id, status);
CREATE INDEX idx_duels_opponent ON duels(opponent_id, status);

ALTER TABLE duels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Participants can view their duels" ON duels FOR SELECT
  USING (auth.uid() = challenger_id OR auth.uid() = opponent_id);

-- A duel can only be created against an accepted friend — enforced at the
-- DB layer, not just in the API route, since this is a trust boundary
-- (comparing training data between two specific people).
CREATE POLICY "Users can challenge a friend to a duel" ON duels FOR INSERT
  WITH CHECK (
    auth.uid() = challenger_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM friends
      WHERE status = 'accepted'
        AND ((user_id = challenger_id AND friend_id = opponent_id)
          OR (user_id = opponent_id AND friend_id = challenger_id))
    )
  );

-- USING checks the row being updated (must still be pending); WITH CHECK
-- checks the row being written — the opponent may only move to
-- accepted/declined, the challenger may only cancel their own pending invite.
CREATE POLICY "Opponent responds, challenger cancels, only while pending" ON duels FOR UPDATE
  USING ((auth.uid() = opponent_id OR auth.uid() = challenger_id) AND status = 'pending')
  WITH CHECK (
    (auth.uid() = opponent_id AND status IN ('accepted', 'declined'))
    OR (auth.uid() = challenger_id AND status = 'cancelled')
  );
