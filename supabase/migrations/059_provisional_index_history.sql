-- The signup estimate must never outrank a session the athlete actually did.
--
-- WHAT WAS WRONG
-- --------------
-- Onboarding calibration writes one `split_index_history` row from the
-- athlete's self-reported bests, so they see a number before they have logged
-- anything. That row is unlike every other row in the table in three ways, and
-- all three combine badly:
--
--   * `activity_id` is NULL, so nothing can find it again. Every other writer
--     of this table — the activities route, score-and-persist, the merge route,
--     the recompute script — deletes and re-inserts BY activity_id. The
--     calibration row matches none of those predicates and is therefore
--     immortal: it cannot be recomputed, corrected or removed by anything the
--     application does.
--
--   * `recorded_at` defaults to NOW(), i.e. the moment of signup. Every real
--     row carries the ACTIVITY's own date instead (see 054 for why).
--
--   * migration 054's trigger picks the newest row by `recorded_at` and copies
--     it onto `profiles.current_*_index`, which is what the leaderboard, the
--     rank badge and every peer comparison read.
--
-- Put together: an athlete who signs up and then logs their existing training
-- — which is exactly what a new user does, and every one of those sessions is
-- BACK-DATED — never displaces the estimate. Their public index stays pinned
-- to a number they typed into a signup form, permanently, no matter how much
-- real training they log afterwards. Nothing in the app can clear it.
--
-- THE FIX
-- -------
-- Mark the estimate for what it is, and rank real sessions above it. The
-- ordering below reads: a scored session always wins; the estimate is used only
-- when there is nothing else, which is the one situation it was ever meant for.
--
-- Not a `WHERE activity_id IS NOT NULL` filter, deliberately. A row's link to
-- its activity is a foreign key that can be SET NULL by a delete, so "has an
-- activity" is not a durable statement about where a row came from. What it
-- came from does not change, so that is what is recorded.

ALTER TABLE split_index_history
  ADD COLUMN IF NOT EXISTS is_provisional BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN split_index_history.is_provisional IS
  'True for the single row written by onboarding calibration from self-reported '
  'bests. Ranked below every scored session by sync_profile_current_index(), and '
  'deleted once the athlete has any real one.';

-- Backfill. Every existing row with no activity behind it is a calibration row:
-- at the time of writing, onboarding is the only writer that inserts without an
-- activity_id, and the other writers' rows can only reach NULL via a delete
-- that also removes the row (ON DELETE SET NULL exists on the column, but the
-- application deletes the history row explicitly in every one of those paths).
UPDATE split_index_history SET is_provisional = TRUE WHERE activity_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_split_index_user_provisional
  ON split_index_history(user_id, is_provisional);

-- ─── The ranking change ───────────────────────────────────────────────────────
-- Identical to 054 except for one ORDER BY term. Everything 054's comment says
-- about recomputing from the table rather than copying NEW still applies and is
-- deliberately preserved.
CREATE OR REPLACE FUNCTION sync_profile_current_index()
RETURNS TRIGGER AS $$
DECLARE
  target_user UUID;
  latest RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_user := OLD.user_id;
  ELSE
    target_user := NEW.user_id;
  END IF;

  SELECT h.split_index, h.endurance_index, h.strength_index, h.recorded_at
    INTO latest
  FROM split_index_history h
  WHERE h.user_id = target_user
  -- is_provisional ASC first: FALSE sorts before TRUE, so every scored session
  -- outranks the signup estimate regardless of date, and the estimate is
  -- selected only when the athlete has no scored session at all.
  ORDER BY h.is_provisional ASC, h.recorded_at DESC NULLS LAST, h.id DESC
  LIMIT 1;

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

COMMENT ON FUNCTION sync_profile_current_index() IS
  'Keeps profiles.current_*_index in agreement with the athlete''s newest SCORED '
  'split_index_history row, falling back to the onboarding estimate only when '
  'there is none. Recomputes from the table rather than copying the triggering '
  'row, because history is NOT written in chronological order: recorded_at '
  'carries the activity''s own date, so back-dated sessions and edits arrive out '
  'of order, and deletes must be able to move the cache back down. Do not '
  '"optimise" this into copying NEW again.';

-- ─── Repair every athlete the old ordering left pinned ────────────────────────
-- Anyone who calibrated at signup and then logged only back-dated sessions is
-- currently showing their signup estimate as their current index. This sets
-- each cache to what the corrected query returns.
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
    ORDER BY sh.is_provisional ASC, sh.recorded_at DESC NULLS LAST, sh.id DESC
    LIMIT 1
  ) h ON TRUE
) AS latest
WHERE p.user_id = latest.user_id
  AND (
    p.current_split_index        IS DISTINCT FROM latest.split_index
    OR p.current_endurance_index IS DISTINCT FROM latest.endurance_index
    OR p.current_strength_index  IS DISTINCT FROM latest.strength_index
    OR p.index_updated_at        IS DISTINCT FROM latest.recorded_at
  );

-- ─── Clear estimates that have already been superseded ────────────────────────
-- An athlete with real scored sessions has no further use for the signup
-- estimate, and leaving it in the table puts a fabricated point on their trend
-- chart forever. Going forward the application deletes it on the first real
-- score (see clearProvisionalIndexHistory); this clears the backlog.
DELETE FROM split_index_history h
WHERE h.is_provisional
  AND EXISTS (
    SELECT 1 FROM split_index_history real
    WHERE real.user_id = h.user_id AND NOT real.is_provisional
  );
