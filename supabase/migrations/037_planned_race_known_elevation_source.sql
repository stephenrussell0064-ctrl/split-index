-- User feedback: "For upcoming races, this should have a dropdown of races
-- which you know the elevation and terrain and difficulty... I don't want
-- the user to have to enter the elevation of gpx." Consulted the user on
-- feasibility first (no real race-course database is integrated into this
-- app, and fabricating elevation numbers for real races would just be
-- guessing) — agreed approach: a curated dropdown of well-known races with
-- real, sourced elevation/terrain data (see src/lib/constants/known-races.ts),
-- alongside the existing manual-entry/GPX-upload options, not replacing them.
--
-- Postgres CHECK constraints can't be altered in place — the original one
-- (manual, gpx only) must be dropped and recreated with the new allowed
-- value. Constraint name matches Postgres' own default naming for a column
-- CHECK added via ALTER TABLE ADD COLUMN (tablename_columnname_check).
ALTER TABLE planned_races DROP CONSTRAINT IF EXISTS planned_races_elevation_source_check;
ALTER TABLE planned_races
  ADD CONSTRAINT planned_races_elevation_source_check
    CHECK (elevation_source IS NULL OR elevation_source IN ('manual', 'gpx', 'known'));
