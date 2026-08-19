-- ============================================================================
-- ONE-OFF BACKFILL — apply the route privacy zone to routes ALREADY STORED
-- ============================================================================
--
-- THIS FILE IS NOT A MIGRATION. It deliberately does not live in
-- supabase/migrations/ and must never be moved there: `supabase db push` runs
-- that directory in filename order, and this script rewrites real athlete data
-- irreversibly. It is run by hand, once, when you decide to.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS FOR
-- ---------------------------------------------------------------------------
-- From now on, POST /api/activities removes the first and last 200m of every
-- GPS route before writing it (see applyRoutePrivacyZone in
-- src/lib/scoring/gps-track.ts). New runs are safe the moment that ships.
--
-- Routes saved BEFORE that are not. They are still sitting in
-- activities.metadata->'route' with the athlete's doorstep as their first and
-- last coordinate, and row-level security hands an accepted friend every
-- column of a visible row — so a friend with the public anon key can read
-- those polylines directly, with no app screen involved. GPS routes have been
-- stored since 2026-08-09. This script is what closes that back-catalogue.
--
-- ---------------------------------------------------------------------------
-- WHAT IT TOUCHES
-- ---------------------------------------------------------------------------
-- Rows: `activities` where metadata ? 'route' — i.e. GPS-tracked sessions
-- only. Manual entries and gym sessions have no route key and are not read,
-- locked or rewritten.
--
-- Columns: `metadata` only, and within it only the 'route' key.
-- bodyweight_kg, exercise_notes and exercise_weight_modes are carried through
-- untouched (the rewrite is a jsonb_set / key-delete on the existing object,
-- never a replacement of it).
--
-- NOT touched, and this is the point: distance_meters, elevation_meters,
-- duration_seconds, avg_pace_seconds_per_km, every workout_scores row and
-- every split_index_history row. None of them is derived from the polyline —
-- they were computed from the raw GPS track at save time — so no athlete's
-- recorded distance, pace, elevation, score or Split Index moves by a
-- thousandth. This script changes only what a map draws.
--
-- ---------------------------------------------------------------------------
-- IT IS ONE-WAY
-- ---------------------------------------------------------------------------
-- The trimmed-off ends are gone. There is no undo, and this script
-- deliberately does not stash a copy anywhere: a backup table holding the
-- untruncated routes would be the same home addresses in the same database,
-- which is the problem, not a safety net. If you want reversibility, take it
-- before you run this, at the platform level (a Supabase PITR restore point),
-- and understand that the snapshot itself then holds the coordinates.
--
-- After this runs, athletes see the truncated route on their OWN runs too.
-- That is the intended, Strava-equivalent outcome: the data is gone, so there
-- is no owner-only view of it to serve.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN IT
-- ---------------------------------------------------------------------------
--   1. Open the Supabase SQL editor for the project (or psql against it).
--   2. Paste this whole file and run it. As shipped, STEP 3 (the UPDATE) is
--      commented out, so this first run only creates the session-local helper
--      and prints the dry run in STEP 2. Nothing is written.
--   3. Read the dry-run output. `would_lose_route_entirely` is the count of
--      runs shorter than 400m, which end up with no map at all — expect a
--      handful of mis-started recordings.
--   4. When you are happy, uncomment the UPDATE in STEP 3 and run the whole
--      file again, in ONE editor tab / ONE psql session. The helper is created
--      in pg_temp and disappears with the connection, so nothing permanent is
--      added to the schema — but it also means the UPDATE cannot be run in a
--      separate session from the CREATE FUNCTION above it.
--   Be aware: the algorithm is covered by tests on the TypeScript side
--   (src/lib/scoring/gps-track.test.ts), but this SQL transliteration of it has
--   never been executed against a database — there is no Postgres in the
--   environment it was written in. STEP 2 is your verification, and it is
--   read-only. Do not skip it.
--
--   5. Run it ONCE. Trimming is not idempotent — a second pass would shave a
--      further 200m off each end of every route it already shortened — so do
--      not re-run STEP 3 "to be sure". STEP 2 is read-only and can be re-run
--      freely to confirm the result.
--
-- ============================================================================


