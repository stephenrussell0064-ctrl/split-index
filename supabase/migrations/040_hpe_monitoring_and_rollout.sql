-- Hybrid Plan Engine — WP10: monitoring, kill switch, phased rollout.
--
-- The assurance review's closing warning is the design constraint for this
-- whole file: "Both revisions score zero hard-rule violations, and Rev A was
-- not safe to ship. Constraint satisfaction is a necessary condition and a
-- poor proxy for quality. Whatever dashboard you build for this, do not let
-- '0 violations' become the metric anyone watches."
--
-- So the metrics here are deliberately about OUTCOMES and REFUSALS rather
-- than about the engine's own internal checks passing. Adherence, abandonment
-- and injury reports say whether the plans are any good. Block rate by reason
-- and refusal churn say what the engine is turning away and whether those
-- people come back. Tier distribution says whether the diagnostic is reaching
-- anyone at all, which is the question that decides if any of the rest
-- matters.

-- ─── Feature flags: the kill switch and the rollout dial ──────────────────────
-- One row per flag. `enabled` false is the kill switch: generation stops,
-- already-generated plans stay readable. That asymmetry is the requirement —
-- an athlete mid-block should not lose their plan because we paused new ones.
CREATE TABLE IF NOT EXISTS hpe_feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  -- 0-100. Deterministic per user, so an athlete inside the rollout stays
  -- inside it as the percentage rises rather than flickering in and out.
  rollout_percentage SMALLINT NOT NULL DEFAULT 0
    CHECK (rollout_percentage BETWEEN 0 AND 100),
  -- Why the flag is in its current state. Read by the dashboard and shown to
  -- operators; a kill switch with no recorded reason is an outage nobody can
  -- explain later.
  note TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Starts DISABLED at 0%. Phased rollout is opt-in by an operator, never a
-- default-on deploy.
INSERT INTO hpe_feature_flags (key, enabled, rollout_percentage, note)
VALUES ('hpe_generation', FALSE, 0, 'Initial deploy: generation off pending staged rollout.')
ON CONFLICT (key) DO NOTHING;

-- ─── Generation telemetry ─────────────────────────────────────────────────────
-- One row per generation attempt, including the ones that refused. The
-- refusals are the more interesting half: a safety screen nobody can get past
-- and a tier gate nobody can clear both look like "no plans generated" in a
-- naive metric, and they need completely different responses.
CREATE TABLE IF NOT EXISTS hpe_generation_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  constants_version TEXT NOT NULL,

  outcome TEXT NOT NULL CHECK (outcome IN (
    'generated',
    'safety_blocked',
    'insufficient_data',
    'missing_intake',
    'feature_disabled',
    'error'
  )),
  -- Stable slug for the specific reason, so block rate can be broken down by
  -- reason rather than reported as one undifferentiated number.
  reason_code TEXT,
  tier SMALLINT,
  plan_id UUID REFERENCES hpe_plans(id) ON DELETE SET NULL,
  profile_id UUID REFERENCES hpe_athlete_profile(id) ON DELETE SET NULL,
  peak_acwr NUMERIC(5, 2),
  weeks_out SMALLINT,
  session_count SMALLINT,
  hard_violations INTEGER
);

CREATE INDEX IF NOT EXISTS idx_hpe_gen_events_occurred ON hpe_generation_events(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hpe_gen_events_outcome ON hpe_generation_events(outcome, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_hpe_gen_events_user ON hpe_generation_events(user_id, occurred_at DESC);

-- ─── Adherence ────────────────────────────────────────────────────────────────
-- Feeds F16 autoregulation as well as the dashboard. Whether the athlete did
-- the session, how hard it felt, and whether they hit the prescription — the
-- three questions the review asked for as the minimum viable feedback loop.
CREATE TABLE IF NOT EXISTS hpe_session_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES hpe_sessions(id) ON DELETE CASCADE,
  logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed BOOLEAN NOT NULL,
  session_rpe NUMERIC(3, 1) CHECK (session_rpe BETWEEN 1 AND 10),
  met_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  -- F17: the athlete marked the day low-capacity and the engine swapped the
  -- session. Recorded so the swap rate is visible rather than invisible.
  low_capacity_flagged BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT,
  UNIQUE (session_id)
);

CREATE INDEX IF NOT EXISTS idx_hpe_feedback_user_logged ON hpe_session_feedback(user_id, logged_at DESC);

-- ─── Injury reports ───────────────────────────────────────────────────────────
-- The metric that matters most and is hardest to get. Self-reported, opt-in,
-- and linked to the plan week so an injury can be read against the ACWR and
-- the volume the athlete was actually carrying at the time.
CREATE TABLE IF NOT EXISTS hpe_injury_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  plan_id UUID REFERENCES hpe_plans(id) ON DELETE SET NULL,
  plan_week SMALLINT,
  site TEXT,
  severity TEXT CHECK (severity IN ('niggle', 'modified_training', 'stopped_training', 'medical')),
  -- Whether the athlete believes the plan contributed. Their attribution is
  -- not causation and must not be reported as though it were, but it is the
  -- only signal available and suppressing it would be worse.
  attributed_to_plan BOOLEAN,
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_hpe_injury_reported ON hpe_injury_reports(reported_at DESC);

-- ─── Row level security ───────────────────────────────────────────────────────
ALTER TABLE hpe_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpe_generation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpe_session_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpe_injury_reports ENABLE ROW LEVEL SECURITY;

-- Flags are readable by any authenticated user (the client needs to know
-- whether generation is available) and writable only by the service role,
-- which has no policy and therefore bypasses RLS. A kill switch a user can
-- flip is not a kill switch.
CREATE POLICY "Anyone signed in can read HPE flags" ON hpe_feature_flags FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Users read own HPE generation events" ON hpe_generation_events FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users insert own HPE generation events" ON hpe_generation_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users manage own HPE session feedback" ON hpe_session_feedback FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own HPE injury reports" ON hpe_injury_reports FOR ALL
  USING (auth.uid() = user_id);
