-- Hybrid Athlete Report (interference-engine brief, Part 5): a periodic,
-- premium-gated synthesis of score trend + Part 1 interference findings +
-- Part 2 readiness trend + the existing race prediction. Generated on a
-- schedule (see /api/cron/hybrid-reports) via the admin client, so writes
-- don't need a user-facing INSERT/UPDATE policy — only SELECT for the
-- report's own owner.

CREATE TABLE hybrid_athlete_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  period TEXT NOT NULL CHECK (period IN ('monthly', 'quarterly')),
  period_start DATE NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  score_trend JSONB NOT NULL,
  readiness_trend JSONB NOT NULL,
  interference_headline TEXT NOT NULL,
  target_pace_label TEXT,
  UNIQUE (user_id, period, period_start)
);

CREATE INDEX idx_hybrid_reports_user ON hybrid_athlete_reports(user_id, period, period_start DESC);

ALTER TABLE hybrid_athlete_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own hybrid athlete reports" ON hybrid_athlete_reports FOR SELECT
  USING (auth.uid() = user_id);
