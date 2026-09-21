-- Does the live schema contain everything the migration files create?
--
-- A stand-in for `supabase db diff`, which builds a shadow database in Docker
-- and so cannot run where Docker is unavailable. Read-only: writes nothing.
--
-- Lists every table, view and function created anywhere in supabase/migrations
-- and reports the ones the database does not have.
--
-- An empty result means the schema matches the files. Rows are NOT necessarily
-- failures: an object created early and dropped by a later migration is
-- correctly absent. Check for a DROP before treating any row as a gap.
--
--   grep -liE 'drop table( if exists)? (public\.)?<name>\b' supabase/migrations/*.sql
--
-- Known, expected rows as of 21 Sep 2026:
--   training_goals, training_goal_progress  -- dropped by 055, correctly absent
--   import_jobs, integration_connections    -- 003_integrations.sql never ran;
--                                              nothing references either table
--
-- Regenerate the expected list after adding migrations:
--   grep -hoiE 'create (or replace )?(table|view|materialized view)( if not exists)? (public\.)?[a-z_0-9]+' supabase/migrations/*.sql
--   grep -hoiE 'create (or replace )?function (public\.)?[a-z_0-9]+' supabase/migrations/*.sql
WITH expected(kind, name) AS (VALUES
  ('relation', 'achievements'),
  ('relation', 'activities'),
  ('relation', 'activity_best_efforts'),
  ('relation', 'activity_comments'),
  ('relation', 'activity_reactions'),
  ('relation', 'activity_streams'),
  ('relation', 'admin_access_log'),
  ('relation', 'admin_users'),
  ('relation', 'ai_feedback'),
  ('relation', 'article9_consent_events'),
  ('relation', 'blocked_users'),
  ('relation', 'body_metrics'),
  ('relation', 'challenge_participants'),
  ('relation', 'challenges'),
  ('relation', 'content_reports'),
  ('relation', 'duels'),
  ('relation', 'friends'),
  ('relation', 'goals'),
  ('relation', 'gym_exercises'),
  ('relation', 'hpe_athlete_profile'),
  ('relation', 'hpe_feature_flags'),
  ('relation', 'hpe_findings'),
  ('relation', 'hpe_generation_events'),
  ('relation', 'hpe_injury_reports'),
  ('relation', 'hpe_intake'),
  ('relation', 'hpe_plans'),
  ('relation', 'hpe_rollout_audit'),
  ('relation', 'hpe_session_feedback'),
  ('relation', 'hpe_sessions'),
  ('relation', 'hybrid_athlete_reports'),
  ('relation', 'import_jobs'),
  ('relation', 'integration_connections'),
  ('relation', 'leaderboard_entries'),
  ('relation', 'leaderboard_profiles'),
  ('relation', 'notifications'),
  ('relation', 'personal_records'),
  ('relation', 'planned_races'),
  ('relation', 'predicted_benchmarks'),
  ('relation', 'profile_usernames'),
  ('relation', 'profiles'),
  ('relation', 'public_challenge_participation'),
  ('relation', 'public_index_history'),
  ('relation', 'public_leaderboard_entries'),
  ('relation', 'public_profiles'),
  ('relation', 'public_strength_scores'),
  ('relation', 'public_workout_scores'),
  ('relation', 'recovery_snapshots'),
  ('relation', 'reference_values'),
  ('relation', 'security_events'),
  ('relation', 'session_templates'),
  ('relation', 'sleep_logs'),
  ('relation', 'split_index_history'),
  ('relation', 'sports'),
  ('relation', 'squad_members'),
  ('relation', 'squads'),
  ('relation', 'strength_scores'),
  ('relation', 'training_goal_progress'),
  ('relation', 'training_goals'),
  ('relation', 'user_achievements'),
  ('relation', 'workout_drafts'),
  ('relation', 'workout_scores'),
  ('function', 'activity_is_visible_to'),
  ('function', 'caller_email_verified'),
  ('function', 'handle_new_user'),
  ('function', 'latest_strength_scores'),
  ('function', 'personal_best_efforts'),
  ('function', 'prune_security_events'),
  ('function', 'rank_best_efforts'),
  ('function', 'replace_personal_records'),
  ('function', 'schema_snapshot'),
  ('function', 'sync_profile_current_index'),
  ('function', 'update_updated_at'),
  ('function', 'withdraw_article9_health_data')
)
SELECT e.kind, e.name AS missing_object
FROM expected e
WHERE (e.kind = 'relation' AND to_regclass('public.' || e.name) IS NULL)
   OR (e.kind = 'function' AND NOT EXISTS (
         SELECT 1 FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = e.name))
ORDER BY 1, 2;
