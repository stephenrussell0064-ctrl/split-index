-- Let the athlete say that not all of their training is recorded here.
--
-- `reconcileCurrentVolume` takes the LOWER of the athlete's stated weekly
-- volume and what their logs show. That is the right default — an inflated
-- starting number ramps someone into an injury, and most gaps between stated
-- and logged are optimism.
--
-- It is wrong when the gap is simply that the training happened somewhere
-- else: a week on a hotel treadmill, a club session recorded on a friend's
-- watch, a phase before they installed the app. Those athletes had no way to
-- say so, so week 1 of every plan anchored to a number they had already told
-- us was incomplete, and re-typing the correct figure could never move it.
--
-- Defaults false: the conservative reconciliation stays the default, and this
-- is an explicit statement the athlete has to make.

ALTER TABLE hpe_intake
  ADD COLUMN IF NOT EXISTS trains_outside_app BOOLEAN NOT NULL DEFAULT FALSE;
