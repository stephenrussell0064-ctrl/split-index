-- Squads (interference-engine brief, Part 4): small invite-based training
-- groups of people the user actually knows, replacing bracket leaderboards
-- against strangers as the *primary* social surface (brackets stay, demoted).
--
-- Membership is gated by a secret invite_code rather than DB-level RLS
-- checks (unlike duels' friendship EXISTS check) — the code itself is the
-- trust boundary, verified server-side via the admin client before a join
-- is attempted, so squads/squad_members RLS only needs to keep each user
-- confined to their own memberships and self-inserts.

CREATE TABLE squads (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  invite_code TEXT NOT NULL UNIQUE,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE squad_members (
  squad_id UUID NOT NULL REFERENCES squads(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (squad_id, user_id)
);

CREATE INDEX idx_squad_members_user ON squad_members(user_id);

ALTER TABLE squads ENABLE ROW LEVEL SECURITY;
ALTER TABLE squad_members ENABLE ROW LEVEL SECURITY;

-- Squads are only listable by their own members — looking a squad up by
-- invite_code to join happens server-side via the admin client, not through
-- this policy, so an unjoined user can't browse squads by name/id.
CREATE POLICY "Members can view their squads" ON squads FOR SELECT
  USING (EXISTS (SELECT 1 FROM squad_members WHERE squad_id = squads.id AND user_id = auth.uid()));

CREATE POLICY "Users can create a squad" ON squads FOR INSERT
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Members can view fellow squad members" ON squad_members FOR SELECT
  USING (EXISTS (SELECT 1 FROM squad_members sm WHERE sm.squad_id = squad_members.squad_id AND sm.user_id = auth.uid()));

CREATE POLICY "Users can add themselves to a squad" ON squad_members FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can leave a squad" ON squad_members FOR DELETE
  USING (user_id = auth.uid());
