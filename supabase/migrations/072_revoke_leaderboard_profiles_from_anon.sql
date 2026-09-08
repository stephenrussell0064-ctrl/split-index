-- 072: leaderboard_profiles is readable by anon. Close it.
--
-- MY BUG, IN 064, AND THE SAME ONE I HAD ALREADY WRITTEN A TEST ABOUT.
--
-- 061 set the access on this view in three statements:
--
--   REVOKE ALL ON leaderboard_profiles FROM anon;
--   REVOKE ALL ON leaderboard_profiles FROM authenticated;
--   GRANT SELECT ON leaderboard_profiles TO authenticated;
--
-- 064 recreated the view and restated only the third. That reads like the
-- careful thing — grant exactly what is needed — and it is the opposite,
-- because a Supabase project bootstraps with
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
--
-- so a newly created view is granted to anon BY NAME at creation. The GRANT
-- adds nothing that was not already there and the missing REVOKE is the whole
-- of the access control. Confirmed from outside with the public anon key,
-- which returned real rows: username, display_name, avatar_url, country,
-- injury_status, all three indices, age_band, weight_band and sex.
--
-- This is the identical mechanism found twice earlier the same day on
-- FUNCTIONS — 065 granting where it meant to restrict, 060/061/063 revoking
-- from PUBLIC and leaving the by-name grant to anon standing. It applies to
-- TABLES AND VIEWS through a second ALTER DEFAULT PRIVILEGES line, and I wrote
-- 064 knowing the function half and did not carry it across.
--
-- The exposure is not catastrophic and it is not nothing: it is the entire
-- competitive-comparison projection, including a self-declared injury status
-- and a sex/age/weight banding, for every athlete with a verified address,
-- readable by anyone holding a key that ships in the client bundle.
--
-- public_profiles is deliberately NOT touched. It is the one view the anon
-- role is supposed to reach, because the profile page at
-- /social/profile/[username] renders for logged-out visitors, and 064 grants
-- it to anon on purpose.

REVOKE ALL ON leaderboard_profiles FROM anon;
REVOKE ALL ON leaderboard_profiles FROM authenticated;
GRANT SELECT ON leaderboard_profiles TO authenticated;

-- The four restored in 071 carry their own REVOKE lines already, copied from
-- 061 with the rest. Restated here anyway, because 070 and this file may be
-- applied in either order or one without the other, and a revoke that is
-- already in force costs nothing.

REVOKE ALL ON public_strength_scores FROM anon;
REVOKE ALL ON public_workout_scores FROM anon;
REVOKE ALL ON public_index_history FROM anon;
REVOKE ALL ON public_leaderboard_entries FROM anon;

-- Verify from the SQL editor:
--
--   SELECT viewname,
--          has_table_privilege('anon', 'public.' || viewname, 'SELECT') AS anon_can_read
--   FROM pg_views WHERE schemaname = 'public' AND viewname LIKE '%profiles%'
--      OR viewname LIKE 'public_%';
--
-- public_profiles is the only row that may say true.
