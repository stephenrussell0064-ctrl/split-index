-- WP8 — the ten hottest queries, ready to EXPLAIN.
--
-- WHY THIS IS A SCRIPT AND NOT A MIGRATION
-- ----------------------------------------
-- The brief is explicit: "Every index added must be justified by a query plan
-- in the commit message — indexes cost write throughput, and this app is
-- write-heavy per user."
--
-- There is no database in the environment this was written in, so no plan could
-- be produced, so no index could be justified, so none was added. Adding an
-- index because it looks right is exactly what that rule forbids, and on a
-- write-heavy table an unnecessary index is a permanent tax paid on every
-- session an athlete logs.
--
-- What is left instead is the measurement, made runnable. Paste this into the
-- Supabase SQL editor against a database with real data. It produces the
-- before plans; add an index, run it again for the after.
--
-- Audit finding M12 stays OPEN until those plans exist.
--
-- READ THIS BEFORE TRUSTING THE OUTPUT
-- ------------------------------------
--   * Run it against production or a restored copy, NOT an empty development
--     database. Postgres will sequential-scan a thousand-row table whatever
--     indexes exist, because that is genuinely faster, and a plan taken on an
--     empty database says nothing about a real one.
--   * `EXPLAIN ANALYZE` EXECUTES the query. Every statement here is a SELECT,
--     so that is safe, but do not add a write to this file.
--   * Find-and-replace ATHLETE_UUID with a real user id before running. A uuid
--     that matches nothing produces a plan for the empty case, which is the case
--     that never matters. Pick a HEAVY user — the athlete with the most
--     activities — because the plan that matters is the one at the tail, not the
--     median. (It is a literal rather than a psql `\set` variable because the
--     Supabase SQL editor is not psql and does not run meta-commands.)
--   * Run `ANALYZE;` first if the statistics are stale, or the planner is
--     choosing from bad numbers and the plan is fiction.
--
-- WHAT THE AUDIT EXPECTED TO FIND (M12), so the plans can be read against it:
--
--   Already indexed, and expected to use them:
--     idx_activities_user_started     activities(user_id, started_at DESC)
--     idx_strength_scores_user_exercise
--                                     strength_scores(user_id, exercise_name,
--                                                     recorded_at DESC)
--     idx_workout_scores_user         workout_scores(user_id, created_at DESC)
--     idx_split_index_user_time       split_index_history(user_id, recorded_at DESC)
--     friends is covered in both directions — UNIQUE(user_id, friend_id) serves
--     one side, idx_friends_friend(friend_id, status) the other — so query 6's
--     inner lookup should be two index scans and the interesting cost is what
--     the outer activities scan does with the resulting id list.
--
--   Suspected gaps, expected to show sequential scans:
--     gym_exercises  has only idx_gym_exercises_activity(activity_id) and no
--                    user_id column at all, so every per-athlete set history is
--                    a join through activities. Query 4 is the one to watch.
--
-- THE BRACKET INDEX IS PROBABLY NOT DOING WHAT IT LOOKS LIKE
-- ---------------------------------------------------------
-- Migration 056 added two partial indexes on `profiles`:
--
--   idx_profiles_bracket_split (current_split_index DESC)
--     WHERE username IS NOT NULL AND current_split_index IS NOT NULL
--   idx_profiles_bracket_keys  (country, weight_kg, age)
--     WHERE username IS NOT NULL
--
-- The first should serve the ORDER BY in queries 8 and 9. The second is the
-- doubtful one, and query 9 exists to settle it. It indexes the RAW columns,
-- but `leaderboard_profiles` exposes BANDS computed by CASE expressions over
-- them — and `age_band` is computed not from `profiles.age` but from a LATERAL
-- that prefers `date_part('year', age(date_of_birth))` whenever a date of birth
-- is set. So `WHERE age_band = '25-34'` is a filter on an expression the index
-- does not contain, and for any athlete with a date of birth the indexed column
-- is not even the input.
--
-- If the plan for query 9 never names idx_profiles_bracket_keys, the honest
-- outcomes are: DROP it (it is costing every profile write for nothing), or
-- replace it with an expression index matching the view's CASE arms exactly.
-- Leaving it in place because it was added with good intentions is the one
-- option the brief rules out.

