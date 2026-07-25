-- Personalized Riegel exponent per user, per sport (CLAUDE-CODE-BRIEF-
-- race-prediction-model.md). Derived from a user's own cross-distance
-- history within the rolling window (see personalizeRiegelKFromWindow in
-- src/lib/scoring/cardio/race-prediction.ts) rather than leaving every
-- user on the flat population default (RIEGEL_K_DEFAULT = 1.06). Null
-- means "not enough cross-distance data yet — use the default."
ALTER TABLE predicted_benchmarks
  ADD COLUMN IF NOT EXISTS riegel_k NUMERIC(4, 3)
    CHECK (riegel_k IS NULL OR (riegel_k >= 1.0 AND riegel_k <= 1.2));
