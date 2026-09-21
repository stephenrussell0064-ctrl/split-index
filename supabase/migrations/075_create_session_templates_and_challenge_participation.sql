-- 075: Create session_templates and public_challenge_participation, which the
-- application reads and the database does not have.
--
-- FOUND BY THE DRIFT CHECK, on its first real run. Both are migrations that
-- were written, reviewed, committed and never applied — the failure no guard
-- in this repository could see, because every one of them reads the SQL and
-- the SQL was right.
--
-- WHAT WAS ACTUALLY BROKEN
-- ------------------------
-- session_templates (from 005). /api/session-templates reads and writes it and
-- the log page loads a template to prefill a session. Saving a template
-- failed. Opening the log page with ?template=<id> silently did nothing: the
-- loader destructures `{ data: template }` and ignores the error, so there was
-- no message, no empty state, and no way for an athlete to tell the feature
-- from a feature that does not exist.
--
-- public_challenge_participation (from 056). src/lib/social/queries.ts reads it
-- for "how many people joined this challenge" and falls back to `?? []`, so
-- every challenge has been showing zero participants. Wrong on screen rather
-- than broken, which is worse: nothing looked like an error.
--
-- This is the fourth thing 056 was carrying. The other three were its policy
-- drops, applied in 073.
--
-- COPIED, NOT REWRITTEN. Both definitions were correct; the only thing wrong
-- with them is that they never ran. Extracted from 005 and 056 programmatically
-- rather than retyped, so the diff against the originals is empty by
-- construction.
--
-- DELIBERATELY NOT INCLUDED: 005 ends with
-- `ALTER TYPE activity_source ADD VALUE IF NOT EXISTS 'file';`, which has
-- nothing to do with session templates and is not something to slip into an
-- outage fix. Adding an enum value cannot be undone in the same transaction,
-- and nothing in the codebase writes source='file' — the file-import path also
-- needs import_jobs, which 003 was to create and which is likewise missing.
-- That is a separate decision about whether file import is a feature at all.
--
-- SAFE TO RUN TWICE: the table is IF NOT EXISTS, the index is IF NOT EXISTS,
-- the policy is dropped before it is created, and the view is DROP-then-CREATE.

-- ─── session_templates (005) ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS session_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sport sport_type NOT NULL,
  template_data JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS session_templates_user_sport_idx
  ON session_templates (user_id, sport);

ALTER TABLE session_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own session templates" ON session_templates;
CREATE POLICY "Users manage own session templates"
  ON session_templates
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ─── public_challenge_participation (056) ───────────────────────────────────
--
-- The only cross-athlete read of challenge_participants is "how many people
-- joined this challenge", so this view carries the challenge id and nothing
-- else. Not even user_id: a count does not need to say who.

DROP VIEW IF EXISTS public_challenge_participation;
CREATE VIEW public_challenge_participation (
  challenge_id
) AS
SELECT c.challenge_id
FROM challenge_participants c;

ALTER VIEW public_challenge_participation SET (security_invoker = off);

-- Revoked from anon by name, not merely granted to authenticated: Supabase's
-- ALTER DEFAULT PRIVILEGES grants a new view to anon at creation, so the grant
-- alone would leave it readable by anyone with the key in the client bundle.
-- These three lines are 056's own and already had it right.

REVOKE ALL ON public_challenge_participation FROM anon;
REVOKE ALL ON public_challenge_participation FROM authenticated;
GRANT SELECT ON public_challenge_participation TO authenticated;

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
--   SELECT to_regclass('public.session_templates'),
--          to_regclass('public.public_challenge_participation');
--
-- Both non-null. Then `npm run check:drift` should stop reporting them.
