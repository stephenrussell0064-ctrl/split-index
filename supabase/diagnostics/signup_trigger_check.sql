-- Signup trigger diagnostic — run in Supabase SQL Editor (Dashboard → SQL).
-- For full simulation + SMTP decision tree, use signup_full_diagnostic.sql instead.
-- Checks why email/OAuth signup returns "Database error saving new user".

-- ─── 1. profiles table exists ────────────────────────────────────────────────
SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'profiles'
  ) THEN 'PASS' ELSE 'FAIL' END AS profiles_table,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'uuid-ossp'
  ) THEN 'PASS' ELSE 'FAIL — uuid_generate_v4() will fail on INSERT' END AS uuid_extension;

-- ─── 2. Expected profiles columns (001 + 002 + 004) ─────────────────────────
SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY ordinal_position;

SELECT
  CASE WHEN COUNT(*) FILTER (WHERE column_name = 'user_id') = 1 THEN 'PASS' ELSE 'FAIL' END AS has_user_id,
  CASE WHEN COUNT(*) FILTER (WHERE column_name = 'display_name') = 1 THEN 'PASS' ELSE 'FAIL' END AS has_display_name,
  CASE WHEN COUNT(*) FILTER (WHERE column_name = 'split_endurance_weight') = 1 THEN 'PASS' ELSE 'WARN — run migration 004' END AS has_split_weight,
  CASE WHEN COUNT(*) FILTER (WHERE column_name = 'current_split_index') = 1 THEN 'PASS' ELSE 'WARN — run migration 002' END AS has_leaderboard_cols
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles';

-- ─── 3. user_id UNIQUE constraint (required for ON CONFLICT) ─────────────────
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.profiles'::regclass
  AND contype IN ('u', 'p');

-- ─── 4. handle_new_user function ─────────────────────────────────────────────
SELECT
  p.proname AS function_name,
  pg_get_userbyid(p.proowner) AS owner,
  p.prosecdef AS security_definer,
  COALESCE(
    (SELECT option_value
     FROM pg_options_to_table(p.proconfig)
     WHERE option_name = 'search_path'),
    '(not set — LIKELY ROOT CAUSE; run migration 006 or 007)'
  ) AS search_path,
  pg_get_functiondef(p.oid) AS function_definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';

SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'handle_new_user'
  ) THEN 'PASS' ELSE 'FAIL — function missing; run 001 or 007' END AS function_exists,
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_options_to_table(p.proconfig) cfg ON cfg.option_name = 'search_path'
    WHERE n.nspname = 'public'
      AND p.proname = 'handle_new_user'
      AND cfg.option_value = 'public'
  ) THEN 'PASS' ELSE 'FAIL — search_path not set to public (run 006/007)' END AS search_path_ok;

-- ─── 5. Trigger on auth.users ────────────────────────────────────────────────
SELECT
  tgname AS trigger_name,
  tgtype,
  tgenabled AS enabled,
  pg_get_triggerdef(t.oid) AS trigger_definition
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'auth' AND c.relname = 'users' AND NOT t.tgisinternal;

SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'on_auth_user_created'
  ) THEN 'PASS' ELSE 'FAIL — trigger missing; run 001 or 007' END AS trigger_exists;

-- ─── 6. RLS policies on profiles ─────────────────────────────────────────────
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'profiles'
ORDER BY policyname;

SELECT
  relrowsecurity AS rls_enabled,
  relforcerowsecurity AS rls_forced
FROM pg_class
WHERE oid = 'public.profiles'::regclass;

SELECT
  CASE WHEN EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd = 'INSERT'
  ) THEN 'PASS' ELSE 'WARN — no INSERT policy (trigger should still work via SECURITY DEFINER)' END AS insert_policy;

-- ─── 7. Table grants (function owner needs INSERT) ───────────────────────────
SELECT
  grantee,
  privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'profiles'
ORDER BY grantee, privilege_type;

-- ─── 8. Orphaned auth.users without profiles ─────────────────────────────────
SELECT
  u.id,
  u.email,
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

-- ─── 9. Recent failed signups (duplicate user_id if trigger partially ran) ───
SELECT user_id, COUNT(*) AS profile_rows
FROM public.profiles
GROUP BY user_id
HAVING COUNT(*) > 1;

-- ─── 10. Dry-run: can postgres insert into profiles? ─────────────────────────
DO $$
DECLARE
  test_user_id UUID := gen_random_uuid();
  insert_ok BOOLEAN := FALSE;
BEGIN
  BEGIN
    INSERT INTO public.profiles (user_id, display_name)
    VALUES (test_user_id, 'diagnostic-test')
    ON CONFLICT (user_id) DO NOTHING;
    DELETE FROM public.profiles WHERE user_id = test_user_id;
    insert_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Direct INSERT test FAILED: % (SQLSTATE %)', SQLERRM, SQLSTATE;
  END;

  IF insert_ok THEN
    RAISE NOTICE 'Direct INSERT test PASS — table writable by current role';
  END IF;
END $$;
