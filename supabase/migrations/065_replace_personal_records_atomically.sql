-- ─────────────────────────────────────────────────────────────────────────────
-- A double-tap on "recompute" could delete every personal record and report 200.
--
-- `recomputeUser` rebuilds personal_records as two statements with nothing
-- between them: DELETE every row for the user, then INSERT the rebuilt set.
-- Supabase's JS client has no transaction, so those are two round trips.
-- `POST /api/activities/recompute` takes no parameters, has no in-flight guard
-- and no rate limit, so tapping it twice starts two full passes.
--
-- Interleave them — B's delete landing between A's delete and A's insert — and
-- A's insert hits UNIQUE(user_id, sport, metric) and fails wholesale. The
-- function records that in `rebuildFailures`, and the route returns 200 with a
-- `recomputed` count that reads like success. The athlete's entire PR history
-- is gone and the app says the recompute worked.
--
-- The existing code comment already names this as "the most destructive write
-- in this function". What was missing is the guard.
--
-- TWO GUARANTEES, both from making it one statement:
--
--   * ATOMIC. A plpgsql function body is a single transaction, so DELETE and
--     INSERT commit together or not at all. There is no longer an instant in
--     which the athlete has no records — not for a concurrent recompute, not
--     for a reader, not for a crash between the two calls.
--   * SERIALISED. pg_advisory_xact_lock makes a second recompute for the same
--     athlete wait rather than interleave, and releases at commit however the
--     transaction ends. Locked per user_id, so two athletes never queue behind
--     each other.
--
-- SECURITY INVOKER, deliberately. `personal_records` already carries
-- "Users manage own PRs" FOR ALL USING (auth.uid() = user_id), so RLS decides
-- exactly what it decided before and this function grants nobody anything they
-- could not already do with two separate calls. The bulk recompute script uses
-- a service-role client, which bypasses RLS as it already does. A SECURITY
-- DEFINER function here would be a new way to write another athlete's records,
-- bought for no reason.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.replace_personal_records(
  p_user_id UUID,
  p_records JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted INTEGER;
BEGIN
  -- hashtextextended keeps the whole uuid in the key rather than the first
  -- four bytes an int cast would take. Released at commit, always.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::TEXT, 0));

  DELETE FROM personal_records WHERE user_id = p_user_id;

  -- A recompute that finds no records is a real outcome — an athlete whose
  -- every activity was deleted — and must still clear the old set.
  IF p_records IS NULL OR jsonb_array_length(p_records) = 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO personal_records (user_id, sport, metric, value, unit, activity_id, achieved_at)
  SELECT
    p_user_id,
    (r->>'sport')::sport_type,
    r->>'metric',
    (r->>'value')::NUMERIC,
    r->>'unit',
    NULLIF(r->>'activity_id', '')::UUID,
    COALESCE((r->>'achieved_at')::TIMESTAMPTZ, NOW())
  FROM jsonb_array_elements(p_records) AS r;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

ALTER FUNCTION public.replace_personal_records(UUID, JSONB) OWNER TO postgres;
GRANT EXECUTE ON FUNCTION public.replace_personal_records(UUID, JSONB)
  TO authenticated, service_role;
