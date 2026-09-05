-- ============================================================================
-- ONE-OFF BACKFILL — clear stale per-exercise weight-entry modes
-- ============================================================================
--
-- THIS FILE IS NOT A MIGRATION. It deliberately does not live in
-- supabase/migrations/ and must never be moved there: `supabase db push` runs
-- that directory in filename order, and this script edits real athlete data.
-- It is run by hand, once, when you decide to.
--
-- ---------------------------------------------------------------------------
-- WHAT IT IS FOR
-- ---------------------------------------------------------------------------
-- Two commits changed how load is counted for fifteen exercises:
--
--   f0ac754  the Iso-Lateral / Hammer Strength family are plate-loaded PER
--            ARM, so "100" means 100 on each horn. They had no load-config
--            entry at all and fell to the "total" default, scoring HALF the
--            real load.
--   53b9fa7  "Reverse Lunges" and "Step Up" were missing from the config map
--            while sharing an anchor with siblings that were mapped, so they
--            scored at half the load of an identically-logged "Walking Lunge".
--
-- All fifteen now default to per_hand. New sessions are correct immediately.
--
-- OLD SESSIONS ARE NOT, AND A RECOMPUTE ALONE WILL NOT FIX THEM. The recompute
-- path reads:
--
--     weightModes[name] ?? defaultWeightEntryMode(name)
--
-- so an explicitly stored mode WINS over the corrected default. Worked example
-- from f0ac754, an Iso-Lateral High Row at 100kg x 8:
--
--     stored "total"     -> 550   (wrong, and what a recompute alone gives)
--     stored "per_hand"  -> 814
--     key absent         -> 814   (falls through to the corrected default)
--
-- This script removes those stale keys so the corrected default applies. It is
-- the missing half of the fix; run it BEFORE the recompute, or the recompute
-- will faithfully rebuild the wrong number.
--
-- ---------------------------------------------------------------------------
-- THE HONEST CAVEAT — READ THIS BEFORE RUNNING
-- ---------------------------------------------------------------------------
-- POST /api/activities writes a mode for EVERY exercise, not only ones the
-- athlete chose a convention for:
--
--     ex.weight_entry_mode ?? defaultWeightEntryMode(ex.exercise_name)
--
-- So almost every stored "total" on these fifteen is a SNAPSHOT OF THE OLD
-- DEFAULT, not a decision. But the logging form does have a convention picker,
-- so a deliberate "total" is possible — an athlete whose machine displays the
-- combined stack, say.
--
-- NOTHING IN THE STORED DATA DISTINGUISHES THE TWO. They are the same string.
-- This script therefore cannot be perfectly safe, and does not pretend to be:
-- it assumes the common case (stale default) and, for the rare deliberate
-- case, will double that exercise's counted load. That is why STEP 1 takes a
-- backup and why the restore in STEP 5 is written out ready to run.
--
-- It only ever removes "total". A stored "per_hand" is already correct and is
-- left untouched, so re-running this is harmless.
--
-- ---------------------------------------------------------------------------
-- WHAT IT TOUCHES
-- ---------------------------------------------------------------------------
-- activities.metadata->'exercise_weight_modes' ONLY, and within it only the
-- fifteen keys listed below, and only where the value is exactly "total".
-- Other metadata keys (route, exercise_notes, ...) are preserved. No score,
-- distance, set or Split Index row is read or written — those are rebuilt
-- afterwards by the recompute.
--
-- ---------------------------------------------------------------------------
-- HOW TO RUN
-- ---------------------------------------------------------------------------
--   1. Paste this whole file into the Supabase SQL editor and run it.
--      As shipped, STEP 3's UPDATE is commented out, so the first run only
--      takes the backup and prints a READ-ONLY dry run.
--   2. Read the dry run. It tells you how many rows and which exercises.
--   3. If it looks right, uncomment the UPDATE in STEP 3 and run the file
--      again. STEP 1 is idempotent, so the backup survives.
--   4. THEN run the recompute for affected athletes:
--        POST /api/activities/recompute   (Settings -> "Refresh all my scores")
--
-- ============================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — backup. Idempotent; safe to re-run.
-- ---------------------------------------------------------------------------
-- A real table, not a temp one: the whole point is that it outlives the
-- session so STEP 5 can restore months later if someone reports a lift that
-- suddenly counts double.
CREATE TABLE IF NOT EXISTS backfill_exercise_weight_modes_20260905 (
  activity_id     UUID PRIMARY KEY,
  user_id         UUID,
  modes_before    JSONB NOT NULL,
  backed_up_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO backfill_exercise_weight_modes_20260905 (activity_id, user_id, modes_before)
SELECT a.id, a.user_id, a.metadata->'exercise_weight_modes'
FROM activities a
WHERE jsonb_typeof(a.metadata->'exercise_weight_modes') = 'object'
  AND EXISTS (
    SELECT 1
    FROM jsonb_each_text(a.metadata->'exercise_weight_modes') AS m(k, v)
    WHERE v = 'total'
      AND k IN (
        'Iso-Lateral High Row','Iso-Lateral Row','Iso-Lateral Low Row',
        'Iso-Lateral Wide Pulldown','Iso-Lateral Front Pulldown',
        'Iso-Lateral Chest Press','Iso-Lateral Incline Press',
        'Iso-Lateral Decline Press','Iso-Lateral Shoulder Press',
        'Iso-Lateral Leg Press','Iso-Lateral Leg Extension',
        'Iso-Lateral Leg Curl','Hammer Strength Row',
        'Reverse Lunges','Step Up'
      )
  )
ON CONFLICT (activity_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- STEP 2 — dry run. Read-only. Always runs.
-- ---------------------------------------------------------------------------
-- Per-exercise counts, so you can see whether the shape matches what you
-- expect before changing anything.
SELECT
  m.k                        AS exercise,
  count(*)                   AS activities_affected,
  count(DISTINCT a.user_id)  AS athletes_affected,
  min(a.started_at)::date    AS earliest,
  max(a.started_at)::date    AS latest
FROM activities a
CROSS JOIN LATERAL jsonb_each_text(a.metadata->'exercise_weight_modes') AS m(k, v)
WHERE jsonb_typeof(a.metadata->'exercise_weight_modes') = 'object'
  AND m.v = 'total'
  AND m.k IN (
    'Iso-Lateral High Row','Iso-Lateral Row','Iso-Lateral Low Row',
    'Iso-Lateral Wide Pulldown','Iso-Lateral Front Pulldown',
    'Iso-Lateral Chest Press','Iso-Lateral Incline Press',
    'Iso-Lateral Decline Press','Iso-Lateral Shoulder Press',
    'Iso-Lateral Leg Press','Iso-Lateral Leg Extension',
    'Iso-Lateral Leg Curl','Hammer Strength Row',
    'Reverse Lunges','Step Up'
  )
GROUP BY m.k
ORDER BY activities_affected DESC;


-- ---------------------------------------------------------------------------
-- STEP 3 — the write. COMMENTED OUT ON PURPOSE.
-- ---------------------------------------------------------------------------
-- Uncomment the block below only after reading STEP 2's output.
--
-- Removes just the stale keys. jsonb_strip is done by rebuilding the object
-- from the entries we are keeping, so every other exercise's mode and every
-- other metadata key survive untouched.
--
-- WITH stale AS (
--   SELECT
--     a.id,
--     (
--       SELECT coalesce(jsonb_object_agg(m.k, to_jsonb(m.v)), '{}'::jsonb)
--       FROM jsonb_each_text(a.metadata->'exercise_weight_modes') AS m(k, v)
--       WHERE NOT (
--         m.v = 'total'
--         AND m.k IN (
--           'Iso-Lateral High Row','Iso-Lateral Row','Iso-Lateral Low Row',
--           'Iso-Lateral Wide Pulldown','Iso-Lateral Front Pulldown',
--           'Iso-Lateral Chest Press','Iso-Lateral Incline Press',
--           'Iso-Lateral Decline Press','Iso-Lateral Shoulder Press',
--           'Iso-Lateral Leg Press','Iso-Lateral Leg Extension',
--           'Iso-Lateral Leg Curl','Hammer Strength Row',
--           'Reverse Lunges','Step Up'
--         )
--       )
--     ) AS modes_after
--   FROM activities a
--   WHERE jsonb_typeof(a.metadata->'exercise_weight_modes') = 'object'
--     AND EXISTS (
--       SELECT 1
--       FROM jsonb_each_text(a.metadata->'exercise_weight_modes') AS m(k, v)
--       WHERE v = 'total'
--         AND k IN (
--           'Iso-Lateral High Row','Iso-Lateral Row','Iso-Lateral Low Row',
--           'Iso-Lateral Wide Pulldown','Iso-Lateral Front Pulldown',
--           'Iso-Lateral Chest Press','Iso-Lateral Incline Press',
--           'Iso-Lateral Decline Press','Iso-Lateral Shoulder Press',
--           'Iso-Lateral Leg Press','Iso-Lateral Leg Extension',
--           'Iso-Lateral Leg Curl','Hammer Strength Row',
--           'Reverse Lunges','Step Up'
--         )
--     )
-- )
-- UPDATE activities a
-- SET metadata = jsonb_set(a.metadata, '{exercise_weight_modes}', stale.modes_after, true)
-- FROM stale
-- WHERE a.id = stale.id;


-- ---------------------------------------------------------------------------
-- STEP 4 — verification. Read-only. Run after STEP 3.
-- ---------------------------------------------------------------------------
-- Expect zero rows. Anything returned here was not cleared.
SELECT a.id, a.user_id, m.k AS exercise, m.v AS still_stored
FROM activities a
CROSS JOIN LATERAL jsonb_each_text(a.metadata->'exercise_weight_modes') AS m(k, v)
WHERE jsonb_typeof(a.metadata->'exercise_weight_modes') = 'object'
  AND m.v = 'total'
  AND m.k IN (
    'Iso-Lateral High Row','Iso-Lateral Row','Iso-Lateral Low Row',
    'Iso-Lateral Wide Pulldown','Iso-Lateral Front Pulldown',
    'Iso-Lateral Chest Press','Iso-Lateral Incline Press',
    'Iso-Lateral Decline Press','Iso-Lateral Shoulder Press',
    'Iso-Lateral Leg Press','Iso-Lateral Leg Extension',
    'Iso-Lateral Leg Curl','Hammer Strength Row',
    'Reverse Lunges','Step Up'
  )
LIMIT 50;


-- ---------------------------------------------------------------------------
-- STEP 5 — restore, if this turns out to have been wrong.
-- ---------------------------------------------------------------------------
-- For the caveat above: an athlete who genuinely meant "total" on one of these
-- fifteen will see that exercise's counted load double. Putting their original
-- object back is one statement. Re-run the recompute afterwards.
--
-- Restore ONE athlete:
--   UPDATE activities a
--   SET metadata = jsonb_set(a.metadata, '{exercise_weight_modes}', b.modes_before, true)
--   FROM backfill_exercise_weight_modes_20260905 b
--   WHERE a.id = b.activity_id
--     AND b.user_id = '<uuid>';
--
-- Restore EVERYONE — drop the user_id line above.
--
-- Once you are satisfied, the backup table can go:
--   DROP TABLE backfill_exercise_weight_modes_20260905;
