-- ─────────────────────────────────────────────────────────────────────────────
-- 066 was the same mistake as 065, from the other side.
--
-- 065 wrote `GRANT ... TO authenticated, service_role` and I read it as a
-- restriction; it was an addition, because Postgres grants EXECUTE on new
-- functions to PUBLIC by default. 066 then wrote `REVOKE ALL ... FROM PUBLIC`
-- and I read THAT as sufficient; it was not, because Supabase bootstraps with
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
--
-- so every new function also carries a DIRECT grant to `anon` by name.
-- Revoking PUBLIC removes the implicit grant and leaves the direct one
-- untouched. One default, two opposite-looking mistakes, and neither line looks
-- wrong on review — which is why this was found by probing the running database
-- rather than by reading the migration.
--
-- MEASURED, not reasoned. `caller_email_verified()` has carried
-- `REVOKE ALL ... FROM PUBLIC` since 061, and calling it with the anon key that
-- ships in the client bundle returns 200 and a result. A revoke from PUBLIC
-- alone demonstrably does not close the door.
--
-- Credit where it is due: the mechanism was identified by the hardening-audit
-- session, which fixed the four functions that audit introduced in 067. This is
-- the same fix for the one function 065 introduced, which 067 does not cover.
--
-- WHAT WAS ACTUALLY REACHABLE, unchanged from 066's note: the function is
-- SECURITY INVOKER and `personal_records` carries
-- FOR ALL USING (auth.uid() = user_id), so an anonymous caller's DELETE matched
-- no rows and its INSERT was refused. No records could be read, written or
-- destroyed. What was open is `pg_advisory_xact_lock` on an arbitrary user id,
-- which an unauthenticated caller has no business taking.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.replace_personal_records(UUID, JSONB)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_personal_records(UUID, JSONB)
  TO authenticated, service_role;

-- Verify, before and after:
--
--   SELECT proname, proacl
--   FROM pg_proc
--   WHERE proname = 'replace_personal_records';
--
-- `proacl` should name `authenticated` and `service_role` and neither `anon`
-- nor a bare `=X/` entry (which is PUBLIC).
