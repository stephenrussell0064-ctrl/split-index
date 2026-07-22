-- Personalized heart-rate calibration for cardio scoring.
--
-- Every athlete has different resting/max HR; the memory-based prediction
-- system (cardio-predictions.ts) previously compared everyone's avg HR
-- against the same fixed per-sport reference bpm (HR_ADJUST_REF_HR). This
-- column lets that reference be personalized to the athlete's own
-- heart-rate-reserve range instead — optional, defaults to the existing
-- population behaviour until a user sets it (see profile-form.tsx).
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS resting_hr INTEGER CHECK (resting_hr >= 30 AND resting_hr <= 120);