-- ─── 1. The logbook: an athlete's sessions, newest first ────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, sport, started_at, duration_seconds, distance_meters
  FROM activities
 WHERE user_id = 'ATHLETE_UUID'::uuid AND is_draft = false
 ORDER BY started_at DESC
 LIMIT 50;

-- ─── 2. The dashboard's index history window ────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT split_index, endurance_index, strength_index, recorded_at
  FROM split_index_history
 WHERE user_id = 'ATHLETE_UUID'::uuid
   AND recorded_at >= NOW() - INTERVAL '365 days'
 ORDER BY recorded_at ASC
 LIMIT 400;

-- ─── 3. Recent load, for ACWR and the injury risk index ─────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT load_score, created_at
  FROM workout_scores
 WHERE user_id = 'ATHLETE_UUID'::uuid
 ORDER BY created_at DESC
 LIMIT 50;

-- ─── 4. The adaptive 1RM walk — the audit's prime suspect ───────────────────
-- Reads the full history for one lift. gym_exercises has no user_id, so this
-- is a join through activities on every call.
EXPLAIN (ANALYZE, BUFFERS)
SELECT ge.exercise_name, ge.weight_kg, ge.reps, ge.set_details, a.started_at
  FROM gym_exercises ge
  JOIN activities a ON a.id = ge.activity_id
 WHERE a.user_id = 'ATHLETE_UUID'::uuid
   AND ge.exercise_name = 'Back Squat'
 ORDER BY a.started_at DESC;

-- ─── 5. All-time best per lift ──────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT exercise_name, MAX(estimated_1rm_kg) AS best
  FROM strength_scores
 WHERE user_id = 'ATHLETE_UUID'::uuid
 GROUP BY exercise_name;

-- ─── 6. The social feed: friends' recent sessions ───────────────────────────
-- Runs the activity_is_visible_to() predicate per row, so watch its cost as
-- well as the scan.
EXPLAIN (ANALYZE, BUFFERS)
SELECT a.id, a.sport, a.started_at
  FROM activities a
 WHERE a.user_id IN (
         SELECT CASE WHEN f.user_id = 'ATHLETE_UUID'::uuid THEN f.friend_id ELSE f.user_id END
           FROM friends f
          WHERE f.status = 'accepted'
            AND (f.user_id = 'ATHLETE_UUID'::uuid OR f.friend_id = 'ATHLETE_UUID'::uuid)
       )
   AND a.is_draft = false
 ORDER BY a.started_at DESC
 LIMIT 15;

-- ─── 7. The public profile page ─────────────────────────────────────────────
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM public_profiles WHERE username = 'someone';

-- ─── 8. The leaderboard's candidate fetch ───────────────────────────────────
-- 500 rows ordered by index. leaderboard_profiles is a view over profiles.
EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, username, current_split_index, age_band, weight_band, sex
  FROM leaderboard_profiles
 WHERE current_split_index IS NOT NULL
 ORDER BY current_split_index DESC
 LIMIT 500;

-- ─── 9. The bracket filter ──────────────────────────────────────────────────
-- Filters on three computed CASE expressions. See the header: if this plan does
-- not name idx_profiles_bracket_keys, that index is pure write cost and should
-- be dropped or rebuilt as an expression index.
EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, current_split_index
  FROM leaderboard_profiles
 WHERE sex = 'male' AND age_band = '25-34' AND weight_band = '80-90kg'
 ORDER BY current_split_index DESC
 LIMIT 50;

-- ─── 10. The By Exercise board ──────────────────────────────────────────────
-- 2000 rows across every athlete for one lift.
EXPLAIN (ANALYZE, BUFFERS)
SELECT user_id, estimated_1rm_kg
  FROM public_strength_scores
 WHERE exercise_name = 'Back Squat'
 ORDER BY estimated_1rm_kg DESC
 LIMIT 2000;

-- ─── Unused indexes, while you are here ─────────────────────────────────────
-- The other half of WP8: an index nobody reads still costs every write. Run
-- this after the app has been live for long enough for the counters to mean
-- something (pg_stat_user_indexes resets on restart).
SELECT schemaname, relname AS table_name, indexrelname AS index_name,
       idx_scan AS times_used, pg_size_pretty(pg_relation_size(indexrelid)) AS size
  FROM pg_stat_user_indexes
 WHERE schemaname = 'public'
 ORDER BY idx_scan ASC, pg_relation_size(indexrelid) DESC;
