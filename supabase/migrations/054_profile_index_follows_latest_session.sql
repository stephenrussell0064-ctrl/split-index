-- The profile's current index must follow the LATEST session, not the last
-- one written.
--
-- THE BUG
-- -------
-- `sync_profile_current_index()` (002, re-declared in 002b) fired AFTER INSERT
-- on split_index_history and copied NEW straight onto the profile:
--
--     current_split_index = NEW.split_index, index_updated_at = NEW.recorded_at
--
-- with no comparison against what the profile already held. Last write wins,
-- regardless of date.
--
-- That is only safe if history rows always arrive in chronological order, and
-- they deliberately do not. Both write paths stamp `recorded_at` with the
-- ACTIVITY's own date, never insert time — api/activities/route.ts and
-- lib/activities/score-and-persist.ts both carry the comment explaining why
-- (analytics group by calendar day off this column, so a back-dated session
-- stamped "today" collapses into today's bucket and breaks every time series).
--
-- So the ordinary act of logging or editing a session from last week wrote
-- last week's index onto the profile as "current". The athlete's headline
-- number, their leaderboard position, their rank badge and every peer
-- comparison then read a number from a session that is not their most recent.
-- Editing an old session to fix a typo was enough to do it.
--
-- Observed live before this migration: an athlete whose newest history row was
-- 676 had current_split_index = 655 with index_updated_at pointing at an
-- earlier session the same day — the older row had simply been inserted last.
--
-- WHY NOT JUST GUARD THE INSERT
-- -----------------------------
-- The obvious fix is "only overwrite when NEW.recorded_at >= index_updated_at".
-- That fixes the back-dated INSERT and nothing else, and it leaves the profile
-- permanently stale in the opposite direction: DELETE the newest session and
-- the profile keeps quoting the score of a session that no longer exists,
-- because no INSERT will ever fire to correct it. The edit path deletes and
-- re-inserts, and merge/unmerge delete outright, so this is a real path, not a
-- hypothetical one.
--
-- Recomputing from the newest surviving row instead makes the column what it
-- was always documented to be — a denormalized cache of a query — rather than
-- a running total of whatever happened to be written last. It is then
-- self-healing: any row arriving, changing or leaving puts the cache back in
-- agreement with the table, whatever order things happened in.
--
-- COST
-- ----
-- One indexed single-row lookup per history row written, served by
-- idx_split_index_user_time (user_id, recorded_at DESC) from 001. History is
-- written once per logged session, and in bulk only by the recompute script,
-- where a few dozen extra index probes are not measurable.
--
-- NULLS LAST on the ordering because recorded_at is nullable (it has a
-- DEFAULT, not a NOT NULL). A row with no date must never outrank a dated one;
-- it can only win when it is the only row there is. The id tiebreak just makes
-- the outcome deterministic when two sessions share an exact timestamp.

CREATE OR REPLACE FUNCTION sync_profile_current_index()
RETURNS TRIGGER AS $$
DECLARE
  target_user UUID;
  latest RECORD;
BEGIN
  -- NEW is unassigned on DELETE and OLD is unassigned on INSERT, so neither
  -- can be dereferenced unconditionally.
  IF TG_OP = 'DELETE' THEN
    target_user := OLD.user_id;
  ELSE
    target_user := NEW.user_id;
  END IF;

  SELECT h.split_index, h.endurance_index, h.strength_index, h.recorded_at
    INTO latest
  FROM split_index_history h
  WHERE h.user_id = target_user
  ORDER BY h.recorded_at DESC NULLS LAST, h.id DESC
  LIMIT 1;

  -- No rows left for this athlete: SELECT INTO leaves every field NULL and the
  -- UPDATE below clears the cache, which is correct — an athlete with no
  -- scored sessions has no current index, and NULL is what the leaderboard
  -- queries already filter on ("current_split_index is not null").
  UPDATE profiles SET
    current_split_index     = latest.split_index,
    current_endurance_index = latest.endurance_index,
    current_strength_index  = latest.strength_index,
    index_updated_at        = latest.recorded_at
  WHERE user_id = target_user;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- UPDATE and DELETE are new here. The edit path deletes a session's history row
-- and re-inserts it; merge/unmerge delete rows outright. Under the old
-- INSERT-only trigger a delete left the cache quoting a session that no longer
-- existed, and there was no way back short of logging something new.
DROP TRIGGER IF EXISTS split_index_history_sync_profile ON split_index_history;
CREATE TRIGGER split_index_history_sync_profile
  AFTER INSERT OR UPDATE OR DELETE ON split_index_history
  FOR EACH ROW EXECUTE FUNCTION sync_profile_current_index();

COMMENT ON FUNCTION sync_profile_current_index() IS
  'Keeps profiles.current_*_index in agreement with the athlete''s newest '
  'split_index_history row. Recomputes from the table rather than copying the '
  'triggering row, because history is NOT written in chronological order: '
  'recorded_at carries the activity''s own date, so back-dated sessions and '
  'edits arrive out of order, and deletes must be able to move the cache back '
  'down. Do not "optimise" this into copying NEW again.';

-- ─── Re-sync every profile ────────────────────────────────────────────────────
-- Repairs any athlete the old trigger left stale. Not a data change in its own
-- right: it sets each cache to the value the query it caches already returns,
-- so an athlete the old trigger happened to get right is written with what
-- they already have. Profiles with no history are set to NULL, which is what
-- they hold today.
UPDATE profiles p SET
  current_split_index     = latest.split_index,
  current_endurance_index = latest.endurance_index,
  current_strength_index  = latest.strength_index,
  index_updated_at        = latest.recorded_at
FROM (
  SELECT
    pr.user_id,
    h.split_index,
    h.endurance_index,
    h.strength_index,
    h.recorded_at
  FROM profiles pr
  LEFT JOIN LATERAL (
    SELECT sh.split_index, sh.endurance_index, sh.strength_index, sh.recorded_at
    FROM split_index_history sh
    WHERE sh.user_id = pr.user_id
    ORDER BY sh.recorded_at DESC NULLS LAST, sh.id DESC
    LIMIT 1
  ) h ON TRUE
) AS latest
WHERE p.user_id = latest.user_id
  AND (
    p.current_split_index     IS DISTINCT FROM latest.split_index
    OR p.current_endurance_index IS DISTINCT FROM latest.endurance_index
    OR p.current_strength_index  IS DISTINCT FROM latest.strength_index
    OR p.index_updated_at        IS DISTINCT FROM latest.recorded_at
  );
