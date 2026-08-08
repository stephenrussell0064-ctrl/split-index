-- Upcoming race entries (user feedback: "would it be possible to have a
-- section where people can enter the run event they are doing... and Split
-- Index would be able to give advice on the terrain, the elevation and the
-- weather on the day to give more specifically tailored race predictions").
-- One row per athlete per upcoming race. Latitude/longitude are geocoded
-- server-side from location_name at creation time (nullable — geocoding
-- can fail or the athlete can skip a location) so a weather forecast can be
-- looked up close to race day. elevation_gain_meters is athlete-entered
-- (the race's own published course profile), not looked up automatically —
-- no reliable, free source of arbitrary race-course elevation profiles
-- exists, and a wrong auto-fetched number would be worse than none.

CREATE TABLE planned_races (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_name TEXT NOT NULL,
  location_name TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  race_date DATE NOT NULL,
  distance_meters INTEGER NOT NULL CHECK (distance_meters > 0),
  elevation_gain_meters INTEGER CHECK (elevation_gain_meters IS NULL OR elevation_gain_meters >= 0),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX planned_races_user_date_idx ON planned_races (user_id, race_date);

ALTER TABLE planned_races ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own planned races" ON planned_races FOR ALL USING (auth.uid() = user_id);
