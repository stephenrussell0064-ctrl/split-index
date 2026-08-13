-- Admin roles, and the fleet-review gate on rollout.
--
-- WP10 left a hole that was named at the time: the monitoring route is scoped
-- to the requesting user's own rows, so the kill-switch decision had no view
-- to be made from. This adds the role that makes a fleet-wide view safe and
-- the gate that makes reviewing it mandatory before anyone is exposed.
--
-- The security property that matters most here is that a user cannot make
-- themselves an admin. There are deliberately NO insert/update/delete policies
-- on admin_users: RLS denies by default, so the only way in is the service
-- role, which means a grant has to come from a migration, the Supabase
-- dashboard, or a server-side script an operator runs on purpose. An admin
-- role that a user can reach through any normal application path is not a
-- role, it is a suggestion.

-- ─── Admin roles ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS admin_users (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Room to grow without another migration. 'operator' can read the fleet view
  -- and work the kill switch; 'viewer' can read it and cannot change anything.
  role TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('operator', 'viewer')),
  granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Nullable because the first admin is necessarily granted by a human with
  -- database access rather than by another admin.
  granted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  note TEXT
);

ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- An admin may see that they are an admin. Nobody may see who else is, and
-- nobody may write. Both omissions are the point: RLS denies anything without
-- a policy, so the absence of an INSERT policy IS the protection.
CREATE POLICY "Admins read their own role" ON admin_users FOR SELECT
  USING (auth.uid() = user_id);

-- ─── Fleet review gate ────────────────────────────────────────────────────────
-- The brief's requirement, made enforceable rather than procedural: the fleet
-- view "is the view the kill-switch decision is made from, so it is a
-- prerequisite for any rollout above 0%". Recording when it was last actually
-- loaded, and by whom, is what lets the rollout endpoint refuse a raise that
-- nobody looked at first.
ALTER TABLE hpe_feature_flags
  ADD COLUMN IF NOT EXISTS last_fleet_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_fleet_review_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Snapshot of how many alarms were showing at that review. A review taken
  -- while the dashboard was alarming does not clear the gate.
  ADD COLUMN IF NOT EXISTS last_fleet_review_alarm_count SMALLINT;

-- ─── Rollout audit ────────────────────────────────────────────────────────────
-- Every change to the flag, who made it and why. A kill switch with no record
-- of who threw it is an outage nobody can reconstruct afterwards, and a
-- rollout advance with no record of what the dashboard said at the time is a
-- decision nobody can defend.
CREATE TABLE IF NOT EXISTS hpe_rollout_audit (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  from_enabled BOOLEAN,
  to_enabled BOOLEAN,
  from_percentage SMALLINT,
  to_percentage SMALLINT,
  reason TEXT,
  -- What the fleet dashboard was showing when the change was made.
  alarm_count SMALLINT,
  alarms TEXT[]
);

CREATE INDEX IF NOT EXISTS idx_hpe_rollout_audit_changed ON hpe_rollout_audit(changed_at DESC);

ALTER TABLE hpe_rollout_audit ENABLE ROW LEVEL SECURITY;
-- No policies: readable and writable only through the service role, same as
-- the flag changes it records.
