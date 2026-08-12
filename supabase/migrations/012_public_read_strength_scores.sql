-- strength_scores only had a "Users manage own strength scores" FOR ALL
-- policy (auth.uid() = user_id) — fine for the user's own history views,
-- but it means any query for another user's rows silently returns nothing
-- under RLS. The By Exercise / By Muscle Group leaderboards need to read
-- everyone's rows, the same way workout_scores already allows via its
-- "Public leaderboard scores" policy. Add the matching public-read policy.
CREATE POLICY "Public leaderboard strength scores" ON strength_scores FOR SELECT
  USING (true);
