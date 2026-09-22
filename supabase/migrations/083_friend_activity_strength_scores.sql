-- 083: let a friend read the lifts inside one shared gym session.
--
-- NUMBERING. 083 because 082 is the highest version on any branch or tag,
-- checked across every ref rather than recalled.
--
-- WHAT WAS MISSING. The social feed shows a gym session as a title and a score.
-- Tapping it to see the actual lifts had nowhere to read them from:
-- `strength_scores` is owner-only under RLS (056 dropped the public-read
-- policy), and `public_strength_scores` — the view the leaderboard uses — has
-- no `activity_id` column, so there is no way to ask it for one session.
--
-- WHY A NEW VIEW RATHER THAN A COLUMN ON THAT ONE. Two reasons, and the second
-- matters more.
--
-- Adding a column means DROP and CREATE, because a view's column list cannot be
-- altered in place, and that view has readers. Additive is safer.
--
-- More importantly, `public_strength_scores` is deliberately broad: it exposes
-- every athlete who has a username, because a leaderboard is public by nature.
-- Per-session lift detail is not leaderboard data — it is somebody's training
-- diary — so this view is scoped to the viewer and their accepted friends, and
-- refuses both directions of a block. Reusing the broad view would have handed
-- every session's lifts to every signed-in account.
--
-- SECURITY INVOKER IS OFF, on purpose and not by inheritance. The predicate
-- below has to read `friends` and `blocked_users` to decide anything, and the
-- viewer cannot necessarily read those rows themselves. Off, the view evaluates
-- as its owner and the WHERE clause is the whole access rule — which is why
-- that clause names `auth.uid()` explicitly in every branch rather than
-- assuming a caller has already filtered.
--
-- `relative_strength` IS DELIBERATELY ABSENT, and its first draft had it. That
-- column is estimated_1rm_kg / bodyweight_kg, so publishing it beside the 1RM
-- hands any reader the athlete's bodyweight by division. WP1's projection guard
-- caught it — "columns that must never be projected" — which is the test doing
-- exactly the job it was written for.
--
-- WHAT IT DOES NOT EXPOSE. `notes` is not here and is not an oversight: it is
-- freeform, athletes write personal things in it, and none of it is needed to
-- render a list of lifts. `score_breakdown` is absent for the same reason it is
-- absent from every other public projection — it carries internal flags and
-- explanation strings that were never meant for another athlete's eyes.

CREATE OR REPLACE VIEW public_activity_strength_scores (
  activity_id,
  user_id,
  exercise_name,
  muscle_group,
  estimated_1rm_kg,
  volume_load_kg,
  strength_index,
  recorded_at
) AS
SELECT
  s.activity_id,
  s.user_id,
  s.exercise_name,
  s.muscle_group,
  s.estimated_1rm_kg,
  s.volume_load_kg,
  s.strength_index,
  s.recorded_at
FROM strength_scores s
WHERE
  -- Your own, always.
  s.user_id = auth.uid()
  OR (
    EXISTS (
      SELECT 1
      FROM friends f
      WHERE f.status = 'accepted'
        AND (
          (f.user_id = auth.uid() AND f.friend_id = s.user_id)
          OR (f.friend_id = auth.uid() AND f.user_id = s.user_id)
        )
    )
    -- A block ends the reading in both directions. Checking only the viewer's
    -- own blocks would let somebody keep reading the training of a person who
    -- blocked them, which is the half of blocking that actually matters.
    AND NOT EXISTS (
      SELECT 1
      FROM blocked_users b
      WHERE (b.blocker_id = auth.uid() AND b.blocked_id = s.user_id)
         OR (b.blocker_id = s.user_id AND b.blocked_id = auth.uid())
    )
  );

ALTER VIEW public_activity_strength_scores SET (security_invoker = off);

-- `anon` is never a friend of anybody, so every row would fail the predicate
-- anyway. Revoked regardless: a view that answers an unauthenticated caller at
-- all is one predicate change away from answering them with something.
REVOKE ALL ON public_activity_strength_scores FROM PUBLIC, anon;
GRANT SELECT ON public_activity_strength_scores TO authenticated;
