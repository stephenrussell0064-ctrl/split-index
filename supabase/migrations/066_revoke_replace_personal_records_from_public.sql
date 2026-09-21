-- ─────────────────────────────────────────────────────────────────────────────
-- `GRANT ... TO authenticated, service_role` is not a restriction.
--
-- Migration 065 created `replace_personal_records` and granted EXECUTE to
-- `authenticated` and `service_role`, which reads as a closed door and is not
-- one: PostgreSQL grants EXECUTE on every new function to PUBLIC by default,
-- and naming two roles afterwards adds to that rather than replacing it.
--
-- Verified against production after 065 was applied. Calling the function with
-- the ANON key — the one that ships in the client bundle by design — reaches
-- the function body and fails only on "cannot execute DELETE in a read-only
-- transaction", which is the probe's own read-only transaction talking, not a
-- permission check.
--
-- WHAT THAT DID AND DID NOT EXPOSE. The function is SECURITY INVOKER and
-- `personal_records` carries "Users manage own PRs" FOR ALL USING
-- (auth.uid() = user_id). For an anonymous caller `auth.uid()` is NULL, so the
-- DELETE matches no rows and the INSERT is refused by the same policy. No
-- athlete's records could be read, written or destroyed through it. RLS was
-- doing the work the grant was supposed to be doing.
--
-- What it did leave open is `pg_advisory_xact_lock` on an arbitrary user id,
-- taken before either statement. Anyone with the public key could contend that
-- lock for a chosen athlete and make their recomputes queue. Transient — the
-- lock releases at commit and each call is its own transaction — and a long way
-- from data loss, but it is a lock an unauthenticated caller has no business
-- being able to take.
--
-- 061 already establishes the convention this missed:
--   REVOKE ALL ON FUNCTION public.caller_email_verified() FROM PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.caller_email_verified() TO authenticated;
--
-- Separate migration rather than an edit to 065, because 065 is already applied
-- in production and editing an applied migration changes nothing on the server.
-- ─────────────────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.replace_personal_records(UUID, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.replace_personal_records(UUID, JSONB)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.replace_personal_records(UUID, JSONB) IS
  'Replaces an athlete''s entire personal-record set in one transaction, behind a '
  'per-user advisory lock. SECURITY INVOKER: RLS on personal_records decides what '
  'the caller may touch, so this grants nobody anything they could not do with a '
  'separate DELETE and INSERT. Not executable by anon — see migration 066.';
