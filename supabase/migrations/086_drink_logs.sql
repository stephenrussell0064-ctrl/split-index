-- 086: alcohol intake, as a first-class recovery input.
--
-- NUMBERING. 086 because 085 is the highest version on any branch or tag in
-- this repo, checked at the moment this file was written rather than quoted
-- from memory (the rule 085's header sets out):
--   for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/tags refs/remotes); do
--     git ls-tree --name-only "$r" supabase/migrations/ | xargs -n1 basename
--   done | grep -oE '^[0-9]{3}' | sort -u | tail -1
-- docs/pre-launch/migration-reconciliation.md §1 confirms production has run
-- through 085, so this lands on the version it was written against.
--
-- WHY A NEW TABLE AND NOT A COLUMN ON recovery_snapshots
-- ------------------------------------------------------
-- recovery_snapshots is one row per day per athlete. Drinking is not: four
-- pints across an evening is four rows with four timestamps, and the timestamps
-- are the entire point — the recovery model is driven by grams per kilogram AND
-- by how long ago, so collapsing an evening into a daily total would throw away
-- the input that distinguishes "two units at lunchtime" from "two units at
-- midnight" before the model ever sees it.
--
-- WHY grams_ethanol IS STORED RATHER THAN DERIVED
-- -----------------------------------------------
-- volume_ml and abv_percent are kept for display and for editing, but the dose
-- the model reads is the stored grams. A preset's assumed ABV is a product
-- decision that will be revised — the day "pint of lager" moves from 4.0% to
-- 4.2%, a derived column would silently rewrite every night out in the
-- athlete's history, including the ones their past recovery scores were
-- computed from. Grams are what the body saw; they are a fact about the past
-- and are frozen at write time.
--
-- WHAT THIS DATA IS, AND WHAT IT MUST NOT BECOME
-- ----------------------------------------------
-- Sensitive personal data about identifiable people, processed as ORDINARY
-- personal data rather than as Article 9 special category health data. That
-- classification is argued in full in src/lib/consent/article9.ts: the log
-- exists to estimate a training decrement, not to determine health status,
-- which is the same reasoning that already puts HRV, resting heart rate and
-- sleep in Tier 1.
--
-- It holds only while this table stays out of every shared surface and while
-- nothing in the app infers a health conclusion from it. So: owner-scoped at
-- the database, never joined into a public_* projection view, absent from
-- every leaderboard and social surface, and erasable in full by its owner.
-- There is no version of this feature where one athlete's drinking is visible
-- to another. src/lib/recovery/recovery-data-is-private.test.ts fails the
-- build if a view, an anon grant, or a query outside the recovery feature
-- appears.
--
-- A feature that scores someone's drinking against a clinical instrument, or
-- labels them, moves this table into Article 9 and needs an explicit consent
-- gate before it ships. article9_consent_events is already keyed for it.

BEGIN;

CREATE TABLE IF NOT EXISTS drink_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- When it was DRUNK, not when it was logged. Someone recording last night's
  -- pints over breakfast is the normal case, not the exception.
  drank_at TIMESTAMPTZ NOT NULL,

  -- Grams of pure ethanol. The upper bound is not a judgement about anybody's
  -- evening: it is the same reject-never-clamp boundary the API applies, sized
  -- so a fat-fingered "5000ml" cannot enter a dose that would drive the
  -- recovery model to a number no human could produce.
  grams_ethanol NUMERIC(7,2) NOT NULL CHECK (grams_ethanol > 0 AND grams_ethanol <= 1000),

  -- What was entered, kept for display and for editing a mis-tap.
  preset_id TEXT,
  label TEXT NOT NULL,
  volume_ml NUMERIC(7,1) CHECK (volume_ml IS NULL OR (volume_ml > 0 AND volume_ml <= 5000)),
  abv_percent NUMERIC(4,1) CHECK (abv_percent IS NULL OR (abv_percent >= 0 AND abv_percent <= 100)),
  quantity NUMERIC(4,1) NOT NULL DEFAULT 1 CHECK (quantity > 0 AND quantity <= 50),
  note TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Every read this feature makes is "this athlete, recently, newest first" —
-- the 48-hour recovery window, the 7-day unit total, and the history list.
CREATE INDEX IF NOT EXISTS idx_drink_logs_user_time
  ON drink_logs(user_id, drank_at DESC);

ALTER TABLE drink_logs ENABLE ROW LEVEL SECURITY;

-- WITH CHECK as well as USING, which the older recovery policy (001) omits.
-- USING alone governs which rows are visible to a statement; without WITH
-- CHECK, an INSERT or an UPDATE can write a row carrying somebody else's
-- user_id. The API sets user_id from the session and never from the body, so
-- this is defence in depth rather than a live hole — but it is one line, and
-- the alternative is trusting that every future writer of this table
-- remembers.
CREATE POLICY "Users manage own drink logs" ON drink_logs
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 085 removed the default grant to `anon` for new tables, so this table is
-- unreachable by a signed-out visitor without a statement like the one below —
-- and there deliberately isn't one for `anon`. `authenticated` still inherits
-- its default grant, but this states the intent explicitly rather than relying
-- on a default that 085's sibling change could reasonably remove next.
GRANT SELECT, INSERT, UPDATE, DELETE ON drink_logs TO authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- AFTERWARDS
-- ─────────────────────────────────────────────────────────────────────────────
-- Prove the table is owner-scoped and not public, rather than assuming it:
--
--   SELECT has_table_privilege('anon', 'public.drink_logs', 'SELECT');  -- want false
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'drink_logs';   -- want true
--
-- And record a row in docs/pre-launch/migration-reconciliation.md §1 once this
-- has been applied to production. §4.4: a migration is not done until it has a
-- ledger row.
