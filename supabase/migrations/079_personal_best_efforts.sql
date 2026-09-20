-- Numbered 079: the highest version on any branch or tag in this repo is 078,
-- checked at the moment this file was created rather than quoted from memory.
-- See 078's header for why reusing a lower number is silently destructive.
--
-- Cross-activity best efforts: the athlete's fastest ever 1K, 5K, 10K and the
-- rest, wherever in their training each one happened.
--
-- 078 stores one row per (activity, distance) and answers "how does THIS run
-- compare", through rank_best_efforts(p_activity_id). That is the per-run
-- question. This is the other one: "what is my best, ever, at each distance",
-- which the activity page cannot answer because it only ever looks at one
-- activity.
--
-- WHY THIS IS A FUNCTION AND NOT A SELECT
--
-- Exactly the reason migration 019 gives for latest_strength_scores: PostgREST
-- has no DISTINCT ON and no GROUP BY, so the only way to get one row per
-- distance through the query builder is to fetch every row and reduce in
-- JavaScript. A row-count limit on that fetch cannot be made safe. Ordering by
-- distance would truncate the longest distances off a prolific athlete's
-- history; ordering by time would truncate the slowest. Either way the loss is
-- silent and looks like "you have never run that far".
--
-- DISTINCT ON does it in one indexed pass and returns about twenty rows.
-- idx_best_efforts_user_sport_distance (078) is (user_id, sport,
-- distance_meters, elapsed_seconds), which is precisely this ordering.
--
-- SECURITY INVOKER, so row-level security applies and this can only ever
-- return the caller's own efforts. The explicit user_id predicate is defence
-- in depth, matching the rest of this schema.
CREATE OR REPLACE FUNCTION personal_best_efforts()
RETURNS TABLE (
  sport sport_type,
  distance_meters INTEGER,
  elapsed_seconds NUMERIC,
  activity_id UUID,
  achieved_at TIMESTAMPTZ,
  attempts INTEGER
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT DISTINCT ON (b.sport, b.distance_meters)
    b.sport,
    b.distance_meters,
    b.elapsed_seconds,
    b.activity_id,
    b.achieved_at,
    -- How many sessions contain an effort at this distance. A best drawn from
    -- one attempt is a first, not a record, and the UI says so.
    (
      SELECT COUNT(*) FROM activity_best_efforts o
      WHERE o.user_id = b.user_id
        AND o.sport = b.sport
        AND o.distance_meters = b.distance_meters
    )::INTEGER AS attempts
  FROM activity_best_efforts b
  WHERE b.user_id = auth.uid()
  -- The leading two columns must match DISTINCT ON; elapsed_seconds picks the
  -- fastest, and achieved_at breaks an exact tie in favour of the first time
  -- the athlete did it.
  ORDER BY b.sport, b.distance_meters, b.elapsed_seconds ASC, b.achieved_at ASC;
$$;

GRANT EXECUTE ON FUNCTION personal_best_efforts() TO authenticated;
