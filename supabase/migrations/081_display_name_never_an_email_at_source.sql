-- 081: reject a provider-supplied name that is an email address, at the source.
--
-- NUMBERING. 081 because 080 is the highest version on any branch or tag in
-- this repo, checked at the moment this file was written rather than quoted
-- from memory:
--   for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/tags refs/remotes); do
--     git ls-tree --name-only "$r" supabase/migrations/ | xargs -n1 basename
--   done | grep -oE '^[0-9]{3}' | sort -u | tail -1
-- This content first existed as `070_display_name_never_an_email_at_source.sql`
-- on `integrate/migration-ledger`, where its number collides with main's
-- `070_account_deletion_survives_index_sync.sql`. It is the same migration,
-- renumbered above the collision.
--
-- WHY IT IS STILL NEEDED. Production runs main's `064`, which stopped
-- `handle_new_user()` writing `NEW.email` into `display_name`. It does NOT
-- reject a `full_name` that IS an email address — and an OAuth provider is
-- free to supply one, as is anyone signing up with metadata of their choosing.
-- `display_name` is published to `anon` through `public_profiles`, so that
-- path still ends with an address on the internet.
--
-- WHAT IS TRUE RIGHT NOW. Measured 21 September 2026 through PostgREST with
-- `Prefer: count=exact`, counting only: zero rows in `profiles` and zero in
-- `public_profiles` hold a `display_name` containing "@". This closes a latent
-- path rather than an active exposure, and part 2 below is expected to update
-- nothing. That is the intended outcome, not evidence it did not run.
--
-- RE-RUNNABLE. `CREATE OR REPLACE`, an idempotent `REVOKE`/`GRANT`, and an
-- `UPDATE` whose predicate stops matching once it has run. Safe to apply twice,
-- which matters because part of this repo's history reached production through
-- the SQL editor, leaving no row in `supabase_migrations.schema_migrations`.
BEGIN;

-- ─── Part 1. Stop creating the problem ──────────────────────────────────────
--
-- Everything about this function is deliberately unchanged from 064 except the
-- provider-name rule — SECURITY DEFINER, the pinned search_path, and
-- `ON CONFLICT DO NOTHING` so a retried signup cannot fail on a row that
-- already exists.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provided_name TEXT;
BEGIN
  provided_name := NULLIF(TRIM(NEW.raw_user_meta_data->>'full_name'), '');

  IF provided_name IS NOT NULL AND provided_name LIKE '%@%' THEN
    provided_name := NULL;
  END IF;

  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, provided_name)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

-- Re-asserted rather than inherited. `CREATE OR REPLACE` keeps the existing ACL,
-- so 067's revoke survives — but a reader of this file should not have to know
-- that to be sure, and a future `DROP`/`CREATE` here would silently hand the
-- function back to `anon` under Supabase's default privileges.
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the profile row at signup. NEVER writes an email address into '
  'display_name: that column was published to anon through public_profiles, and '
  'this function wrote NEW.email into it from 007 until 064. A provider-supplied '
  'name containing "@" is discarded for the same reason — see 081.';

-- ─── Part 2. Clear what is already stored ───────────────────────────────────
--
-- In the same transaction as part 1 on purpose. Half-applied leaves either the
-- old trigger refilling a scrubbed column, or a fixed trigger with every stored
-- address still sitting in it.

UPDATE public.profiles p
   SET display_name = NULL
  FROM auth.users u
 WHERE u.id = p.user_id
   AND p.display_name IS NOT NULL
   AND lower(p.display_name) = lower(u.email);

COMMIT;
