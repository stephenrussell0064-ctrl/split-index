-- The athlete's own cardio modalities, and their own gym exercises.
--
-- Two questions the intake never asked, and whose absence produced the same
-- defect in both domains: a plan written for a sport the athlete does not do.
--
-- CARDIO. Every endurance prescription in the engine was denominated in
-- running seconds per kilometre, because the diagnostic is fitted on running
-- and deliberately so — `ingest.ts` refuses non-running activities into the
-- pace pool for good reasons that have not changed. The consequence was that
-- an athlete who rows, rides or swims got a running plan or nothing. Neither
-- is acceptable, and relabelling a running session as a row is worse than
-- both: a plan that tells a rower to hold 4:30/km is not a plan.
--
-- `cardio_modalities` is a WHITELIST. Nothing outside it is prescribed. NULL
-- or empty means running, which is what the engine did before the question
-- existed — silently switching every existing athlete to a different sport
-- would be a worse surprise than the question.
--
-- `cross_train_ok` is the explicit second half: with one modality chosen and
-- this false, every endurance session is that modality and nothing in the plan
-- asks the athlete to run.
ALTER TABLE hpe_intake
  ADD COLUMN IF NOT EXISTS cardio_modalities TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS cross_train_ok BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN hpe_intake.cardio_modalities IS
  'Whitelist of cardio modalities (run/walk/row/swim/cycle). Empty = running, the pre-question default. Nothing outside this list is ever prescribed.';
COMMENT ON COLUMN hpe_intake.cross_train_ok IS
  'Whether the plan may mix modalities. False with a single modality chosen means every endurance session is that one.';

-- LIFTING. `training_split` (migration 044) already lets the athlete pick one
-- of five stock splits. It stays exactly as it is; these two are additive.
--
-- `custom_split_days` is for the athlete whose week none of the five
-- describes — chest/back/arms/legs, or a dedicated shoulder day. Stored as
-- their week rather than as a sixth enum value, because there is exactly one
-- of it and the engine has nothing general to say about it.
--   [{ "label": "Chest and arms", "primary_lift": "bench", "patterns": ["push"] }]
-- A day with no recognised movement pattern is dropped on read: the accessory
-- selector could not fill it, and a day carrying a primary lift and nothing
-- else is the "fragment of a session" the split work exists to prevent.
--
-- `exercises_by_day` is the athlete's own exercise selection, keyed by the day
-- label they were shown, and seeded in the UI from what they have ACTUALLY
-- logged rather than from the full catalogue:
--   { "Push": ["Incline dumbbell press", "Cable fly"] }
--
-- Both default to empty and empty means the engine chooses, exactly as it did
-- before. Selection is an enhancement, never a requirement — an athlete who
-- skips these questions gets the same complete plan they got yesterday.
ALTER TABLE hpe_intake
  ADD COLUMN IF NOT EXISTS custom_split_days JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS exercises_by_day JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN hpe_intake.custom_split_days IS
  'The athlete''s own gym day structure. Overrides training_split when non-empty. Empty = use training_split.';
COMMENT ON COLUMN hpe_intake.exercises_by_day IS
  'Chosen exercises per day label, seeded from the athlete''s logged history. Empty = the engine picks, as before.';