-- ─── STEP 1: the trimming function, mirroring applyRoutePrivacyZone ─────────
--
-- Created in pg_temp so it lives only for this connection. Same algorithm as
-- the TypeScript: cumulative distance ALONG THE PATH (never point count, never
-- a straight-line radius from the start), with the cut interpolated onto the
-- segment it falls on rather than snapped to the next stored vertex — a
-- Ramer-Douglas-Peucker-simplified route can carry a whole straight kilometre
-- as a single segment, and snapping would delete all of it.
--
-- Returns NULL when nothing publishable survives: a run shorter than twice the
-- radius is entirely inside its own privacy zone and keeps no route at all.
CREATE OR REPLACE FUNCTION pg_temp.privacy_zone_trim(
  route          jsonb,
  radius_meters  double precision DEFAULT 200,   -- keep in step with PRIVACY_ZONE_CONFIG.RADIUS_METERS
  min_retained_m double precision DEFAULT 50     -- ...and MIN_RETAINED_METERS
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  n          int;
  lat        double precision[] := '{}'::double precision[];
  lng        double precision[] := '{}'::double precision[];
  legs       double precision[] := '{}'::double precision[];
  total      double precision := 0;
  travelled  double precision;
  i          int;
  entry      jsonb;
  head_i     int := 1;
  head_f     double precision := 0;
  tail_i     int := 1;
  tail_f     double precision := 1;
  target     double precision;
  pts        jsonb[] := ARRAY[]::jsonb[];
  out_route  jsonb;
  a_lat      numeric;
  a_lng      numeric;
BEGIN
  IF route IS NULL OR jsonb_typeof(route) <> 'array' THEN
    RETURN NULL;
  END IF;

  n := jsonb_array_length(route);
  IF n < 2 THEN
    RETURN NULL;
  END IF;

  -- Unpack to 1-based arrays. Anything that is not a pair of in-range numbers
  -- makes the whole route unusable, exactly as parseRoutePolyline treats it —
  -- and the shape is checked with jsonb_typeof BEFORE any cast, so a single
  -- malformed row returns NULL instead of raising and aborting the whole
  -- UPDATE mid-batch.
  FOR i IN 1..n LOOP
    entry := route -> (i - 1);
    IF jsonb_typeof(entry) <> 'array'
       OR jsonb_array_length(entry) < 2
       OR jsonb_typeof(entry -> 0) <> 'number'
       OR jsonb_typeof(entry -> 1) <> 'number' THEN
      RETURN NULL;
    END IF;
    lat[i] := (entry ->> 0)::double precision;
    lng[i] := (entry ->> 1)::double precision;
    IF lat[i] < -90 OR lat[i] > 90 OR lng[i] < -180 OR lng[i] > 180 THEN
      RETURN NULL;
    END IF;
  END LOOP;

  -- Haversine, same 6371km earth radius as haversineDistanceMeters.
  FOR i IN 1..(n - 1) LOOP
    legs[i] := 2 * 6371000 * asin(
      least(1, sqrt(
        power(sin(radians(lat[i + 1] - lat[i]) / 2), 2)
        + cos(radians(lat[i])) * cos(radians(lat[i + 1]))
          * power(sin(radians(lng[i + 1] - lng[i]) / 2), 2)
      ))
    );
    total := total + legs[i];
  END LOOP;

  -- Swallowed whole by its own privacy zone, or reduced to a smudge.
  IF total - 2 * radius_meters < min_retained_m THEN
    RETURN NULL;
  END IF;

  -- Where the head cut falls.
  target := radius_meters;
  travelled := 0;
  head_i := n - 1;
  head_f := 1;
  FOR i IN 1..(n - 1) LOOP
    IF travelled + legs[i] >= target THEN
      head_i := i;
      head_f := CASE WHEN legs[i] = 0 THEN 0 ELSE (target - travelled) / legs[i] END;
      EXIT;
    END IF;
    travelled := travelled + legs[i];
  END LOOP;

  -- ...and the tail cut.
  target := total - radius_meters;
  travelled := 0;
  tail_i := n - 1;
  tail_f := 1;
  FOR i IN 1..(n - 1) LOOP
    IF travelled + legs[i] >= target THEN
      tail_i := i;
      tail_f := CASE WHEN legs[i] = 0 THEN 0 ELSE (target - travelled) / legs[i] END;
      EXIT;
    END IF;
    travelled := travelled + legs[i];
  END LOOP;

  -- Interpolated head, whole surviving vertices, interpolated tail. Five
  -- decimals throughout, matching ROUTE_CONFIG.COORDINATE_DECIMALS.
  a_lat := round((lat[head_i] + (lat[head_i + 1] - lat[head_i]) * head_f)::numeric, 5);
  a_lng := round((lng[head_i] + (lng[head_i + 1] - lng[head_i]) * head_f)::numeric, 5);
  -- numeric, not double precision, so the stored JSON reads 51.50018 rather
  -- than a float's shortest-round-trip rendering of the same value.
  pts := array_append(pts, jsonb_build_array(a_lat, a_lng));

  FOR i IN (head_i + 1)..tail_i LOOP
    pts := array_append(
      pts,
      jsonb_build_array(round(lat[i]::numeric, 5), round(lng[i]::numeric, 5))
    );
  END LOOP;

  a_lat := round((lat[tail_i] + (lat[tail_i + 1] - lat[tail_i]) * tail_f)::numeric, 5);
  a_lng := round((lng[tail_i] + (lng[tail_i + 1] - lng[tail_i]) * tail_f)::numeric, 5);
  pts := array_append(pts, jsonb_build_array(a_lat, a_lng));

  -- Drop consecutive duplicates (a cut landing exactly on a kept vertex).
  out_route := '[]'::jsonb;
  FOR i IN 1..array_length(pts, 1) LOOP
    IF i = 1 OR pts[i] <> pts[i - 1] THEN
      out_route := out_route || jsonb_build_array(pts[i]);
    END IF;
  END LOOP;

  IF jsonb_array_length(out_route) < 2 THEN
    RETURN NULL;
  END IF;

  RETURN out_route;
END;
$$;


-- ─── STEP 2: dry run — read-only, safe to run as often as you like ──────────
--
-- `would_lose_route_entirely` is the count of runs under ~400m, which are
-- inside their own privacy zone end to end and finish with no map. Expect a
-- handful: mis-started recordings and warm-up laps. `would_be_trimmed` is
-- everything else — those keep a shorter line.
SELECT
  count(*)                                                        AS rows_with_a_route,
  count(*) FILTER (
    WHERE pg_temp.privacy_zone_trim(metadata -> 'route') IS NULL
  )                                                               AS would_lose_route_entirely,
  count(*) FILTER (
    WHERE pg_temp.privacy_zone_trim(metadata -> 'route') IS NOT NULL
  )                                                               AS would_be_trimmed,
  min(started_at)                                                 AS oldest_route,
  max(started_at)                                                 AS newest_route
FROM activities
WHERE metadata ? 'route';

-- Eyeball a single row before and after, if you want to see the shape of it:
--
--   SELECT id,
--          jsonb_array_length(metadata -> 'route')                       AS points_before,
--          metadata -> 'route' -> 0                                      AS first_point_before,
--          pg_temp.privacy_zone_trim(metadata -> 'route') -> 0           AS first_point_after
--   FROM activities
--   WHERE metadata ? 'route'
--   ORDER BY started_at DESC
--   LIMIT 5;


-- ─── STEP 3: THE DESTRUCTIVE PART — uncomment deliberately, then run ────────
--
-- Shipped commented out on purpose. Uncomment the statement below only when
-- you have read the dry run above and accepted that the trimmed ends are gone
-- for good, for every athlete, including on their own maps.
--
-- The WHERE clause is what makes a re-run safe: `metadata ? 'route'` skips
-- everything without a route, and rows whose route is already gone (set to no
-- key by a previous run) are never revisited. Rows written by the fixed API
-- are trimmed a second time if you run this twice — which is why you run it
-- ONCE, ideally in the same deploy window as the code fix.
--
-- UPDATE activities
-- SET metadata = CASE
--       WHEN pg_temp.privacy_zone_trim(metadata -> 'route') IS NULL
--         THEN metadata - 'route'
--       ELSE jsonb_set(metadata, '{route}', pg_temp.privacy_zone_trim(metadata -> 'route'))
--     END
-- WHERE metadata ? 'route';
--
-- Expected output: `UPDATE <n>`, where n is `rows_with_a_route` from STEP 2.
