-- Split into its own migration from 021_outdoor_cycling.sql on purpose:
-- a newly-added enum value can't safely be used in the same transaction as
-- the ALTER TYPE that added it (Postgres restriction) — run 021, then this
-- one, as two separate statements/pastes in the SQL editor.
INSERT INTO sports (slug, name, category, icon, supports_distance, display_order)
VALUES ('outdoor_cycling', 'Outdoor Cycling', 'endurance', '🚴‍♂️', TRUE, 9)
ON CONFLICT (slug) DO NOTHING;
