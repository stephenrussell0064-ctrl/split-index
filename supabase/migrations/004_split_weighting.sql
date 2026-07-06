-- Migration 004: user-adjustable Split Index weighting
-- Adds endurance/strength blend preference to profiles (default 50/50).

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS split_endurance_weight NUMERIC(3, 2) NOT NULL DEFAULT 0.50
    CHECK (split_endurance_weight >= 0 AND split_endurance_weight <= 1);

COMMENT ON COLUMN profiles.split_endurance_weight IS
  'User preference for Split Index blend: endurance weight (0–1). Strength weight = 1 − this value. Default 0.50.';

-- RLS: existing "Users can update own profile" policy covers this column.
