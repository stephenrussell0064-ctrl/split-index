-- Private-account visibility model — user feedback: "Please make each
-- activity public by default to friends, but the option in settings is to
-- make your account private."
--
-- WHY THIS FILE IS NUMBERED 049 AND NOT 046
-- -----------------------------------------
-- It shipped as `046_private_account_visibility.sql` alongside an unrelated
-- `046_hpe_safety_capped_outcome.sql` from another workstream. Two files, one
-- version number, and `supabase_migrations.schema_migrations.version` is a
-- PRIMARY KEY — so `supabase db push` cannot record both. It either aborts the
-- whole push on the duplicate key or treats version 046 as already applied and
-- skips the second file. `046_hpe_...` sorts first, so the file that lost was
-- this one: the privacy fix was never applied to any database that had already
-- taken the HPE migration, which is why the athlete who reported the original
-- bug reported it again, unchanged, after it was "fixed".
--
-- A migration that cannot be applied is not a fix. Renumbering to the next
-- genuinely unused version is what makes it one. 049 is new everywhere, so it
-- applies on every database regardless of which 046 they happened to record.
-- Re-running is harmless (see the idempotence notes below), so a database that
-- did manage to take this file as 046 simply applies the same statements once
-- more with no effect.
--
-- src/lib/social/activity-visibility.test.ts now fails the build if any two
-- migrations ever share a number again.
--
-- WHAT THIS MIGRATION DOES **NOT** DO, DELIBERATELY
-- ------------------------------------------------
-- It does not backfill `profiles.share_activities_with_friends`, and it does
-- not add a new privacy column.
--
-- The visible-to-friends-by-default model already exists in the database:
-- migration 031 created `share_activities_with_friends BOOLEAN NOT NULL
-- DEFAULT true` and the activity_is_visible_to() predicate that enforces
-- friends-only reads. The user-facing inversion asked for here ("Private
-- account" instead of "Share my activities") is a wording change at the UI
-- edge, in activity-privacy-settings.tsx — not a schema change. Renaming or
-- re-modelling a column that a deployed RLS policy reads would buy nothing
-- and risks a window where the predicate reads the wrong thing.
--
-- Critically: anyone currently sitting on `false` chose that in Settings.
-- Migration 032 already ran one blanket `UPDATE ... SET
-- share_activities_with_friends = true WHERE ... = false`. That was safe
-- only because 031 and 032 shipped in the same commit, so no athlete had
-- ever been able to opt out before it ran. That is no longer true: the
-- opt-out has been live in production since 2026-08-09, so a second such
-- backfill would silently un-private real people who deliberately went
-- private. This migration therefore touches no rows.
--
-- PRIVACY GOVERNS WHO CAN SEE *YOU*, NEVER WHAT *YOU* CAN SEE
-- -----------------------------------------------------------
-- Stated once, here, because it is the invariant every statement below is
-- protecting and the one an over-eager future policy is most likely to break:
--
--   * An athlete can ALWAYS read and write their own `profiles` row, private
--     or not. That is "Users can view own profile" (001) — `USING (auth.uid()
--     = user_id)`, with no reference to any sharing or username column — and
--     "Users can update own profile" (002/002b). Nothing here narrows either.
--     A SELECT policy of the shape `USING (share_activities_with_friends =
--     true)` would lock an athlete out of the very switch they used to go
--     private, and must never be written.
--   * An athlete can ALWAYS read their own activities: "Users manage own
--     activities" (001), `FOR ALL USING (auth.uid() = user_id)`.
--   * Going private does not blind an athlete to OTHER people's feeds either.
--     activity_is_visible_to() reads the sharing flag of the activity's OWNER
--     (`p.user_id = a.user_id`), never the viewer's — so a private athlete
--     still sees every friend who shares. Read the predicate below with that
--     in mind: `p` is always the author, never the viewer.

-- ─── Re-assert the column and its default (idempotent, no table rewrite) ────
-- ADD COLUMN IF NOT EXISTS is here as a repair, not as a duplicate of 031:
-- a database that somehow missed 031 would otherwise fail on the ALTER COLUMN
-- below and abort the push, and the symptom of that missing column is exactly
-- the reported bug — Settings selects it, so the whole profile read 400s and
-- the privacy switch reports it cannot load its state.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS share_activities_with_friends BOOLEAN NOT NULL DEFAULT true;

-- ALTER COLUMN ... SET DEFAULT is a catalogue-only change: it does not scan
-- or rewrite the table, so this is safe on a live `profiles` with real rows.
ALTER TABLE profiles
  ALTER COLUMN share_activities_with_friends SET DEFAULT true;

COMMENT ON COLUMN profiles.share_activities_with_friends IS
  'Activity visibility to ACCEPTED FRIENDS ONLY (never public/unauthenticated). '
  'true = visible to friends (the default for every new athlete). '
  'false = private, set by the athlete turning on "Private account" in Settings. '
  'Governs who may see THIS athlete; it must never gate what this athlete can '
  'read, including their own profile row and their own activities. '
  'Surfaced inverted in the UI as a "Private account" switch; the column keeps '
  'its original polarity because activity_is_visible_to() reads it directly. '
  'Do not blanket-UPDATE this column: a false value is always a deliberate choice.';

-- ─── Harden the visibility predicate ────────────────────────────────────────
-- activity_is_visible_to() is SECURITY DEFINER (it must be: it reads
-- activities/profiles/friends rows the caller cannot see) and takes the
-- viewer as a parameter. The RLS policies always pass auth.uid(), but the
-- function itself is EXECUTE-able by any authenticated user with ANY
-- viewer_id — which turned it into an oracle: call it with someone else's
-- uuid and the boolean tells you whether those two athletes are friends and
-- whether the owner shares. No application code calls this function
-- directly (it exists only for the policies below), so we can simply refuse
-- to answer for anyone but the caller.
--
-- CREATE OR REPLACE keeps the same signature and OID, so the policies
-- created in 031 continue to reference it with no change and no window
-- where activities are unprotected.
CREATE OR REPLACE FUNCTION activity_is_visible_to(check_activity_id UUID, viewer_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM activities a
    JOIN profiles p ON p.user_id = a.user_id
    WHERE a.id = check_activity_id
      AND a.is_draft = false
      -- Only ever answer about the authenticated caller. NULL for an
      -- anonymous request, and NULL = anything is NULL, so an unauthenticated
      -- caller is denied here before any of the branches below are reached.
      AND viewer_id = auth.uid()
      AND (
        -- The owner, always — a private athlete is not hidden from themselves.
        a.user_id = viewer_id
        OR (
          -- ...and otherwise the AUTHOR's sharing flag, not the viewer's.
          p.share_activities_with_friends = true
          AND EXISTS (
            SELECT 1 FROM friends f
            WHERE f.status = 'accepted'
              AND (
                (f.user_id = viewer_id AND f.friend_id = a.user_id)
                OR (f.friend_id = viewer_id AND f.user_id = a.user_id)
              )
          )
        )
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ─── Re-assert the policy that makes a friend feed possible at all ──────────
-- Without this policy on `activities`, "Users manage own activities" (001) is
-- the only SELECT rule and every query for a friend's workouts returns zero
-- rows under RLS — a permanently, silently empty feed, which is the second
-- half of the reported bug. 031 creates it, but 031 is exactly the migration a
-- database in this state is most likely to be missing, so re-assert it here.
--
-- Created only when absent rather than DROP + CREATE: dropping it, even for
-- the microseconds between two statements in the same transaction, is a window
-- in which a concurrent feed query silently returns nothing. There is no
-- CREATE POLICY IF NOT EXISTS, hence the DO block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'activities'
      AND policyname = 'Friends view shared activities'
  ) THEN
    CREATE POLICY "Friends view shared activities" ON activities FOR SELECT
      USING (activity_is_visible_to(id, auth.uid()));
  END IF;
END $$;
