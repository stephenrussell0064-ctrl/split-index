-- 090: the logging-effort plan's measurement, as three weekly views.
--
-- NUMBERING. 090 because 089 is the highest version on any branch or tag in
-- this repo at the moment of writing (the rule 085's header sets out):
--   git log --all --diff-filter=A --name-only --format= -- supabase/migrations | sort -u | tail -1
--
-- WHY
-- ---
-- The plan's claim is that logging takes too much effort and that each phase
-- lowers it. That claim rested on the code inventory and the owner's own
-- read, not on usage data. These views are where the data lives, one row per
-- ISO week, so each phase can be judged against the targets the plan set:
--
--   fields touched per saved session   gym: ~60 typed, under 10 after phase 2
--   seconds from form open to save     cardio: under 20 s for an import
--   share of sessions by source        over half of cardio apple_health
--   recovery rows with HRV             from near zero to daily for watch users
--   prescribed sets accepted vs edited majority accepted on plan days
--   weekly active loggers              rising — the one that matters
--
-- The per-session numbers come from activities.metadata->'logging_effort'
-- (which door, fields by hand, seconds), written by every save path since
-- this migration's commit, and ->'prescribed_sets' (phase 2). Sessions saved
-- before that carry neither and show up in `activities` but not `measured`.
--
-- AGGREGATE ONLY, SERVICE ROLE ONLY. No user id, no title, no note leaves
-- these views; the smallest group is one athlete, which is why the admin
-- route shows them only to admin_users and never lists athletes. Every
-- grant is revoked explicitly, `authenticated` included — 085 left that
-- role's default grant in place for the app's own views, and these are not
-- the app's own views. Only the service role (the admin route) reads them.
--
-- REVERT.
--   DROP VIEW IF EXISTS logging_effort_weekly;
--   DROP VIEW IF EXISTS recovery_inputs_weekly;
--   DROP VIEW IF EXISTS active_loggers_weekly;
-- The metadata keys stay in the JSONB column and need no DDL to remove.

BEGIN;

CREATE OR REPLACE VIEW logging_effort_weekly AS
SELECT
  date_trunc('week', started_at)::date AS week_start,
  CASE WHEN sport = 'gym' THEN 'gym' ELSE 'cardio' END AS domain,
  source::text AS source,
  -- Sessions saved before the measurement existed are grouped by their
  -- source, so an old GPS run reads as 'gps' rather than vanishing.
  COALESCE(
    metadata->'logging_effort'->>'entry',
    CASE WHEN source::text = 'manual' THEN 'untracked' ELSE source::text END
  ) AS entry,
  count(*)::int AS activities,
  count(DISTINCT user_id)::int AS athletes,
  count(*) FILTER (WHERE metadata ? 'logging_effort')::int AS measured,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY (metadata->'logging_effort'->>'fields_touched')::numeric
  ) AS median_fields_touched,
  percentile_cont(0.5) WITHIN GROUP (
    ORDER BY (metadata->'logging_effort'->>'seconds_to_save')::numeric
  ) AS median_seconds_to_save,
  COALESCE(sum((metadata->'prescribed_sets'->>'accepted')::int), 0)::int AS prescribed_sets_accepted,
  COALESCE(sum((metadata->'prescribed_sets'->>'edited')::int), 0)::int AS prescribed_sets_edited
FROM activities
WHERE is_draft = false
GROUP BY 1, 2, 3, 4;

CREATE OR REPLACE VIEW recovery_inputs_weekly AS
SELECT
  date_trunc('week', recorded_at)::date AS week_start,
  source AS hrv_source,
  count(*) FILTER (WHERE hrv_ms IS NOT NULL)::int AS hrv_days,
  count(DISTINCT user_id) FILTER (WHERE hrv_ms IS NOT NULL)::int AS hrv_athletes,
  count(*) FILTER (WHERE resting_hr IS NOT NULL)::int AS resting_hr_days,
  count(*) FILTER (WHERE sleep_hours IS NOT NULL)::int AS sleep_nights
FROM recovery_snapshots
GROUP BY 1, 2;

CREATE OR REPLACE VIEW active_loggers_weekly AS
SELECT
  date_trunc('week', started_at)::date AS week_start,
  count(DISTINCT user_id)::int AS loggers,
  count(DISTINCT user_id) FILTER (WHERE sport = 'gym')::int AS gym_loggers,
  count(DISTINCT user_id) FILTER (WHERE sport <> 'gym')::int AS cardio_loggers,
  count(DISTINCT user_id) FILTER (WHERE source::text IN ('gps', 'apple_health', 'file'))::int AS recorded_or_imported_loggers,
  count(*)::int AS activities
FROM activities
WHERE is_draft = false
GROUP BY 1;

REVOKE ALL ON logging_effort_weekly FROM PUBLIC, anon, authenticated;
REVOKE ALL ON recovery_inputs_weekly FROM PUBLIC, anon, authenticated;
REVOKE ALL ON active_loggers_weekly FROM PUBLIC, anon, authenticated;

COMMENT ON VIEW logging_effort_weekly IS
  'Logging-effort plan measurement: per ISO week, domain, source and entry door — sessions, athletes, median fields touched, median seconds to save, prescribed sets accepted vs edited. Service role only. Migration 090.';
COMMENT ON VIEW recovery_inputs_weekly IS
  'Logging-effort plan measurement: per ISO week and HRV source — days with HRV, resting HR and sleep on recovery_snapshots. Service role only. Migration 090.';
COMMENT ON VIEW active_loggers_weekly IS
  'Logging-effort plan measurement: distinct athletes who logged anything per ISO week, split by domain and by recorded-or-imported. Service role only. Migration 090.';

COMMIT;
