-- The athlete's chosen gym split.
--
-- The engine previously allocated strength work per LIFT — a "squat day", a
-- "bench day" — which is right for a powerlifter peaking three lifts and is
-- not how most people train. Someone who runs push/pull/legs wants a push day,
-- and being handed a single lift reads as a fragment of a session rather than
-- a session.
--
-- Asked rather than inferred: two athletes with identical diagnostics can
-- reasonably prefer different structures, so this is a preference, not a
-- finding. The emphasis vector still decides how hard each day is and which
-- lift leads it; the split decides only how the week is carved up.
--
-- NULL means "no preference" and the engine picks upper/lower — the most
-- time-efficient split and the easiest to fit around running. Lift-specific is
-- deliberately NOT the default despite being the old behaviour, because it
-- only suits a peaking powerlifter.
ALTER TABLE hpe_intake
  ADD COLUMN IF NOT EXISTS training_split TEXT
    CHECK (training_split IS NULL OR training_split IN
      ('lift_specific', 'upper_lower', 'ppl', 'ppl_ul', 'full_body'));

COMMENT ON COLUMN hpe_intake.training_split IS
  'Chosen gym split. NULL = engine picks upper/lower. Decides how the week is carved up, not how hard it is.';
