-- 092: one function that answers "how close is this project to the free-plan
-- limits", for the admin dashboard.
--
-- NUMBERING. 092 because 091 is the highest version on any branch or tag in
-- this repo at the moment of writing (the rule 085's header sets out):
--   git log --all --diff-filter=A --name-only --format= -- supabase/migrations | sort -u | tail -1
--
-- WHY
-- ---
-- The project is on Supabase's free plan. Its limits are not on the number of
-- accounts but on monthly active users (50,000), database size (500 MB),
-- file storage (1 GB), and — the one that actually threatens a live App
-- Store app — pausing after seven days with no API activity. The Supabase
-- dashboard shows the first three and emails at 80%; nothing shows the last
-- one until it has happened. This puts all four beside the other operations
-- numbers at /admin/logging-effort, read through the service role.
--
-- WHY A FUNCTION
-- --------------
-- Three of the inputs live where PostgREST cannot see them: pg_database_size
-- is a catalogue call, auth.users is not an exposed schema, and
-- storage.objects is not either. A SECURITY DEFINER function owned by
-- postgres can read all three and hand back one JSON object. It is
-- aggregate only — counts and byte totals, never a row — and only the
-- service role may call it, the same boundary 090's views sit behind.
--
-- WHAT COUNTS AS "ACTIVE". Supabase bills an MAU as a user who signed in or
-- refreshed a session in the calendar month; auth.users.last_sign_in_at is
-- the nearest thing this side of the billing system has. It undercounts
-- slightly (a long-lived session refreshed without a fresh sign-in keeps the
-- old timestamp), which is the safe direction for a headroom figure.
--
-- "Last activity" for the pause check is the newest of: a sign-in, a saved
-- activity, a recovery snapshot. Any API call keeps a project awake, so this
-- is conservative — if it says the project has been quiet for six days, it
-- might not have been, but if it says one day, it has not.
--
-- RE-RUNNABLE: CREATE OR REPLACE throughout.

BEGIN;

CREATE OR REPLACE FUNCTION public.supabase_headroom()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'database_bytes', pg_database_size(current_database()),
    'storage_bytes', COALESCE((
      SELECT sum((metadata->>'size')::bigint) FROM storage.objects WHERE metadata ? 'size'
    ), 0),
    'storage_objects', (SELECT count(*) FROM storage.objects),
    'users_total', (SELECT count(*) FROM auth.users),
    'users_active_calendar_month', (
      SELECT count(*) FROM auth.users
      WHERE last_sign_in_at >= date_trunc('month', now())
    ),
    'users_active_30d', (
      SELECT count(*) FROM auth.users
      WHERE last_sign_in_at >= now() - interval '30 days'
    ),
    'users_onboarded', (SELECT count(*) FROM public.profiles WHERE onboarding_completed),
    'activities_total', (SELECT count(*) FROM public.activities WHERE is_draft = false),
    'last_activity_at', (
      SELECT max(t) FROM (
        SELECT max(last_sign_in_at) AS t FROM auth.users
        UNION ALL SELECT max(created_at) FROM public.activities
        UNION ALL SELECT max(recorded_at) FROM public.recovery_snapshots
      ) AS latest
    ),
    'measured_at', now()
  );
$$;

REVOKE ALL ON FUNCTION public.supabase_headroom() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.supabase_headroom() TO postgres, service_role;

COMMENT ON FUNCTION public.supabase_headroom() IS
  'Free-plan headroom for the admin dashboard: database and storage bytes, auth user counts (total, calendar-month active, 30-day active), and the newest sign-in or save, for the seven-day pause check. Aggregate only; service role only. Migration 092.';

COMMIT;

-- AFTER APPLYING
-- 1. SELECT public.supabase_headroom();  — should return one JSON object.
-- 2. /admin/logging-effort shows the Supabase headroom card instead of the
--    "apply migration 092" note.
-- 3. Record a row in docs/pre-launch/migration-reconciliation.md §1. A
--    migration is not done until it has a ledger row.
