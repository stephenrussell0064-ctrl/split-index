-- 073: Take public read off the base tables. 056 already did this; 056 was
-- never applied.
--
-- WHAT IS TRUE IN PRODUCTION RIGHT NOW
-- -----------------------------------
-- With the anon key that ships in the client bundle, an unauthenticated
-- caller can read:
--
--   profiles              every row, every column — date_of_birth, weight_kg,
--                         height_cm, gender, age, max_hr, resting_hr,
--                         injury_status, bio, stripe_customer_id,
--                         subscription_tier, subscription_status
--   workout_scores        every row
--   split_index_history   every row
--
-- Measured, not inferred: 4, 97 and 97 rows respectively, counted through
-- PostgREST with Prefer: count=exact.
--
-- 056 exists for no other purpose than to stop this. Its own comment lists the
-- columns anon "could read until this migration" and that list is exactly what
-- production still returns. Nothing after 056 recreates these policies, so the
-- only reading consistent with the evidence is that 056's policy drops never
-- reached the database — while the VIEWS it introduced did arrive, because
-- 061 and 064 recreate them. Half of that migration is live and half is not,
-- which is why the projections look like they are working.
--
-- The policies below all come from 001 and 053 and carry no TO clause, so they
-- apply to every role including anon. `USING (username IS NOT NULL)` is not a
-- privacy rule; it is "anyone, for any profile that has picked a name".

DROP POLICY IF EXISTS "Public profiles readable" ON profiles;
DROP POLICY IF EXISTS "Public leaderboard strength scores" ON strength_scores;
DROP POLICY IF EXISTS "Public leaderboard scores" ON workout_scores;
DROP POLICY IF EXISTS "Public leaderboard index" ON split_index_history;
DROP POLICY IF EXISTS "Public challenge progress" ON challenge_participants;
DROP POLICY IF EXISTS "Anyone can view leaderboards" ON leaderboard_entries;

-- The owner policies are untouched and are what keeps every athlete's own
-- rows reachable: "Users can view own profile" (001), "Users manage own
-- strength scores" (002), "Users manage own scores" (001), "Users manage own
-- index history" (001), "Users manage own challenge participation" (001).
-- Everything cross-athlete goes through the public_* views, which are
-- security_invoker = off and so are unaffected by any of this.

-- ─── profile_usernames ──────────────────────────────────────────────────────
--
-- WHY ONE MORE VIEW, when 056 added six.
--
-- Two routes read `profiles` across athletes and would otherwise break. Both
-- are authenticated-only, and both were checked one at a time; the other four
-- cross-athlete reads in the codebase either use the service role or filter by
-- an activity the caller already owns, which the owner policies still allow.
--
--   /api/friends           looks an athlete up by username to send a request.
--                          Moves to public_profiles, which is the right
--                          answer: 061 gates public visibility on a confirmed
--                          address, and someone who cannot receive mail should
--                          not be discoverable.
--
--   /api/profile/username-check  asks whether a name is taken. This one CANNOT
--                          use public_profiles, and the reason is the whole
--                          point of this view: uniqueness has to consider
--                          every account, verified or not. `username` is
--                          UNIQUE at the column level (001), so reading only
--                          verified rows would report a name as free, let the
--                          athlete choose it, and fail the save with a
--                          constraint violation they cannot act on.
--
-- Two columns, no more. user_id is here because the check has to let an
-- athlete keep their own name.

DROP VIEW IF EXISTS profile_usernames;
CREATE VIEW profile_usernames (user_id, username) AS
SELECT p.user_id, p.username
FROM profiles p
WHERE p.username IS NOT NULL;

ALTER VIEW profile_usernames SET (security_invoker = off);

-- Revoked from anon explicitly, not merely granted to authenticated. A new
-- view is granted to anon BY NAME by Supabase's ALTER DEFAULT PRIVILEGES, so a
-- narrow grant on its own leaves anon exactly where it was — the mistake 064
-- made with leaderboard_profiles and 072 repaired.
REVOKE ALL ON profile_usernames FROM anon;
REVOKE ALL ON profile_usernames FROM authenticated;
GRANT SELECT ON profile_usernames TO authenticated;

-- ─── Verify ─────────────────────────────────────────────────────────────────
--
--   SELECT tablename, policyname FROM pg_policies
--   WHERE schemaname = 'public' AND policyname IN (
--     'Public profiles readable', 'Public leaderboard strength scores',
--     'Public leaderboard scores', 'Public leaderboard index',
--     'Public challenge progress', 'Anyone can view leaderboards');
--
-- Zero rows. And from outside, with the anon key, profiles / workout_scores /
-- split_index_history should all return an empty array rather than data.
--
-- DEPLOY THE CODE FIRST. Both route changes read views that already exist and
-- work whether or not these policies are still in place, so the safe order is
-- code, then this. The reverse leaves the username check and the friend
-- lookup briefly answering nothing.
