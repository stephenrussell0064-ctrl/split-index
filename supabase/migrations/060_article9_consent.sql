-- WP11 — explicit consent for special category health data (UK GDPR Art. 9(2)(a)).
--
-- WHAT WAS WRONG
-- --------------
-- The Hybrid Plan intake asks for PAR-Q status, chest pain on exertion, injury
-- history and sites, recent surgery, pregnancy and postpartum status,
-- medication affecting heart rate, and a five-question low-energy-availability
-- screen including amenorrhoea and bone stress injury. Those questions exist to
-- determine health status — that is their entire purpose — which puts every one
-- of them in Article 9.
--
-- They were collected with no consent gate, no consent record, and no way to
-- withdraw. The privacy policy hedged it as processing "based on your explicit
-- consent and/or because it is necessary for the provision of our fitness
-- analytics service", which is two lawful bases in a trench coat: Article 9 has
-- no "necessary for the service" condition for a commercial fitness product,
-- and an explicit consent nobody was ever asked for cannot be evidenced.
--
-- A consent you cannot evidence is a consent you do not have. Hence an event
-- log rather than a boolean column.
--
-- WHY AN APPEND-ONLY EVENT LOG
-- ----------------------------
-- A `has_consented BOOLEAN` on profiles would answer "do they consent now" and
-- nothing else. The questions that actually get asked are "what exactly did
-- they agree to", "what did the screen say when they agreed", and "when".
-- So each grant and each withdrawal is a row, carrying the exact wording shown
-- and the version of that wording, and rows are never updated or deleted.
--
-- That is enforced at the policy level below, not by convention: there is a
-- SELECT policy and an INSERT policy and deliberately no UPDATE or DELETE
-- policy, so an athlete (and any code running as them) can add to their own
-- history and read it, and cannot rewrite it. Postgres RLS denies anything no
-- policy permits, so the absence is the enforcement.
--
-- The one thing that does remove rows is the account cascade from auth.users.
-- That is correct: erasure of the data subject takes the evidence with it,
-- because the evidence is itself their personal data.
--
-- WHAT THIS TABLE IS NOT
-- ----------------------
-- Not a general consent framework. One key ships today
-- (`hpe_health_intake`) and `consent_key` exists so that a second category —
-- marketing email under PECR, say — does not need a second table and a second
-- set of policies. It is not an invitation to bundle: Article 9 consent must
-- stay granular and separately refusable, which is the whole point of keying
-- it rather than storing one flag.

CREATE TABLE IF NOT EXISTS article9_consent_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- 'granted' or 'withdrawn'. Both are events; neither overwrites the other.
  action TEXT NOT NULL CHECK (action IN ('granted', 'withdrawn')),

  -- Which consent this is. One value today; see the note above.
  consent_key TEXT NOT NULL,

  -- The version identifier of the wording, and the wording itself. Both,
  -- deliberately: the version makes "who saw v2" answerable with a WHERE
  -- clause, and the full text makes it answerable even if the version string
  -- is later reused or the source file is lost. Storage is trivial next to
  -- being unable to say what somebody actually agreed to.
  wording_version TEXT NOT NULL,
  wording_text TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Current state is "the newest event for this user and key", so that is the
-- lookup this index serves.
CREATE INDEX IF NOT EXISTS idx_article9_consent_latest
  ON article9_consent_events (user_id, consent_key, created_at DESC);

ALTER TABLE article9_consent_events ENABLE ROW LEVEL SECURITY;

-- SELECT and INSERT only. The missing UPDATE and DELETE policies are the
-- append-only guarantee — do not add them.
CREATE POLICY "Users read own consent history" ON article9_consent_events
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users record own consent events" ON article9_consent_events
  FOR INSERT WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE article9_consent_events IS
  'Append-only evidence of Article 9(2)(a) explicit consent for special category '
  'health data. One row per grant or withdrawal, carrying the exact wording shown '
  'and its version. Has SELECT and INSERT policies and deliberately no UPDATE or '
  'DELETE policy: a consent record that can be rewritten is not evidence.';

COMMENT ON COLUMN article9_consent_events.wording_text IS
  'The exact text the athlete was shown when they acted. Stored in full rather than '
  'referenced, so the question "what did they agree to" stays answerable after the '
  'source file changes.';

-- ─── Withdrawal is a deletion, not a flag ───────────────────────────────────
-- "Withdrawal deletes the Tier 2 data rather than merely hiding it." A boolean
-- that suppresses rendering leaves the answers sitting in the table, which is
-- exactly what the athlete asked to stop.
--
-- This runs as SECURITY DEFINER so it can clear the columns in one statement
-- without the caller needing rights it should not have, and it takes no user
-- argument at all — it acts on auth.uid() and nothing else, so it cannot be
-- pointed at somebody else's row. Same reasoning as activity_is_visible_to()
-- in migration 049: a function that takes a user id is an oracle waiting to
-- happen.
--
-- What it clears, and why that list and not another:
--
--   * hpe_intake's health and fuelling columns — the Article 9 answers
--     themselves. NULLed rather than the row deleted, because the same row
--     holds Tier 1 training answers (goal, availability, training history)
--     which are processed on contract necessity and are not the athlete's to
--     lose by withdrawing a separate consent.
--   * hpe_injury_reports — injury history in full, Tier 2 throughout.
--   * hpe_findings — carries the safety screen's output, which restates the
--     health answers back ("medical clearance recommended before...").
--
-- What it deliberately does NOT delete: hpe_plans and hpe_sessions. A plan is
-- a training schedule — it prescribes sessions, it does not characterise the
-- athlete's health — and deleting weeks of someone's programme as a side
-- effect of a privacy choice would punish the choice. New generation stops
-- because the safety screen can no longer run; the block they are part-way
-- through stays readable. Flag for review if that reading is ever challenged.

CREATE OR REPLACE FUNCTION withdraw_article9_health_data()
RETURNS VOID AS $$
BEGIN
  UPDATE hpe_intake SET
    parq_positive = NULL,
    chest_pain_on_exertion = NULL,
    current_injury_limiting = NULL,
    injury_last_12_weeks = NULL,
    injury_sites = '{}',
    surgery_last_6_months = NULL,
    pregnant_or_postpartum_12wk = NULL,
    medication_affecting_hr = NULL,
    lea_restricted_food = NULL,
    lea_trains_fasted = NULL,
    lea_unintended_weight_loss = NULL,
    lea_bone_stress_injury = NULL,
    lea_amenorrhoea = NULL,
    -- The athlete has not "completed" screens whose answers no longer exist.
    sections_completed = ARRAY(
      SELECT s FROM unnest(sections_completed) AS s
      WHERE s NOT IN ('health', 'fuelling')
    ),
    updated_at = NOW()
  WHERE user_id = auth.uid();

  DELETE FROM hpe_injury_reports WHERE user_id = auth.uid();
  DELETE FROM hpe_findings WHERE user_id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION withdraw_article9_health_data() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION withdraw_article9_health_data() TO authenticated;

COMMENT ON FUNCTION withdraw_article9_health_data() IS
  'Clears every Article 9 answer for the CALLING user (auth.uid() only — takes no '
  'argument, so it cannot be aimed at another athlete). NULLs the health and '
  'fuelling columns on hpe_intake rather than deleting the row, because that row '
  'also holds Tier 1 training answers held on contract necessity.';
