-- Memory-based cardio predictions (MASTER-BRIEF.md §5).
-- One row per user per benchmark sport, holding the current predicted time
-- (seconds) at that sport's canonical benchmark distance — run 5k, row 2k,
-- swim 400m, cycle 20k, ski 2k (scored via the row curve), walk pace/km.
-- Updated asymmetrically on every new session: a faster-predicting session
-- pulls this down ~55% of the gap; a slower one only nudges it ~4%, so easy
-- days never crater a proven prediction. Note: `sport` here is the internal
-- 6-way benchmark bucket (run/walk/row/swim/cycle/ski), not the app-facing
-- `sport_type` enum (running/walking/swimming/rowing/bike_erg/indoor_cycling/
-- ski_erg/gym) — several SportType values collapse into one benchmark sport.

CREATE TABLE predicted_benchmarks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sport TEXT NOT NULL CHECK (sport IN ('run', 'walk', 'row', 'swim', 'cycle', 'ski')),
  benchmark_seconds NUMERIC(10,2) NOT NULL CHECK (benchmark_seconds > 0),
  sample_count INTEGER NOT NULL DEFAULT 1,
  last_activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, sport)
);

ALTER TABLE predicted_benchmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own predicted benchmarks" ON predicted_benchmarks FOR ALL USING (auth.uid() = user_id);
