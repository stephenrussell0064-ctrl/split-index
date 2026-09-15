-- WP6.4 — an audit entry per admin access.
--
-- WHAT WAS MISSING
-- ----------------
-- Migration 041 audits rollout CHANGES: who moved the dial, from what, to what,
-- and what the dashboard said at the time. That is the right record for a
-- write, and it is the only record there is.
--
-- The fleet view is a read, and reads were unrecorded. It runs a service-role
-- query that bypasses row level security across every athlete in the system —
-- the only route in the app that does — so "who looked at the fleet, and when"
-- is exactly the question an incident asks and nothing could answer.
--
-- WHY DENIALS ARE RECORDED TOO
-- ----------------------------
-- `granted` is a column rather than an assumption. A non-admin hitting an admin
-- route is not an error to swallow: repeated denials from one account are the
-- signature of somebody probing, which is the alert path WP7 asks for. A log
-- that only records successes cannot show an attempt that failed, which is the
-- only kind worth alerting on.
--
-- WHAT MUST NEVER GO IN HERE
-- --------------------------
-- `detail` is jsonb and therefore an invitation. It takes request parameters —
-- a window in days, a rollout percentage — and nothing else. No bodyweight, no
-- heart rate, no intake answer, no token, no email. WP7 states the rule for
-- logs generally; this table is the one most likely to tempt somebody into
-- breaking it, because "just log the payload" is always easier than deciding
-- what belongs.
--
-- src/lib/auth/admin-audit.test.ts asserts the shape and that the writer cannot
-- be handed a health field.

CREATE TABLE IF NOT EXISTS admin_access_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Who. SET NULL rather than CASCADE: an account being deleted must not erase
  -- the record that it once read the fleet. The row survives without naming a
  -- live user, which is the correct balance between an audit trail and erasure.
  admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_role TEXT,

  -- What. Route rather than a free-text description, so this is groupable.
  route TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('read', 'write')),

  -- Whether the check passed. See the note above on denials.
  granted BOOLEAN NOT NULL,

  -- Request parameters only.
  detail JSONB NOT NULL DEFAULT '{}'
);

-- "Who has been looking at this lately" and "has one account been denied
-- repeatedly" are the two questions this table exists for.
CREATE INDEX IF NOT EXISTS idx_admin_access_log_time
  ON admin_access_log (accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_access_log_denied
  ON admin_access_log (admin_user_id, accessed_at DESC)
  WHERE granted = false;

ALTER TABLE admin_access_log ENABLE ROW LEVEL SECURITY;

-- No policies, deliberately, exactly as hpe_rollout_audit does it. RLS denies
-- what no policy permits, so this table is reachable only through the service
-- role — the same credential the admin routes already hold. An admin being
-- able to read, and therefore eventually to reason about editing, the log of
-- their own accesses defeats the point of keeping one.

COMMENT ON TABLE admin_access_log IS
  'One row per attempt to reach an admin surface, granted or denied. Reachable '
  'only through the service role: no RLS policies exist, which is how a table is '
  'made unreadable by the people it records. Denials are recorded because '
  'repeated denial from one account is the signal worth alerting on.';

COMMENT ON COLUMN admin_access_log.detail IS
  'Request parameters only — a window in days, a rollout percentage. Never a '
  'bodyweight, heart rate, intake answer, token or email address. See WP7.';
