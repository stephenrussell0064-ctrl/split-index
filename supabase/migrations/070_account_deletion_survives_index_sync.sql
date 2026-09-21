-- ─────────────────────────────────────────────────────────────────────────────
-- Deleting an account failed for anyone who had ever been scored.
--
-- THE SYMPTOM. "Delete account and all data" returned "Something went wrong on
-- our side". Reproduced exactly: a fresh user deletes fine, and a user with a
-- SINGLE split_index_history row fails with GoTrue's "Database error deleting
-- user". Everyone who has logged a scored workout has those rows, so in
-- practice account deletion was broken for every real athlete — and App Store
-- Guideline 5.1.1(v) requires it to work.
--
-- THE CAUSE. Migration 054 widened split_index_history_sync_profile from
-- AFTER INSERT to AFTER INSERT OR UPDATE OR DELETE, so that editing or merging
-- a session could no longer leave profiles.current_*_index quoting a row that
-- no longer exists. Correct for those paths, and it also made the trigger fire
-- during the ON DELETE CASCADE from auth.users — where its `UPDATE profiles`
-- runs against a profiles row the very same cascade is deleting. Postgres
-- refuses that, the whole delete aborts, and nothing is removed.
--
-- Nothing was ever partially deleted, which is the one mercy here: the failure
-- is raised inside the single statement, so the account is left exactly as it
-- was rather than half-erased with a working login.
--
-- THE FIX. There is nothing to sync when the athlete is being erased — the
-- profile row is going too. Postgres deletes the parent auth.users row before
-- firing the cascade onto children, so "the user no longer exists" is an exact
-- test for "this delete is part of erasing the account", available from inside
-- the trigger and true for no other caller.
--
-- Deliberately NOT fixed by dropping DELETE from the trigger: that would
-- restore the stale-cache bug 054 was written to fix, where merging or editing
-- a session left the profile quoting a session that no longer existed.
--
-- Only the function changes. The trigger keeps firing on the same events, and
-- the edit, merge and unmerge paths behave exactly as they did.
--
-- The body below is 059's, not 054's. 059 added `is_provisional ASC` to the
-- ORDER BY so a signup estimate can never outrank a scored session; rebuilding
-- from 054 would have dropped that term while looking like an unrelated fix.
-- migration-supersession.test.ts is what caught that, and pointing
-- provisional-index.test.ts at this file is what keeps it catching it.
-- ─────────────────────────────────────────────────────────────────────────────

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

  /*
   * The account is being erased: the parent auth.users row is already gone and
   * profiles is being deleted by the same cascade. Updating it here is both
   * pointless and fatal — Postgres will not let a trigger update a row the
   * current command is deleting, and the whole account deletion fails.
   *
   * Every other caller — the edit path, merge, unmerge — deletes history rows
   * while the athlete still exists, so this check is false for them and the
   * sync below runs exactly as before.
   */
  IF TG_OP = 'DELETE'
     AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = target_user) THEN
    RETURN OLD;
  END IF;

  SELECT h.split_index, h.endurance_index, h.strength_index, h.recorded_at
    INTO latest
  FROM split_index_history h
  WHERE h.user_id = target_user
  -- is_provisional ASC first: FALSE sorts before TRUE, so every scored session
  -- outranks the signup estimate regardless of date, and the estimate is
  -- selected only when the athlete has no scored session at all. Carried
  -- forward from 059 unchanged — this migration only adds the guard above, and
  -- rebuilding the body from 054 instead would silently revert that ordering.
  ORDER BY h.is_provisional ASC, h.recorded_at DESC NULLS LAST, h.id DESC
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

COMMENT ON FUNCTION sync_profile_current_index() IS
  'Keeps profiles.current_*_index in agreement with the athlete''s newest '
  'split_index_history row. Recomputes from the table rather than copying the '
  'triggering row, because history is NOT written in chronological order. '
  'Returns early when the row is being removed by an account deletion — the '
  'profile is going too, and updating it mid-cascade aborts the delete '
  '(migration 070).';
