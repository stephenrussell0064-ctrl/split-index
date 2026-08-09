-- Tracks whether a planned race's elevation_gain_meters came from a real
-- uploaded GPX course file (computed, accurate) or was typed in by hand
-- (an estimate) — lets the UI be honest about which one it's showing.
ALTER TABLE planned_races
  ADD COLUMN IF NOT EXISTS elevation_source TEXT
    CHECK (elevation_source IS NULL OR elevation_source IN ('manual', 'gpx'));
