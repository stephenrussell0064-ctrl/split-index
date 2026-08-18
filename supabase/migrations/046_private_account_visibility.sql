-- Private-account visibility model — user feedback: "Please make each
-- activity public by default to friends, but the option in settings is to
-- make your account private."
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

-- ─── Re-assert the default (idempotent, no table rewrite) ───────────────────
-- ALTER COLUMN ... SET DEFAULT is a catalogue-only change: it does not scan
-- or rewrite the table, so this is safe on a live `profiles` with real rows.
ALTER TABLE profiles
  ALTER COLUMN share_activities_with_friends SET DEFAULT true;

COMMENT ON COLUMN profiles.share_activities_with_friends IS
  'Activity visibility to ACCEPTED FRIENDS ONLY (never public/unauthenticated). '
  'true = visible to friends (the default for every new athlete). '
  'false = private, set by the athlete turning on "Private account" in Settings. '
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
        a.user_id = viewer_id
        OR (
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
