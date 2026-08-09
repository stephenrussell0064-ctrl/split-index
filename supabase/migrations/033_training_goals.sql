-- Goal-driven hybrid training plan (user feedback): "allow them to input
-- their goals for each cardio exercise and gym exercise that they wish to
-- achieve, and then create a plan which will prioritise the exercise or
-- activity which they are furthest away from, whilst still maintaining the
-- hybrid balance between all exercises."
CREATE TABLE IF NOT EXISTS training_goals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_type TEXT NOT NULL CHECK (goal_type IN ('cardio', 'gym')),
  -- Cardio: the benchmark sport key (run/walk/row/swim/cycle/ski) — the
  -- goal is always at that sport's canonical benchmark distance, matching
  -- predicted_benchmarks (see cardio-benchmarks.ts's BENCHMARK_DISTANCE_METERS),
  -- so "current value" can be read straight off the athlete's existing
  -- prediction memory with no new projection logic. Gym: the exercise name,
  -- matching gym_exercises.exercise_name.
  target_key TEXT NOT NULL,
  -- Cardio: seconds at the benchmark distance (lower is better). Gym: kg,
  -- an estimated-1RM target (higher is better).
  target_value NUMERIC(10, 2) NOT NULL CHECK (target_value > 0),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  achieved_at TIMESTAMPTZ,
  UNIQUE (user_id, goal_type, target_key)
);

CREATE INDEX IF NOT EXISTS idx_training_goals_user ON training_goals(user_id);

ALTER TABLE training_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own training goals" ON training_goals FOR ALL
  USING (auth.uid() = user_id);
