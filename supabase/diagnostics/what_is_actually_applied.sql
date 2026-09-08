-- READ-ONLY. Nothing here changes anything; run the whole file and send back
-- the three result sets.
--
-- Why this exists: the anon key can no longer tell me what is true. Every
-- probe I can run from outside answers the same way whether a view is missing
-- or merely unreadable, and one migration that should have removed public
-- read access appears never to have been applied. These three queries answer
-- both questions from inside the database, where the answer is not ambiguous.

-- 1. WHICH OF THE SIX PROJECTIONS EXIST, AND WHO CAN READ THEM.
--
-- Expected after 070: all six present. anon TRUE for public_profiles only —
-- it is the one view the logged-out profile page needs. anon FALSE for the
-- other five, authenticated TRUE for all six.
SELECT
  v.viewname,
  has_table_privilege('anon',          'public.' || v.viewname, 'SELECT') AS anon_can_read,
  has_table_privilege('authenticated', 'public.' || v.viewname, 'SELECT') AS authed_can_read
FROM pg_views v
WHERE v.schemaname = 'public'
  AND v.viewname IN (
    'public_profiles',
    'leaderboard_profiles',
    'public_strength_scores',
    'public_workout_scores',
    'public_index_history',
    'public_leaderboard_entries'
  )
ORDER BY v.viewname;

-- 2. THE POLICIES MIGRATION 056 WAS WRITTEN TO REMOVE.
--
-- Expected: ZERO ROWS. Each of these grants public read on a base table, and
-- 056 drops all five — that migration exists for no other reason. Any row
-- returned here is a table the anon role can read directly, around the curated
-- views entirely.
SELECT tablename, policyname, roles::text, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND policyname IN (
    'Public profiles readable',
    'Public leaderboard strength scores',
    'Public leaderboard scores',
    'Public leaderboard index',
    'Public challenge progress',
    'Anyone can view leaderboards'
  )
ORDER BY tablename, policyname;

-- 3. WHAT THE ANON ROLE CAN READ FROM THE BASE TABLES.
--
-- The privilege and the policy are separate gates and both have to be shut.
-- `rls_enabled` FALSE on any of these would mean policies are not consulted at
-- all, which no migration intends.
SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  has_table_privilege('anon', 'public.' || c.relname, 'SELECT') AS anon_has_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'profiles',
    'workout_scores',
    'split_index_history',
    'strength_scores',
    'leaderboard_entries',
    'activities'
  )
ORDER BY c.relname;
