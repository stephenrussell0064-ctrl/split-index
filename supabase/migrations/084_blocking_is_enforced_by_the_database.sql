-- 084: make blocking a database rule, which the code already said it was.
--
-- NUMBERING. 084 because 083 is the highest version on any branch or tag,
-- checked across every ref rather than recalled.
--
-- ---------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ---------------------------------------------------------------------------
-- Two comments in the app assert that the database enforces blocking:
--
--   "the effect comes from migration 062, where `is_blocked_pair` is consulted
--    by the comment table's own select policy"   — api/moderation/block/route.ts
--   "The database enforces it too — `is_blocked_pair` in migration 062"
--                                                 — lib/moderation/index.ts
--
-- There is no `is_blocked_pair` in this schema and 062 is `admin_access_log`.
-- The function existed on a branch that was never merged, and the comments
-- crossed over without it. Anyone auditing blocking read those lines, believed
-- the database had it covered, and stopped — which is the most expensive kind
-- of wrong comment.
--
-- What actually held the line was `activity_is_visible_to`, and it has never
-- read `blocked_users`. Blocking worked anyway, for one reason: POST
-- /api/social/block deletes the friendship, and the predicate requires an
-- accepted friendship. Remove the friendship and the feed closes.
--
-- That is one `await` away from not being true, and in three ways:
--
--   1. The friendship delete is fire-and-forget — `await supabase.from(
--      "friends").delete()...` with no error check. If it fails, the block row
--      is written, the API answers `{ blocked: true }`, and the two athletes
--      carry on seeing each other with nothing anywhere recording that half
--      the block did not take.
--   2. POST /api/moderation/block writes the same block row and never touches
--      `friends` at all. It is not what the UI calls today; it is a live
--      authenticated endpoint that any client can call.
--   3. Neither route can help with the case below, which has nothing to do
--      with friendship.
--
-- THE CASE THAT IS REACHABLE TODAY. A blocks B. Both are friends with C. B
-- comments on C's activity. A opens it.
--
--   activity_is_visible_to(C's activity, A) is TRUE — A and C are friends, and
--   the predicate asks about the activity's OWNER. It never looks at who wrote
--   a comment. So the comment SELECT policy passes every comment on that
--   activity through, B's included, and the route hands back B's username,
--   display name and avatar with it.
--
-- Nothing downstream filters it. The route imports `assess` for profanity and
-- nothing for blocks; the client drops blocked ACTIVITY authors from the feed
-- list and never looks at comment authors. Symmetric, so B sees A's comments
-- too. `activity_reactions` has the identical policy shape and the identical
-- hole; it is closed here as well rather than left for the first read path
-- that decides to show who reacted.
--
-- ---------------------------------------------------------------------------
-- WHY A FUNCTION, AND WHY NOT `is_blocked_pair`
-- ---------------------------------------------------------------------------
-- An RLS USING clause is evaluated AS THE CALLER, and `blocked_users` carries
-- its own RLS: "Users manage own blocks", `USING (auth.uid() = blocker_id)`.
-- A bare `NOT EXISTS (SELECT 1 FROM blocked_users ...)` written inline in a
-- policy would therefore see only the rows where the viewer is the BLOCKER and
-- would be blind to the rows where they are the BLOCKED — enforcing exactly
-- the one-directional half of blocking that 083's comment calls out as the
-- half that does not matter. It has to be SECURITY DEFINER.
--
-- The unmerged `is_blocked_pair(a, b)` took two arbitrary ids, so any caller
-- could ask whether two named strangers had blocked each other — a fact about
-- two other people, answered to somebody who is neither. A peer session found
-- that and it is not being reintroduced. This function takes ONE id and pairs
-- it with `auth.uid()` internally, so the only question it can answer is about
-- the caller's own relationships, and there is no argument you can pass to
-- make it answer a different one.
--
-- ---------------------------------------------------------------------------
-- IMPACT — RUN THIS BEFORE APPLYING
-- ---------------------------------------------------------------------------
-- How many rows stop being visible, and to whom. Expect the comment count to
-- be the interesting one; a zero here means the gap was never exercised, not
-- that it was not open.
--
--   SELECT
--     (SELECT count(*) FROM blocked_users) AS blocks,
--     (SELECT count(*) FROM activity_comments c
--        JOIN blocked_users b
--          ON (b.blocked_id = c.user_id OR b.blocker_id = c.user_id)
--     ) AS comments_touching_a_block,
--     (SELECT count(*) FROM friends f JOIN blocked_users b
--        ON ((f.user_id = b.blocker_id AND f.friend_id = b.blocked_id)
--         OR (f.user_id = b.blocked_id AND f.friend_id = b.blocker_id))
--     ) AS blocks_whose_friendship_survived;
--
-- That last count is defect (1) and (2) above, measured. Every row in it is a
-- pair who blocked each other and can still read each other today.
--
-- ---------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ---------------------------------------------------------------------------
-- It does not revoke `activity_is_visible_to` from `anon`, and it does not
-- re-scope the `activities` policy. Both are recorded as settled decisions in
-- `src/lib/security/function-grants.test.ts` — the 031 policies carry no TO
-- clause, so anon evaluates them, and an anonymous SELECT on `activities`
-- answers 200-with-no-rows today. Revoking would turn that into a permission
-- error on a table the app reads while logged out. Unchanged here on purpose.
--
-- It does not restore a friendship on unblock, and it does not repair the
-- friendships that defect (2) left standing. Deleting rows that represent a
-- real connection between two real people is not something a migration should
-- decide; after this runs those pairs are hidden from each other by the block
-- itself, which is the outcome that was wanted.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The predicate, asked only about the caller
-- ---------------------------------------------------------------------------

-- SECURITY DEFINER so it can see both directions of `blocked_users` past that
-- table's own RLS; STABLE so it is evaluated once per statement per argument
-- rather than once per row scanned. Both columns are indexed (057).
CREATE OR REPLACE FUNCTION viewer_is_blocked_with(other_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM blocked_users b
    WHERE (b.blocker_id = auth.uid() AND b.blocked_id = other_id)
       OR (b.blocker_id = other_id AND b.blocked_id = auth.uid())
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- Supabase grants every new function to `anon` BY NAME at creation, and a
-- direct grant survives a revoke aimed at PUBLIC — so both are named here.
-- This is safe to revoke, unlike `activity_is_visible_to`: the only policies
-- that call it are scoped TO authenticated below, so no anonymous request ever
-- evaluates it and none can be turned into a permission error by this line.
REVOKE ALL ON FUNCTION viewer_is_blocked_with(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION viewer_is_blocked_with(UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. The owner check — defects (1) and (2)
-- ---------------------------------------------------------------------------

-- CREATE OR REPLACE keeps the signature and the OID, so all five policies that
-- reference this function carry on doing so with no window where activities
-- are unprotected. The body is 049's, with one clause added; everything else
-- is reproduced verbatim, including the comments, because a reader comparing
-- the two should see exactly one difference.
--
-- Grants are untouched by CREATE OR REPLACE, so the anon EXECUTE that 067
-- deliberately left in place stays in place. An anonymous caller still fails
-- at `viewer_id = auth.uid()` before reaching the new clause.
CREATE OR REPLACE FUNCTION activity_is_visible_to(check_activity_id UUID, viewer_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM activities a
    JOIN profiles p ON p.user_id = a.user_id
    WHERE a.id = check_activity_id
      AND a.is_draft = false
      -- Only ever answer about the authenticated caller. NULL for an
      -- anonymous request, and NULL = anything is NULL, so an unauthenticated
      -- caller is denied here before any of the branches below are reached.
      AND viewer_id = auth.uid()
      -- A block ends the reading in both directions, and does it here rather
      -- than relying on the friendship having been deleted by whichever route
      -- wrote the block. Self-blocks cannot exist (blocked_users_not_self), so
      -- this never hides an athlete from their own activity.
      AND NOT EXISTS (
        SELECT 1 FROM blocked_users b
        WHERE (b.blocker_id = viewer_id AND b.blocked_id = a.user_id)
           OR (b.blocker_id = a.user_id AND b.blocked_id = viewer_id)
      )
      AND (
        -- The owner, always — a private athlete is not hidden from themselves.
        a.user_id = viewer_id
        OR (
          -- ...and otherwise the AUTHOR's sharing flag, not the viewer's.
          p.share_activities_with_friends = true
          AND EXISTS (
            SELECT 1 FROM friends f
            WHERE f.status = 'accepted'
              AND (
                (f.user_id = viewer_id AND f.friend_id = a.user_id)
                OR (f.friend_id = viewer_id AND f.user_id = a.user_id)
              )
          )
        )
      )
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public;

-- ---------------------------------------------------------------------------
-- 3. The author check — the gap that is reachable today
-- ---------------------------------------------------------------------------

-- `activity_is_visible_to` answers about the activity's OWNER. On a mutual
-- friend's activity that is the wrong party, so the author is checked here,
-- per row, against the viewer.
--
-- TO authenticated is new. These policies had no TO clause, so they applied to
-- PUBLIC including anon — which changed nothing observable, because
-- `activity_is_visible_to` denies a NULL `auth.uid()` anyway, and it is what
-- makes revoking the new function from anon safe. An anonymous SELECT on
-- either table still answers 200 with no rows: no policy applies, so RLS
-- returns nothing, which is not an error.

DROP POLICY IF EXISTS "View comments on visible activities" ON activity_comments;
CREATE POLICY "View comments on visible activities" ON activity_comments FOR SELECT
  TO authenticated
  USING (
    activity_is_visible_to(activity_id, auth.uid())
    AND NOT viewer_is_blocked_with(user_id)
  );

DROP POLICY IF EXISTS "View reactions on visible activities" ON activity_reactions;
CREATE POLICY "View reactions on visible activities" ON activity_reactions FOR SELECT
  TO authenticated
  USING (
    activity_is_visible_to(activity_id, auth.uid())
    AND NOT viewer_is_blocked_with(user_id)
  );

-- The INSERT policies are left as they are. They already carry
-- `user_id = auth.uid() AND activity_is_visible_to(...)`, and with the owner
-- check added above, a blocked athlete can no longer write a comment or a
-- reaction onto the activity of somebody they are blocked with. Commenting on
-- a mutual friend's activity stays allowed, which is correct — the block is
-- between two people, not a ban from a third person's post. It is the reading
-- that is filtered.

COMMIT;
