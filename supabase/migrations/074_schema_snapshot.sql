-- 074: Let the repository ask the database what it actually looks like.
--
-- WHY THIS EXISTS
-- ---------------
-- Every schema guard in this codebase reads the migration files. All of them
-- would have gone on passing forever through three separate production
-- defects, because in each case the SQL in the repository was correct and the
-- database did not match it:
--
--   056 dropped the policies that let anyone read profiles, workout_scores and
--   split_index_history. It was never applied. The VIEWS from the same
--   migration were present, because 061 and 064 recreate them, so the app
--   looked like it was reading through curated projections while the base
--   tables sat open behind them — every column of profiles, including
--   date_of_birth, weight_kg, max_hr and stripe_customer_id, to anyone with
--   the key that ships in the client bundle.
--
--   064 dropped public_profiles with CASCADE and recreated two of the six
--   views it took down. The other four simply stopped existing, and the whole
--   social surface read from them.
--
--   064 also recreated leaderboard_profiles restating only its GRANT, so
--   Supabase's ALTER DEFAULT PRIVILEGES handed it back to anon.
--
-- Two of those three were found by accident. The thing none of them could be
-- caught by is a test that reads SQL, because the SQL was right. What is
-- missing is a way to compare the repository against the database, and that
-- needs the database to be able to describe itself.
--
-- WHAT IT RETURNS: names and booleans. Views, policies, whether RLS is on, and
-- whether anon and authenticated can SELECT each relation or EXECUTE each
-- function. No row data of any kind, and no ability to ask for any — it takes
-- no arguments, so there is nothing to inject.
--
-- SECURITY INVOKER, DELIBERATELY, and this is the interesting choice. The
-- reflex for an introspection helper is SECURITY DEFINER, and it would be
-- wrong here: everything below reads pg_catalog and information_schema, which
-- every role may already read. DEFINER would add privilege this function does
-- not need, in a repository where the wrong grant on a function has now been
-- the finding twice. The caller is service_role, which can already see all of
-- this. So the function borrows nothing.
--
-- Read by scripts/check-schema-drift.mjs.

CREATE OR REPLACE FUNCTION public.schema_snapshot()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $$
  SELECT jsonb_build_object(
    'views', (
      SELECT COALESCE(jsonb_agg(v.viewname ORDER BY v.viewname), '[]'::jsonb)
      FROM pg_views v
      WHERE v.schemaname = 'public'
    ),
    'policies', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('table', p.tablename, 'name', p.policyname)
          ORDER BY p.tablename, p.policyname
        ),
        '[]'::jsonb
      )
      FROM pg_policies p
      WHERE p.schemaname = 'public'
    ),
    'rls', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object('table', c.relname, 'enabled', c.relrowsecurity)
          ORDER BY c.relname
        ),
        '[]'::jsonb
      )
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r'
    ),
    -- Tables and views together: the grant defect this is here to catch does
    -- not care which it is, and neither does an athlete's data.
    'table_grants', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'object', g.relname,
            'role', g.role,
            'can_select', has_table_privilege(g.role, g.oid, 'SELECT')
          )
          ORDER BY g.relname, g.role
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT c.oid, c.relname, r.role
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
        WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v')
      ) g
    ),
    'function_grants', (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'function', g.proname,
            'role', g.role,
            'can_execute', has_function_privilege(g.role, g.oid, 'EXECUTE')
          )
          ORDER BY g.proname, g.role
        ),
        '[]'::jsonb
      )
      FROM (
        SELECT p.oid, p.proname, r.role
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        CROSS JOIN (VALUES ('anon'), ('authenticated')) AS r(role)
        WHERE n.nspname = 'public'
      ) g
    )
  );
$$;

-- Revoked from PUBLIC **and** by name, because a revoke aimed at PUBLIC alone
-- does not remove the grant Supabase's ALTER DEFAULT PRIVILEGES gives anon at
-- creation. That is the same defect this function exists to detect, and it
-- would be a poor joke to reintroduce it here.
REVOKE ALL ON FUNCTION public.schema_snapshot() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_snapshot() TO service_role;

-- Verify:
--   SELECT jsonb_pretty(public.schema_snapshot());
