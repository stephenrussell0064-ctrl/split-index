-- Signup full diagnostic — run in Supabase SQL Editor (Dashboard → SQL).
-- Use after signup returns HTTP 500 / "Something went wrong on our side."
--
-- Decision tree (read results bottom-up):
--   Section A fails  → DB/trigger issue (apply migration 007/008, check Postgres logs)
--   Section A passes → likely SMTP/email (Auth logs: "gomail", "confirmation email")
--   Section C orphans → delete stale auth.users row before retry
--
-- Also check: Dashboard → Logs → Auth (filter path=/signup, status=500)
--             Dashboard → Logs → Postgres (filter supabase_auth_admin errors)

-- ═══════════════════════════════════════════════════════════════════════════════
-- A. profiles schema — NOT NULL columns, defaults, constraints
-- ═══════════════════════════════════════════════════════════════════════════════

-- A1. Every column on profiles (compare to migrations 001 + 002 + 004)
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

-- A2. NOT NULL columns WITHOUT a default — trigger MUST supply these on INSERT
--     Expected after 001–004: only user_id (trigger supplies it).
--     FAIL if split_endurance_weight appears here without column_default.
SELECT
  column_name,
  data_type,
  'REQUIRES EXPLICIT VALUE IN TRIGGER' AS impact
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND is_nullable = 'NO'
  AND column_default IS NULL
ORDER BY column_name;

-- A3. Foreign keys on profiles
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND contype = 'f';

-- A4. Unique / primary constraints (ON CONFLICT (user_id) needs UNIQUE on user_id)
SELECT
  conname AS constraint_name,
  contype,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND contype IN ('u', 'p');

-- A5. Migration 004 sanity — split_endurance_weight must exist with DEFAULT
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'split_endurance_weight'
  ) THEN 'PASS' ELSE 'FAIL — run migration 004_split_weighting.sql' END AS has_split_weight_col,
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'split_endurance_weight'
      AND is_nullable = 'NO'
      AND column_default IS NOT NULL
  ) THEN 'PASS' ELSE 'FAIL — split_endurance_weight NOT NULL without DEFAULT breaks INSERT' END AS split_weight_default_ok;

-- ═══════════════════════════════════════════════════════════════════════════════
-- B. handle_new_user trigger + ALL triggers on auth.users / profiles
-- ═══════════════════════════════════════════════════════════════════════════════

-- B1. Function definition (expect SECURITY DEFINER + search_path = public)
SELECT
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  COALESCE(
    (SELECT option_value FROM pg_options_to_table(p.proconfig) WHERE option_name = 'search_path'),
    '(NOT SET — run migration 006 or 007)'
  ) AS search_path,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

-- B2. ALL non-internal triggers on auth.users (expect exactly on_auth_user_created)
SELECT
  n.nspname AS schema,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  t.tgenabled AS enabled,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth'
  AND c.relname = 'users'
  AND NOT t.tgisinternal
ORDER BY t.tgname;

-- B3. Triggers on public.profiles (expect profiles_updated_at BEFORE UPDATE only)
SELECT
  t.tgname AS trigger_name,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname = 'profiles'
  AND NOT t.tgisinternal;

-- B4. RLS + grants
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY policyname;

SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY grantee, privilege_type;

-- ═══════════════════════════════════════════════════════════════════════════════
-- C. Orphaned / stuck users (signup failed mid-flight or email never confirmed)
-- ═══════════════════════════════════════════════════════════════════════════════

-- C1. auth.users without a profile row (trigger never succeeded)
SELECT
  u.id,
  u.email,
  u.email_confirmed_at,
  u.created_at
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at DESC
LIMIT 20;

SELECT COUNT(*) AS orphaned_users_without_profile
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.id IS NULL;

-- C2. Duplicate profile rows per user_id (should be empty)
SELECT user_id, COUNT(*) AS profile_rows
FROM public.profiles
GROUP BY user_id
HAVING COUNT(*) > 1;

-- C3. Users who exist but never confirmed (blocks retry with confusing errors)
SELECT
  u.id,
  u.email,
  u.email_confirmed_at IS NULL AS awaiting_confirmation,
  u.created_at,
  p.id IS NOT NULL AS has_profile
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE u.email_confirmed_at IS NULL
ORDER BY u.created_at DESC
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════════
-- D. Live INSERT tests — exact errors Postgres returns
-- ═══════════════════════════════════════════════════════════════════════════════

-- D1. Direct profiles INSERT (no FK) — tests table defaults / NOT NULL / uuid-ossp
DO $$
DECLARE
  test_user_id UUID := gen_random_uuid();
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (test_user_id, 'diagnostic-no-fk-test');
    DELETE FROM public.profiles WHERE user_id = test_user_id;
    RAISE NOTICE 'D1 PASS: profiles INSERT without FK succeeded (defaults OK)';
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D1 FAIL: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;
END $$;

