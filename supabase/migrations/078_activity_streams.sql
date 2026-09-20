-- Numbered 078 on purpose, not 065.
--
-- Production follows main's migration sequence, where 065 is already applied
-- as 065_replace_personal_records_atomically.sql. Supabase records applied
-- migrations by that leading version number, so a file reusing 065 is read as
-- already-done and skipped in silence — this schema would never be created,
-- and the failure would surface as a missing column at runtime rather than as
-- a failed push. 076-078 is free on every branch and tag in the repo.
--
-- Do not renumber this down to follow this branch's own 062. That sequence is
-- itself a renumbering of migrations already applied to production under
-- different numbers, which the submission runbook defers to after approval.

-- Run analysis: per-sample streams and best efforts for GPS-tracked sessions.
--
-- Until now a GPS run persisted only its summary (distance, duration, average
-- pace, total climb, average/max heart rate) and a privacy-trimmed route
-- polyline. The raw fixes, the altitude trace and every heart-rate reading
-- were discarded on submit, so nothing per-kilometre — splits, a pace chart,
-- heart rate over the run, fastest 5K inside a 10K — could ever be shown.
--
-- Two tables, both owner-only:
--
--  activity_streams      One row per activity holding the compacted sample
--                        series (moving seconds, cumulative metres, altitude,
--                        heart rate, cadence) as JSONB, in the shape
--                        lib/analysis/streams.ts documents. Read only by the
--                        activity detail page, so the row size (tens of KB
--                        for a typical run) is never on a list path.
--
--  activity_best_efforts One row per (activity, standard distance): the
--                        fastest stretch of that length inside the run. This
--                        is what makes "your fastest 5K ever" a single indexed
--                        lookup across every run rather than a rescan of every
--                        stream.
--
-- DELIBERATELY NOT in activities.metadata. That column is readable in full by
-- any accepted friend (031_social_activity_feed.sql grants a visible row's
-- every column), which is why the route polyline stored there is trimmed at
-- both ends before it is written. A full-resolution time series would undo
-- that: it carries the athlete's exact position over time, front door
-- included. These tables have their own row-level security and no friend
-- policy, so streams are visible to their owner and nobody else.

CREATE TABLE IF NOT EXISTS activity_streams (
  activity_id UUID PRIMARY KEY REFERENCES activities(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sample_count INTEGER NOT NULL CHECK (sample_count >= 2),
  streams JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_streams_user ON activity_streams(user_id);

CREATE TABLE IF NOT EXISTS activity_best_efforts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  sport sport_type NOT NULL,
  -- Whole metres. 1609 for a mile, 21097 for a half — the analysis module
  -- owns the canonical list and rounds the same way on read and write.
  distance_meters INTEGER NOT NULL CHECK (distance_meters > 0),
  elapsed_seconds NUMERIC(9,1) NOT NULL CHECK (elapsed_seconds > 0),
  -- Where in the run the effort began, in moving seconds — so the detail page
  -- can say "your fastest mile was km 3-4".
  start_offset_seconds NUMERIC(9,1) NOT NULL DEFAULT 0,
  -- The activity's own start time, copied here so "beat your previous best"
  -- is a comparison against efforts that came BEFORE this run, not against
  -- runs logged later with an earlier date.
  achieved_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (activity_id, distance_meters)
);

-- The lookup behind every personal-best question: all of this athlete's
-- efforts at one distance in one sport, fastest first.
CREATE INDEX IF NOT EXISTS idx_best_efforts_user_sport_distance
  ON activity_best_efforts(user_id, sport, distance_meters, elapsed_seconds);

ALTER TABLE activity_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_best_efforts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own activity streams" ON activity_streams;
CREATE POLICY "Users manage own activity streams" ON activity_streams
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users manage own best efforts" ON activity_best_efforts;
CREATE POLICY "Users manage own best efforts" ON activity_best_efforts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- How one run's best efforts stand against everything else the athlete has
-- recorded at the same distance in the same sport. One call per detail-page
-- view instead of one query per distance; SECURITY INVOKER so row-level
-- security applies and the function can only ever rank the caller's own rows.
--
--  rank                          1 = the fastest ever (ties share a rank).
--  attempts                      How many runs have an effort at this distance.
--  best_*                        The all-time best, which may be this run.
--  previous_best_elapsed_seconds The best from runs BEFORE this one, or NULL
--                                when this is the first — what a new record
--                                is measured against.
CREATE OR REPLACE FUNCTION rank_best_efforts(p_activity_id UUID)
RETURNS TABLE (
  distance_meters INTEGER,
  elapsed_seconds NUMERIC,
  rank INTEGER,
  attempts INTEGER,
  best_elapsed_seconds NUMERIC,
  best_activity_id UUID,
  best_achieved_at TIMESTAMPTZ,
  previous_best_elapsed_seconds NUMERIC
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT
    m.distance_meters,
    m.elapsed_seconds,
    (
      SELECT COUNT(*) + 1 FROM activity_best_efforts o
      WHERE o.user_id = m.user_id AND o.sport = m.sport
        AND o.distance_meters = m.distance_meters
        AND o.elapsed_seconds < m.elapsed_seconds
    )::INTEGER AS rank,
    (
      SELECT COUNT(*) FROM activity_best_efforts o
      WHERE o.user_id = m.user_id AND o.sport = m.sport
        AND o.distance_meters = m.distance_meters
    )::INTEGER AS attempts,
    b.elapsed_seconds AS best_elapsed_seconds,
    b.activity_id AS best_activity_id,
    b.achieved_at AS best_achieved_at,
    (
      SELECT MIN(o.elapsed_seconds) FROM activity_best_efforts o
      WHERE o.user_id = m.user_id AND o.sport = m.sport
        AND o.distance_meters = m.distance_meters
        AND o.activity_id <> m.activity_id
        AND o.achieved_at < m.achieved_at
    ) AS previous_best_elapsed_seconds
  FROM activity_best_efforts m
  CROSS JOIN LATERAL (
    SELECT o.elapsed_seconds, o.activity_id, o.achieved_at
    FROM activity_best_efforts o
    WHERE o.user_id = m.user_id AND o.sport = m.sport
      AND o.distance_meters = m.distance_meters
    ORDER BY o.elapsed_seconds ASC, o.achieved_at ASC
    LIMIT 1
  ) b
  WHERE m.activity_id = p_activity_id AND m.user_id = auth.uid()
  ORDER BY m.distance_meters;
$$;

GRANT EXECUTE ON FUNCTION rank_best_efforts(UUID) TO authenticated;
