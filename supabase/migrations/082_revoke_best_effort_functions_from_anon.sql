-- 082: take EXECUTE on the best-effort functions away from anon.
--
-- NUMBERING. 082 because 081 is the highest version on any branch or tag,
-- checked rather than recalled.
--
-- WHAT WAS WRONG. `rank_best_efforts` (078) and `personal_best_efforts` (079)
-- are SECURITY DEFINER: they run with their definer's rights, not the caller's.
-- Supabase's ALTER DEFAULT PRIVILEGES grants EXECUTE on a new function to
-- `anon` and `authenticated` by name, and neither migration revoked it. A
-- `REVOKE ... FROM PUBLIC` would not have been enough either — that does not
-- remove a grant held directly by a role.
--
-- Both migrations were written on the app-store line, which did not carry
-- `src/lib/security/function-grants.test.ts`. main did. The test caught this
-- the moment the two lines were merged, which is the argument for the test.
--
-- MEASURED, NOT ASSUMED. On 21 September 2026, with the anon key that ships in
-- the client bundle, `POST /rest/v1/rpc/personal_best_efforts` returned HTTP
-- 200 on production. It returned zero rows — the body filters on `auth.uid()`,
-- which is null for an unauthenticated caller — so no athlete's data was
-- exposed. This closes the door rather than cleaning up after it:
-- SECURITY DEFINER plus a reachable entry point is one edit away from a leak,
-- and the edit need not be to this function.
--
-- `rank_best_efforts` answered PGRST202 (absent from the schema cache), so it
-- is not callable through PostgREST today. Revoked anyway: that is a fact
-- about the cache, not about the grant.
--
-- RE-RUNNABLE. REVOKE on an absent grant is a no-op, and IF EXISTS guards the
-- function lookup.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.rank_best_efforts(uuid)') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.rank_best_efforts(uuid) FROM PUBLIC, anon;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regprocedure('public.personal_best_efforts()') IS NOT NULL THEN
    REVOKE ALL ON FUNCTION public.personal_best_efforts() FROM PUBLIC, anon;
    GRANT EXECUTE ON FUNCTION public.personal_best_efforts() TO authenticated;
  END IF;
END
$$;

COMMIT;
