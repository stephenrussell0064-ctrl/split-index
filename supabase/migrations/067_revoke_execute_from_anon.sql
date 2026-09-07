-- Revoking from PUBLIC does not revoke from `anon`.
--
-- WHY THE EXISTING REVOKES WERE NOT ENOUGH
-- ----------------------------------------
-- 060, 061 and 063 each end with the right-looking line:
--
--   REVOKE ALL ON FUNCTION <fn>() FROM PUBLIC;
--
-- That removes the implicit grant Postgres gives PUBLIC on every new function.
-- It does not remove a grant held DIRECTLY by a role, and a Supabase project
-- ships with `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS
-- TO anon, authenticated, service_role` as part of its bootstrap. Under that
-- default, every function created afterwards is granted to `anon` by name at
-- creation time. Revoking from PUBLIC leaves that grant untouched.
--
-- This is the same root cause as 065/066, found from the other side: there,
-- `GRANT ... TO authenticated, service_role` looked like a restriction and was
-- an addition. Here, `REVOKE ... FROM PUBLIC` looked like a removal and was
-- only half of one. One default explains both.
--
-- WHAT IS AND IS NOT AT RISK, MEASURED RATHER THAN ASSERTED
-- --------------------------------------------------------
-- `withdraw_article9_health_data()` is the one that sounds worst and is not.
-- It is SECURITY DEFINER, so it can reach the tables — but every statement in
-- it is scoped `WHERE user_id = auth.uid()`, and for an anon JWT there is no
-- `sub` claim, so `auth.uid()` is NULL. `user_id = NULL` is NULL, never TRUE.
-- An unauthenticated call updates zero rows and deletes zero rows. It is a
-- no-op by construction, not by permission, which is why it was not an incident.
--
-- `prune_security_events()` is the one that matters, and it is the one nobody
-- was looking at. It is also SECURITY DEFINER, and it selects rows BY DATE:
--
--   DELETE FROM security_events WHERE retention_class = 'security'
--     AND occurred_at < NOW() - INTERVAL '90 days';
--
-- There is no auth.uid() in it, so there is no NULL to save it. If `anon` holds
-- EXECUTE, an unauthenticated caller can make the audit log prune itself on
-- demand. The blast radius today is small — it deletes only rows already past
-- their retention, and this database is young enough that there may be none —
-- but "an unauthenticated request can delete from the security log" is not a
-- sentence that should survive to a launch, and the size of the effect is an
-- accident of the calendar rather than a property of the design.
--
-- `caller_email_verified()` is harmless to anon (it answers about auth.uid(),
-- so it returns false) and is revoked here for consistency rather than risk.
--
-- SAFE TO REVOKE FROM anon — CHECKED, NOT ASSUMED
-- -----------------------------------------------
-- `caller_email_verified()` is referenced only in the WITH CHECK of three
-- RESTRICTIVE **INSERT** policies (061:99-119). Anonymous callers do not insert
-- into activities, gym_exercises or workout_scores, so no anonymous read
-- evaluates it and nothing public breaks. The other two are never called by the
-- application on an anonymous path at all.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RUN THIS BEFORE AND AFTER, AND COMPARE
-- ─────────────────────────────────────────────────────────────────────────────
--   SELECT p.proname,
--          p.prosecdef AS security_definer,
--          coalesce(array_to_string(p.proacl, E'\n'), '(default: PUBLIC)') AS acl
--     FROM pg_proc p
--     JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('withdraw_article9_health_data',
--                        'caller_email_verified',
--                        'prune_security_events',
--                        'handle_new_user')
--    ORDER BY p.proname;
--
-- Before: expect to see `anon=X/postgres` in the acl of at least the first
-- three. After: no `anon=` entry on any of them. An `=X/` entry with no role
-- name before the `=` is the PUBLIC grant, and should also be gone.

BEGIN;

-- ─── The one with teeth ─────────────────────────────────────────────────────
-- Deletes by date with no caller scoping. Operator and scheduled-job only, as
-- 063 already said in a comment while granting it to nobody and revoking it
-- from only half of everybody.
REVOKE ALL ON FUNCTION public.prune_security_events() FROM PUBLIC, anon, authenticated;

-- ─── Article 9 withdrawal ───────────────────────────────────────────────────
-- Stays available to `authenticated`: it is how an athlete exercises the right
-- to withdraw consent, and taking that away would replace a permissions bug
-- with a compliance one.
REVOKE ALL ON FUNCTION public.withdraw_article9_health_data() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.withdraw_article9_health_data() TO authenticated;

-- ─── The RLS helper ─────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.caller_email_verified() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.caller_email_verified() TO authenticated;

-- ─── The signup trigger ─────────────────────────────────────────────────────
-- Belt and braces. Postgres refuses to invoke a function returning `trigger`
-- directly ("trigger functions can only be called as triggers") and PostgREST
-- does not expose one, so this is not reachable over the API by any role. It is
-- revoked anyway because the cost is a line and the alternative is reasoning
-- about it again next time.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

COMMIT;

-- ─── For everything created after this ──────────────────────────────────────
-- The bootstrap default is still in place, so the NEXT function created in this
-- schema will again be granted to anon at creation. Deliberately not altered
-- here: changing a project-wide default privilege is a wider blast radius than
-- this migration should carry, and doing it silently inside a security fix is
-- how the next person inherits a surprise.
--
-- Until it is changed, every new SECURITY DEFINER function needs BOTH lines:
--
--   REVOKE ALL ON FUNCTION <fn>(<args>) FROM PUBLIC, anon;
--   GRANT EXECUTE ON FUNCTION <fn>(<args>) TO <the roles that should have it>;
--
-- `function-grants.test.ts` fails the build if a migration adds a SECURITY
-- DEFINER function without them.