-- D2. profiles INSERT with real auth.users FK (pick newest orphan or any user)
DO $$
DECLARE
  real_user_id UUID;
  real_email TEXT;
BEGIN
  SELECT u.id, u.email INTO real_user_id, real_email
  FROM auth.users u
  ORDER BY u.created_at DESC
  LIMIT 1;

  IF real_user_id IS NULL THEN
    RAISE NOTICE 'D2 SKIP: no auth.users rows to test against';
    RETURN;
  END IF;

  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (real_user_id, COALESCE(real_email, 'diagnostic-fk-test'))
    ON CONFLICT (user_id) DO NOTHING;
    RAISE NOTICE 'D2 PASS: profiles INSERT with FK for user % succeeded', real_user_id;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'D2 FAIL for user %: % (SQLSTATE %)', real_user_id, SQLERRM, SQLSTATE;
  END;
END $$;

-- D3. Simulate full signup path — INSERT auth.users + trigger, then ROLLBACK
--     Shows the EXACT error the trigger raises during real signup.
--     Replace test email before running; use a unique address each time.
DO $$
DECLARE
  test_id UUID := gen_random_uuid();
  test_email TEXT := 'signup-diagnostic+' || replace(test_id::text, '-', '') || '@example.com';
BEGIN
  BEGIN
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      confirmation_token,
      recovery_token,
      email_change_token_new,
      email_change,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      test_id,
      'authenticated',
      'authenticated',
      test_email,
      crypt('diagnostic-test-password', gen_salt('bf')),
      NULL,
      '',
      '',
      '',
      '',
      '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb,
      NOW(),
      NOW()
    );

    IF EXISTS (SELECT 1 FROM public.profiles WHERE user_id = test_id) THEN
      RAISE NOTICE 'D3 PASS: trigger created profile for %', test_email;
    ELSE
      RAISE NOTICE 'D3 WARN: auth.users row created but NO profile row — trigger missing or silent failure';
    END IF;

    RAISE EXCEPTION 'diagnostic_rollback'; -- always undo test user
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM = 'diagnostic_rollback' THEN
        RAISE NOTICE 'D3 PASS (rolled back test user %)', test_email;
      ELSE
        RAISE NOTICE 'D3 FAIL — this is likely the production signup error: % (SQLSTATE %)', SQLERRM, SQLSTATE;
      END IF;
      RAISE NOTICE 'D3 hint: if SQLSTATE 23503, FK issue; 42501 permission; 23502 NOT NULL; 42P01 missing relation';
  END;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════════
-- E. Quick pass/fail summary
-- ═══════════════════════════════════════════════════════════════════════════════

SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN 'PASS' ELSE 'FAIL' END AS profiles_table,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
  ) THEN 'PASS' ELSE 'FAIL' END AS uuid_ossp_extension,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_options_to_table(p.proconfig) cfg ON cfg.option_name = 'search_path'
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND cfg.option_value = 'public'
  ) THEN 'PASS' ELSE 'FAIL' END AS trigger_search_path,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'on_auth_user_created'
  ) THEN 'PASS' ELSE 'FAIL' END AS on_auth_user_created_trigger,
  (
    SELECT COUNT(*)::text || ' orphan(s)'
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.user_id = u.id
    WHERE p.id IS NULL
  ) AS orphaned_users;

-- ═══════════════════════════════════════════════════════════════════════════════
-- F. Cleanup helpers (run manually after reviewing C1/C3 — DESTRUCTIVE)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Delete a stuck test/failed signup so email can be reused:
-- DELETE FROM auth.users WHERE email = 'user@example.com';

-- Or delete by id from C1/C3 results:
-- DELETE FROM auth.users WHERE id = 'uuid-here';

-- ═══════════════════════════════════════════════════════════════════════════════
-- G. Log Explorer queries (Dashboard → Logs → paste in Log Explorer, not SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Auth 500s on signup:
-- select cast(metadata.timestamp as datetime) as timestamp, msg, event_message, status, path, level
-- from auth_logs cross join unnest(metadata) as metadata
-- where path = '/signup' and (status::INT = 500 or regexp_contains(level, 'error'))
-- order by timestamp desc limit 50;

-- Postgres errors from auth admin (trigger failures):
-- select cast(postgres_logs.timestamp as datetime) as timestamp, event_message,
--        parsed.detail, parsed.hint, parsed.sql_state_code, parsed.query
-- from postgres_logs cross join unnest(metadata) as metadata
-- cross join unnest(metadata.parsed) as parsed
-- where regexp_contains(parsed.error_severity, 'ERROR|FATAL')
--   and regexp_contains(parsed.user_name, 'supabase_auth_admin')
-- order by timestamp desc limit 50;
