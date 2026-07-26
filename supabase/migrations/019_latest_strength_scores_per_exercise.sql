-- The analytics page's adaptive-1RM panel previously fetched only the most
-- recent 200 strength_scores rows (across ALL exercises combined) and
-- de-duplicated client-side to one row per exercise. For anyone who trains
-- a wide variety of exercises, that row-count cap can silently drop lifts
-- that haven't been trained recently, even though real historical data
-- exists for them — user feedback: "I want the adaptive 1RM... to be for
-- every lift which has had numbers entered into at some point."
--
-- Postgrest's query builder has no DISTINCT ON / GROUP BY equivalent, so a
-- row-count-limited .select() can never guarantee full coverage regardless
-- of how high the limit is set. This function returns exactly one (the
-- most recent) row per exercise_name for the calling user, however much
-- history exists. SECURITY INVOKER (the default, made explicit) runs with
-- the caller's own permissions, so existing RLS policies on strength_scores
-- still apply — a user can only ever see their own rows through this.
CREATE OR REPLACE FUNCTION latest_strength_scores(p_user_id uuid)
RETURNS TABLE (
  exercise_name text,
  estimated_1rm_kg numeric,
  score_breakdown jsonb,
  recorded_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT DISTINCT ON (exercise_name)
    exercise_name, estimated_1rm_kg, score_breakdown, recorded_at
  FROM strength_scores
  WHERE user_id = p_user_id
  ORDER BY exercise_name, recorded_at DESC;
$$;
