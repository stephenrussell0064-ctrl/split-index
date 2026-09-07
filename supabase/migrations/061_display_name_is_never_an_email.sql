-- N10 — stop writing athletes' email addresses into a publicly readable column,
-- and remove the ones already there.
--
-- WHAT WAS WRONG
-- --------------
-- `profiles.display_name` is the athlete's public name. It is rendered by the
-- leaderboards, the dimension boards, the activity feed, the friends and squad
-- queries, and both share-card routes — and it is one of the twelve columns
-- migration 056 publishes through `public_profiles`, which is granted to
-- `anon`.
--
-- Two things wrote an email address into it.
--
--   1. Onboarding, for every email/password signup:
--        display_name: user_metadata?.full_name ?? user.email ?? null
--      Fixed in the application on 2026-09-07 (commit 8623658), which also
--      added `publicDisplayName` to hide stored addresses at every render site.
--
--   2. `handle_new_user()`, which is NOT fixed and is what this migration is
--      for. See 007:14-18 — unchanged since it was written:
--
--        INSERT INTO public.profiles (user_id, display_name)
--        VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
--
--      It fires on `auth.users` INSERT, which is signup — BEFORE onboarding
--      runs. So the application fix covers everyone who reaches the onboarding
--      step and nobody who abandons it, and leaves a window for everyone else.
--
-- WHY THE APPLICATION FIX IS NOT ENOUGH ON ITS OWN
-- -----------------------------------------------
-- `publicDisplayName` is TypeScript. PostgREST is not. `public_profiles` is
-- `GRANT SELECT ... TO anon`, and `NEXT_PUBLIC_SUPABASE_ANON_KEY` ships in the
-- client bundle by design, so anybody can issue
--
--   GET /rest/v1/public_profiles?select=display_name
--
-- and read every stored address without touching a line of our code. A guard
-- that lives in the render path cannot defend a column the database publishes.
-- That is the same lesson as 058: the only place a rule about rows binds is the
-- database.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- RUN THIS BEFORE APPLYING, AND READ THE ANSWER
-- ─────────────────────────────────────────────────────────────────────────────
-- Part 2 below is a destructive UPDATE against real rows. Know the numbers
-- first.
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
--
-- `exposed_via_view` is the number that matters — `public_profiles` filters on
-- `username IS NOT NULL`, so those are the addresses readable from the internet
-- right now. `not_yet_public` rows are people who abandoned onboarding: their
-- address is in the table but out of the view until they pick a username, so
-- they are not exposed yet and are cleaned here anyway.
--
-- If `other_at_signs` is greater than zero, LOOK AT THOSE ROWS BEFORE RUNNING
-- PART 2 — and note that Part 2 deliberately does not touch them:
--
--   SELECT p.user_id, p.username, p.display_name
--     FROM public.profiles p
--     JOIN auth.users u ON u.id = p.user_id
--    WHERE p.display_name LIKE '%@%'
--      AND lower(p.display_name) IS DISTINCT FROM lower(u.email);

BEGIN;

-- ─── Part 1. Stop creating the problem ──────────────────────────────────────
--
-- The `NEW.email` fallback is gone. If the identity provider gave us a name we
-- use it; otherwise the column stays NULL and every render site falls back to
-- the username the athlete chooses during onboarding — which is the name they
-- picked to be known by, and the behaviour the application already has.
--
-- The provider-supplied name is also rejected when it is itself an address.
-- Some OAuth providers return the email in the name field, which would walk
-- straight back into the bug through the branch that looks safe. Same rule as
-- `publicDisplayName` in the application: no "@", no name.
--
-- Everything else about this function is deliberately unchanged from 007 —
-- SECURITY DEFINER, the pinned search_path, and `ON CONFLICT DO NOTHING` so a
-- retried signup cannot fail on a row that already exists.

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
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates the profile row at signup. NEVER writes an email address into '
  'display_name: that column is published to anon through public_profiles, and '
  'this function wrote NEW.email into it from 007 until 061. A provider-supplied '
  'name containing "@" is discarded for the same reason.';

-- ─── Part 2. Remove the addresses already stored ────────────────────────────
--
-- Scoped to rows where the stored name IS the athlete's own address, rather
-- than anything containing "@". That is exactly the defect — we wrote their
-- address there without asking — and nothing else.
--
-- The broader `LIKE '%@%'` predicate was rejected on purpose. A name like
-- "@rachelruns" is a plausible thing to choose, and this is a one-way write:
-- there is no copy of a hand-typed display_name anywhere to restore from.
-- Deleting somebody's chosen name to fix a bug we caused would be a second
-- wrong. The impact query above surfaces those rows for a human instead.
--
-- This bucket IS recoverable, which is the other reason to prefer it: every row
-- it nulls held a value equal to `auth.users.email`, and that row still exists.

UPDATE public.profiles p
   SET display_name = NULL
  FROM auth.users u
 WHERE u.id = p.user_id
   AND p.display_name IS NOT NULL
   AND lower(p.display_name) = lower(u.email);

COMMIT;

-- ─── Run this AFTER applying ────────────────────────────────────────────────
-- Both counts must be zero. The second is the one that says the exposure is
-- actually closed rather than merely narrowed.
--
--   SELECT
--     count(*) FILTER (WHERE lower(p.display_name) = lower(u.email)) AS still_own_email,
--     count(*) FILTER (WHERE lower(p.display_name) = lower(u.email)
--                        AND p.username IS NOT NULL)                 AS still_exposed
--   FROM public.profiles p
--   JOIN auth.users u ON u.id = p.user_id;
--
-- Then confirm the trigger no longer reintroduces it, on a throwaway account:
--
--   SELECT p.display_name IS NULL AS clean
--     FROM public.profiles p JOIN auth.users u ON u.id = p.user_id
--    WHERE u.email = '<the address you just signed up with>';

-- ─── What this migration deliberately does NOT do ───────────────────────────
--
-- 1. It does not add a CHECK constraint forbidding "@" in display_name.
--    The constraint would be evaluated inside `handle_new_user()`'s INSERT, so
--    one unexpected provider payload would fail the signup trigger and take
--    down account creation entirely. Turning a privacy defect into an outage is
--    a worse trade than the one it fixes.
--
-- 2. It does not filter display_name inside `public_profiles`, and that is a
--    judgement worth stating because the opposite case is arguable.
--    A view-level `CASE WHEN display_name LIKE '%@%' THEN NULL` would close
--    this class permanently, including for a name the athlete types into the
--    profile form themselves. It would also silently overrule a deliberate
--    choice. Migration 056 draws exactly this line for `injury_status` —
--    "self-chosen disclosure is a different thing from inferred health data" —
--    and the same line applies here: the defect was that WE wrote their address
--    into a public column without asking. A person who types their own address
--    into their public name has asked.
--
--    If that call is wrong, the fix is a `CREATE OR REPLACE VIEW` on
--    `public_profiles` and `leaderboard_profiles` with the column list
--    unchanged, and it should be its own migration with its own reasoning.
--
-- 3. It does not touch `bio`, which is also published by `public_profiles` and
--    is also free text. Nothing ever wrote an address there automatically, so
--    it is not this finding — but it is the same shape, and N10 asks for a
--    column-by-column re-read of that view rather than a fix to one column.
