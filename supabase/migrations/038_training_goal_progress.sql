-- User feedback: "Also allow the training plan to be saved and tracked for
-- the user to monitor progress... provide a timeline estimate." A goal's
-- gapFraction (how far off target it currently is) was otherwise only ever
-- computed live from today's data, with no history kept — no way to tell
-- whether an athlete is actually closing the gap or not, only where they
-- stand right now. This is a lightweight daily snapshot, not a full audit
-- log: at most one row per goal per day (upserted from /api/training-goals,
-- never duplicated), used purely to derive a real rate-of-improvement
-- timeline estimate (see computeProgressTrend in
-- src/lib/scoring/training-progress.ts) alongside the existing generic
-- assumed-rate feasibility check.
CREATE TABLE IF NOT EXISTS training_goal_progress (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal_id UUID NOT NULL REFERENCES training_goals(id) ON DELETE CASCADE,
  recorded_date DATE NOT NULL DEFAULT CURRENT_DATE,
  gap_fraction NUMERIC(6, 4) NOT NULL,
  current_value NUMERIC(10, 2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (goal_id, recorded_date)
);

CREATE INDEX IF NOT EXISTS idx_training_goal_progress_goal_date ON training_goal_progress(goal_id, recorded_date);

ALTER TABLE training_goal_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own training goal progress" ON training_goal_progress FOR ALL
  USING (auth.uid() = user_id);
