-- 087: the opt-in alcohol-free streak leaderboard.
--
-- NUMBERING. 087 because 086 is the highest version on any branch or tag in
-- this repo, checked at the moment this file was written rather than quoted
-- from memory (the rule 085's header sets out):
--   for r in $(git for-each-ref --format='%(refname:short)' refs/heads refs/tags refs/remotes); do
--     git ls-tree --name-only "$r" supabase/migrations/ | xargs -n1 basename
--   done | grep -oE '^[0-9]{3}' | sort -u | tail -1
--
-- WHAT THIS CHANGES ABOUT THE ALCOHOL FEATURE, AND WHY IT NEEDS CONSENT
-- ---------------------------------------------------------------------
-- 086 holds drink_logs as ordinary personal data rather than Article 9 special
-- category data, and src/lib/consent/article9.ts argues that on four
-- conditions. The second is NEVER SHARED. This migration is the deliberate,
-- narrow exception to it, and the exception is why an explicit consent gate
-- arrives alongside — publishing how long an identified athlete has gone
-- without a drink is special category data the moment another person can read
-- it, and explicit consent under Article 9(2)(a) is the only condition a
-- commercial fitness product can rely on for it.
--
-- So the gate is not decoration and must not be softened:
--   * Nobody appears on this board without a `granted` row in
--     article9_consent_events for the key below. Default is absent, which
--     reads as not granted.
--   * A withdrawal is a newer row with action='withdrawn', and it removes the
--     athlete from the view on the next read. No cache, no grace period.
--   * The board is the ONLY thing that leaves. drink_logs itself is untouched
--     and stays unreadable by anyone but its owner — this view never exposes
--     a drink, a unit, a volume, or a timestamp.
--
-- WHY A STREAK AND NOT A COUNT
-- ----------------------------
-- The feature as first described was a leaderboard of drinks logged. Ranking
-- athletes by how much they drink rewards drinking, which is a poor thing for
-- a training app to gamify and a poor thing to explain to App Review. Days
-- since the last drink ranks the same people on the same data in the opposite
-- direction, and it is the number an athlete would actually want to beat.
--
-- WHAT THE NUMBER MEANS, INCLUDING WHERE IT IS WEAK
-- -------------------------------------------------
-- streak_days is whole days since the athlete's most recent logged drink, or —
-- for somebody who has consented and never logged one — since they joined the
-- board. The second case matters: measuring only from a logged drink would
-- exclude every teetotaller from a leaderboard about not drinking, which is
-- absurd. `tracked_days` is published beside it so a long streak on two days
-- of history cannot be read as a long streak on two years of it.
--
-- It is self-reported and therefore gameable by simply not logging. That is
-- inherent to any self-logged metric and is not worth engineering against;
-- what matters is that it is never presented as verified.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- The view
-- ─────────────────────────────────────────────────────────────────────────────
-- Column list stated explicitly, as every projection view in this schema does.
-- It is the security boundary: what is not named here cannot leak, whatever a
-- later edit to the SELECT adds.
CREATE OR REPLACE VIEW public_alcohol_free_streaks (
  user_id,
  username,
  display_name,
  avatar_url,
  streak_days,
  tracked_days
) AS
WITH latest_consent AS (
  -- Newest event per athlete wins, exactly as getConsent() resolves it in the
  -- application. DISTINCT ON rather than a window function for the index on
  -- (user_id, consent_key, created_at DESC) from 060 to be usable.
  SELECT DISTINCT ON (e.user_id)
    e.user_id,
    e.action,
    e.created_at AS decided_at
  FROM article9_consent_events e
  WHERE e.consent_key = 'alcohol_free_streak_leaderboard'
  ORDER BY e.user_id, e.created_at DESC
),
drink_history AS (
  SELECT
    d.user_id,
    MAX(d.drank_at) AS last_drink_at,
    MIN(d.drank_at) AS first_drink_at
  FROM drink_logs d
  GROUP BY d.user_id
)
SELECT
  p.user_id,
  p.username,
  p.display_name,
  p.avatar_url,
  GREATEST(
    0,
    FLOOR(
      EXTRACT(EPOCH FROM (NOW() - COALESCE(dh.last_drink_at, c.decided_at))) / 86400
    )
  )::INT AS streak_days,
  GREATEST(
    0,
    FLOOR(
      EXTRACT(EPOCH FROM (NOW() - LEAST(COALESCE(dh.first_drink_at, c.decided_at), c.decided_at))) / 86400
    )
  )::INT AS tracked_days
FROM profiles p
JOIN latest_consent c
  ON c.user_id = p.user_id
 AND c.action = 'granted'
LEFT JOIN drink_history dh
  ON dh.user_id = p.user_id
-- Blocking is a database rule since 084, and every new read path filters with
-- this rather than re-implementing the pair check.
WHERE NOT viewer_is_blocked_with(p.user_id);

-- security_invoker = off so the view can read `article9_consent_events` and
-- `drink_logs` past their owner-scoped RLS — which is the whole mechanism by
-- which a leaderboard shows anybody but you. The consent JOIN is what makes
-- that safe: reading past RLS is only acceptable because the predicate above
-- restricts it to people who asked to be there.
ALTER VIEW public_alcohol_free_streaks SET (security_invoker = off);

-- 085 removed the default grant to `anon` for new tables but NOT for views, so
-- this revoke is load-bearing rather than ceremonial. `anon` has no auth.uid(),
-- so viewer_is_blocked_with() would behave oddly for it in any case — but the
-- reason it is revoked is simpler: this is health-adjacent data about named
-- people and a signed-out visitor has no business reading it.
REVOKE ALL ON public_alcohol_free_streaks FROM PUBLIC, anon;
GRANT SELECT ON public_alcohol_free_streaks TO authenticated;

COMMENT ON VIEW public_alcohol_free_streaks IS
  'Opt-in leaderboard of days since an athlete''s last logged drink. Only rows '
  'for users whose newest article9_consent_events row for '
  '''alcohol_free_streak_leaderboard'' is ''granted''. Exposes no drink, unit, '
  'volume or timestamp — a streak and a tracked-days count only.';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- AFTERWARDS
-- ─────────────────────────────────────────────────────────────────────────────
-- Prove the gate rather than trusting it. With no consent row anywhere, the
-- board must be empty:
--
--   SELECT count(*) FROM public_alcohol_free_streaks;          -- want 0
--   SELECT has_table_privilege('anon', 'public.public_alcohol_free_streaks', 'SELECT');
--                                                              -- want false
--
-- And drink_logs itself must be exactly as private as it was before this ran:
--
--   SELECT has_table_privilege('anon', 'public.drink_logs', 'SELECT');  -- want false
--
-- Then record a row in docs/pre-launch/migration-reconciliation.md §1. A
-- migration is not done until it has a ledger row.
