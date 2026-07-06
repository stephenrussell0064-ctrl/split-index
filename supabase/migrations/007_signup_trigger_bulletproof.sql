-- Bulletproof fix for "Database error saving new user" on signup.
-- Idempotent — safe to re-run in Supabase SQL Editor or via supabase db push.
-- Covers: search_path, ON CONFLICT, trigger recreation, owner, grants.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

GRANT USAGE ON SCHEMA public TO postgres, service_role;
GRANT INSERT, SELECT, UPDATE ON public.profiles TO postgres, service_role;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Client-side fallback if trigger did not run (migration 002).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND policyname = 'Users can insert own profile'
  ) THEN
    CREATE POLICY "Users can insert own profile" ON public.profiles
      FOR INSERT WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- Backfill profiles for users created while the trigger was broken.
INSERT INTO public.profiles (user_id, display_name)
SELECT
  u.id,
  COALESCE(u.raw_user_meta_data->>'full_name', u.email)
FROM auth.users u
LEFT JOIN public.profiles p ON p.user_id = u.id
WHERE p.id IS NULL
ON CONFLICT (user_id) DO NOTHING;
