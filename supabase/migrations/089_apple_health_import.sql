-- 089: Apple Health read import — where imported samples land, and the record
-- that stops them landing twice.
--
-- NUMBERING. 089 because 088 is the highest version on any branch or tag in
-- this repo at the moment of writing (the rule 085's header sets out):
--   git log --all --diff-filter=A --name-only --format= -- supabase/migrations | sort -u | tail -1
--
-- WHY
-- ---
-- Until now every number Split Index scores was typed in by hand, except what
-- the in-app GPS run captures. The phone's health store already holds the
-- workouts and vitals every wearable writes into it — Apple Watch, Garmin,
-- Whoop, Oura, Coros, Polar, Strava — and reading it needs no partner API.
-- Logging-effort plan, phase 1.
--
-- The import writes into the tables the app ALREADY reads: `activities`
-- (source = 'apple_health', which the enum has carried since 001),
-- `recovery_snapshots` (hrv_ms, resting_hr and sleep_hours — the last two were
-- created in 001 and never written by anything) and `body_metrics`. What is
-- new here is small:
--
--   1. recovery_snapshots.source. Apple reports HRV as SDNN; the manual entry
--      is rMSSD. The two are not interchangeable, so the recovery baseline is
--      built per source (lib/recovery/data.ts) and a row must say which it is.
--      Every existing row is manual, which the default makes true.
--
--   2. health_imports. One row per Apple Health sample uuid this athlete has
--      imported, so a sync that overlaps the last one (deliberately — samples
--      arrive late) cannot write a workout or a reading twice. The primary key
--      is the dedup.
--
--   3. health_import_state. Whether the athlete has connected, and the cursor
--      the next sync reads from. One row per athlete.
--
-- CLASSIFICATION. HRV, resting heart rate, sleep and bodyweight are held as
-- ordinary personal data on the same four conditions lib/consent/article9.ts
-- states for drink logs (no health inference, never shared, genuinely
-- optional, erasable in one action). Connecting is the athlete's explicit act
-- in Apple's own permission sheet; disconnecting is one tap and leaves their
-- data where it is, deletable with the account.
--
-- REVERT. To undo this migration:
--   DROP TABLE IF EXISTS health_imports;
--   DROP TABLE IF EXISTS health_import_state;
--   ALTER TABLE recovery_snapshots DROP COLUMN IF EXISTS source;
-- Imported rows in activities / recovery_snapshots / body_metrics survive
-- that; find them by activities.source = 'apple_health' and, for the rest, by
-- the uuids in health_imports before dropping it.

BEGIN;

-- 1. Which instrument an HRV reading came from.
ALTER TABLE recovery_snapshots
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual'
  CHECK (source IN ('manual', 'apple_health'));

COMMENT ON COLUMN recovery_snapshots.source IS
  'manual = typed rMSSD; apple_health = SDNN read from the health store. Baselines are per source — never blend them. Migration 089.';

-- 2. Every imported sample, once.
CREATE TABLE IF NOT EXISTS health_imports (
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- HKObject.uuid, stable for the life of the sample on that phone.
  sample_uuid TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('workout', 'hrv', 'resting_hr', 'body_mass', 'sleep')),
  -- When the sample itself is dated, not when it was imported.
  recorded_at TIMESTAMPTZ NOT NULL,
  -- Where it went: the activity, snapshot or body_metrics row. Null when the
  -- sample was read and deliberately not written (a strength workout with no
  -- sets, a workout already logged by hand), so it is not read again either.
  target_table TEXT,
  target_id UUID,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, sample_uuid)
);

CREATE INDEX IF NOT EXISTS idx_health_imports_user_kind_time
  ON health_imports(user_id, kind, recorded_at DESC);

ALTER TABLE health_imports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own health imports" ON health_imports
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON health_imports TO authenticated;

-- 3. Connection and cursor.
CREATE TABLE IF NOT EXISTS health_import_state (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'apple_health' CHECK (provider IN ('apple_health')),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Set on disconnect, cleared on reconnect. The row stays so the cursor does.
  disconnected_at TIMESTAMPTZ,
  last_sync_at TIMESTAMPTZ,
  -- The newest sample date seen so far; the next sync reads from a few days
  -- before it, because the health store back-fills.
  last_sample_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE health_import_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own health import state" ON health_import_state
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON health_import_state TO authenticated;

COMMIT;
