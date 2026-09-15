-- WP7 — retention, and the alert path.
--
-- WHAT THIS IS FOR, AND WHAT IT IS NOT
-- ------------------------------------
-- Every security event is written to stdout as one structured JSON line, and
-- that is the log. Vercel captures it, a drain can parse it, and it costs
-- nothing on the request path.
--
-- This table is not a second copy of that. It exists for the two questions the
-- brief asks that a log line cannot answer on its own:
--
--   * "Has this account been denied repeatedly?" — the signature of somebody
--     probing the paywall, per WP7.
--   * "How long do we keep this?" — §1 sets 90 days for security events and 365
--     for audit entries, and a retention policy has to live somewhere it can be
--     enforced rather than in a drain's default settings.
--
-- WHAT IS DELIBERATELY NOT PERSISTED
-- ----------------------------------
-- Rate-limit trips. They are logged to stdout like everything else and they do
-- NOT get a row, because the event fires under exactly the conditions where
-- writing a row per occurrence is worst: a flood. A limiter that writes a
-- database row for every request it rejects is an amplifier pointed at our own
-- database, and the aggregate ("this IP tripped the limit 4,000 times") is
-- better answered from the log stream than from 4,000 rows.
--
-- WHAT MUST NEVER BE IN HERE
-- --------------------------
-- Same rule as admin_access_log, and the same reason it is worth restating:
-- `detail` is jsonb, so it will take anything. The writer redacts by field name
-- before it reaches this table (see lib/observability/security-log.ts), and
-- security-log.test.ts asserts that every Article 9 intake field is covered.
-- The rule is enforced in code because SQL cannot enforce it.

CREATE TABLE IF NOT EXISTS security_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  event_type TEXT NOT NULL,
  -- Ties a row to the response the caller was given and to the stdout line.
  correlation_id TEXT NOT NULL,

  -- SET NULL rather than CASCADE, same reasoning as admin_access_log: erasing
  -- an account must not erase the record that somebody probed a paywall with
  -- it. The row survives without naming a live user.
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  source TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('allowed', 'denied', 'error')),

  -- 'security' keeps 90 days, 'audit' keeps 365. Health-adjacent entries — an
  -- entitlement denial on a Hybrid Plan surface, an admin read — are audit,
  -- because "who could have seen this, and when" is asked on a longer horizon
  -- than "was there a brute-force attempt in March".
  retention_class TEXT NOT NULL CHECK (retention_class IN ('security', 'audit')),

  detail JSONB NOT NULL DEFAULT '{}'
);

-- The alert query: denials for one account inside a window.
CREATE INDEX IF NOT EXISTS idx_security_events_denials
  ON security_events (user_id, event_type, occurred_at DESC)
  WHERE outcome = 'denied';

-- The expiry sweep.
CREATE INDEX IF NOT EXISTS idx_security_events_retention
  ON security_events (retention_class, occurred_at);

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

-- No policies, deliberately — the same pattern as hpe_rollout_audit and
-- admin_access_log. Reachable only through the service role. A user able to
-- read the log of their own denied attempts can tell exactly how much of the
-- paywall they have mapped.

COMMENT ON TABLE security_events IS
  'Persisted subset of the structured security log: the events that support an '
  'alert or carry a retention obligation. Rate-limit trips are logged to stdout '
  'but deliberately not written here — a row per rejected request turns a limiter '
  'into an amplifier pointed at our own database.';

-- ─── Retention ──────────────────────────────────────────────────────────────
-- §1 sets the two periods. A policy nothing enforces is a policy that quietly
-- becomes "keep everything forever", which is its own disclosure risk: the
-- longer this table lives, the more it says about who was doing what and when.
--
-- Called from a scheduled job. Deliberately NOT a trigger — a delete that runs
-- on every insert makes the write path depend on the size of the table.

CREATE OR REPLACE FUNCTION prune_security_events()
RETURNS TABLE (deleted_security BIGINT, deleted_audit BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sec BIGINT;
  aud BIGINT;
BEGIN
  DELETE FROM security_events
   WHERE retention_class = 'security'
     AND occurred_at < NOW() - INTERVAL '90 days';
  GET DIAGNOSTICS sec = ROW_COUNT;

  DELETE FROM security_events
   WHERE retention_class = 'audit'
     AND occurred_at < NOW() - INTERVAL '365 days';
  GET DIAGNOSTICS aud = ROW_COUNT;

  RETURN QUERY SELECT sec, aud;
END;
$$;

REVOKE ALL ON FUNCTION prune_security_events() FROM PUBLIC;

COMMENT ON FUNCTION prune_security_events() IS
  'Deletes expired rows: 90 days for retention_class = security, 365 for audit. '
  'The intervals are duplicated from SECURITY_LOG_RETENTION_DAYS and '
  'AUDIT_LOG_RETENTION_DAYS in lib/security/config.ts — SQL cannot import them, '
  'so security-log.test.ts asserts the two agree.';

-- Not granted to `authenticated`: this is an operator or scheduled-job action,
-- and a function any signed-in user can call to delete audit rows is not a
-- retention policy.
