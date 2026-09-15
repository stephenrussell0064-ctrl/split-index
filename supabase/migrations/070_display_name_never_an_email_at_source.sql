-- Stop an email address reaching `display_name`, and clear the ones already there.
--
-- WHY THIS EXISTS AS A SEPARATE MIGRATION
-- ---------------------------------------
-- Two lines of this repository solved "display_name must never be an email"
-- independently, and they solved different halves of it.
--
-- `064_display_name_is_never_an_email.sql` — the one PRODUCTION HAS RUN —
-- rewrites `handle_new_user()` to stop using `NEW.email` as a fallback, and
-- rebuilds the `public_profiles` view. It protects the exposed surface.
--
-- The other line's version of the same migration did something `064` does not:
--
--   1. it discards a provider-supplied name that is ITSELF an address, and
--   2. it scrubs rows whose stored `display_name` already equals the athlete's
--      own email.
--
-- Those are not alternatives to `064`; they are the other half. `064` stops the
-- column being *published*. This stops it being *written*, and clears what was
-- written before either fix existed. An OAuth provider that returns the email in
-- the name field walks straight back into the original bug through the branch
-- that looks safe — `full_name` — and `064` would store it.
--
-- Additive and forward-only, because `064` is already applied: this replaces the
-- function again, on top, and leaves the view `064` built alone.
--
-- WHY THE SCRUB IS AN EXACT MATCH AND NOT `LIKE '%@%'`
-- ----------------------------------------------------
-- Widening it would read as a tightening and would destroy data. "@rachelruns"
-- is a plausible chosen name, a hand-typed `display_name` has no copy anywhere
-- to restore from, and deleting somebody's chosen name to fix a bug we caused
-- would be a second wrong. The exact-match bucket is also the only recoverable
-- one: every row it nulls equalled `auth.users.email`, and that row still exists.
--
-- RUN THIS BEFORE APPLYING, AND READ THE ANSWER
-- ─────────────────────────────────────────────────────────────────────────────
-- Part 2 below is a destructive UPDATE against real rows. Know the numbers
-- first. Carried over verbatim from the migration this replaces, because the
-- counts it separates are the ones that decide whether to proceed:
-- `exposed_via_view` is the harm already done, `other_at_signs` is the data the
-- narrow predicate deliberately protects.
--
--   SELECT
--     count(*) FILTER (WHERE p.display_name IS NOT NULL)              AS have_a_name,
--     count(*) FILTER (WHERE lower(p.display_name) = lower(u.email))  AS name_is_own_email,
--     count(*) FILTER (WHERE lower(p.display_name) = lower(u.email)
--                        AND p.username IS NOT NULL)                  AS exposed_via_view,
--     count(*) FILTER (WHERE p.display_name LIKE '%@%'
--                        AND lower(p.display_name) IS DISTINCT FROM lower(u.email))
--                                                                     AS other_at_signs,
--     count(*) FILTER (WHERE lower(p.display_name) = lower(u.email)
--                        AND p.username IS NULL)                      AS not_yet_public
--   FROM public.profiles p
--   JOIN auth.users u ON u.id = p.user_id;

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
  'name containing "@" is discarded for the same reason — see 070.';

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
