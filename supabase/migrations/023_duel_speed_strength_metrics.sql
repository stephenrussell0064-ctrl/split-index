-- Adds "speed" (best endurance score during the window) and "strength"
-- (best strength score during the window) as duel metrics alongside the
-- existing "sessions"/"load" — user feedback: duels should let two
-- athletes compete on who's faster or stronger, not just who logs more.
--
-- `duel_metric` is a Postgres enum (see 020_friend_duels.sql); adding a
-- value must run outside a transaction block, same rule documented in
-- 015_interval_fartlek_scoring.sql and 021_outdoor_cycling.sql.
ALTER TYPE duel_metric ADD VALUE IF NOT EXISTS 'speed';
ALTER TYPE duel_metric ADD VALUE IF NOT EXISTS 'strength';
