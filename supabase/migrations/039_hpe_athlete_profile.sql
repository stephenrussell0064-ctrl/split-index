-- Hybrid Plan Engine — WP1 schema additions (brief Rev 2, "Two schema
-- additions for Rev 2").
--
-- Until now the diagnostic was recomputed on every request and thrown away.
-- That works for prescribing today's session and fails at the one thing the
-- Rev 2 addition to WP8 asks for: "the diagnostic re-runs every four weeks
-- against accumulating data. If the emphasis vector shifts by more than 0.10
-- on any dimension, the remaining macrocycle is regenerated and the athlete
-- is shown what changed and why." A comparison needs something to compare
-- against. Without these tables `compareEmphasis` is inert — correct code
-- that can never fire.
--
-- Four tables, because non-negotiable #7 needs findings to be rows rather
-- than a JSON blob: "every session in a generated plan is traceable to a
-- named diagnostic finding". A foreign key is what makes that traceability
-- real rather than a convention the application layer is trusted to honour.
--
--   hpe_athlete_profile  one row per diagnostic run
--   hpe_findings         one row per finding emitted by that run
--   hpe_plans            one row per generated plan
--   hpe_sessions         one row per prescribed session, finding_id NOT NULL

-- ─── Diagnostic runs ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hpe_athlete_profile (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Non-negotiable #2: stamped so a profile is never silently attributed to
  -- the wrong set of training constants. A constants bump is the one thing
  -- that can move an athlete's emphasis vector without their data changing,
  -- and drift analysis has to be able to tell those two cases apart.
  constants_version TEXT NOT NULL,

  tier SMALLINT NOT NULL CHECK (tier BETWEEN 0 AND 3),
  confidence NUMERIC(4, 3) NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  limiter TEXT NOT NULL CHECK (limiter IN ('endurance', 'strength')),

  -- The emphasis vector, seven weights summing to 1.0. Stored whole as JSONB
  -- rather than seven columns: it is read and compared as a unit, never
  -- queried a dimension at a time, and the dimension list is owned by
  -- hpe/constants.ts rather than by this schema.
  emphasis JSONB NOT NULL,

  -- Aerobic metrics.
  weekly_volume_km NUMERIC(7, 2),
  weekly_volume_min NUMERIC(8, 2),
  longest_run_km NUMERIC(6, 2),
  riegel_k NUMERIC(6, 4),
  riegel_verdict TEXT,
  decoupling NUMERIC(6, 4),
  decoupling_verdict TEXT,
  easy_fraction NUMERIC(5, 4),
  easy_fraction_source TEXT CHECK (easy_fraction_source IN ('heart-rate', 'pace')),
  intensity_verdict TEXT,
  volume_adequacy NUMERIC(6, 3),
  -- Anaerobic speed reserve in m/s. NULL is meaningful and common: it means
  -- no short maximal effort has been logged, not that the reserve is zero.
  -- See critical implementation note 0.
  speed_reserve_ms NUMERIC(5, 2),
  maximal_sprint_speed_ms NUMERIC(5, 2),
  maximal_aerobic_speed_ms NUMERIC(5, 2),
  predicted_5k_s NUMERIC(8, 1),
  predicted_5k_from_effort BOOLEAN NOT NULL DEFAULT FALSE,
  threshold_pace_s_per_km NUMERIC(8, 2),
  vo2max_pace_s_per_km NUMERIC(8, 2),
  hr_max SMALLINT,
  hr_rest SMALLINT,
  hr_max_source TEXT CHECK (hr_max_source IN ('measured', 'estimated')),
  runs_inside_easy_band SMALLINT,
  quality_session_count SMALLINT,
  -- The easy band and the HR-vs-pace model, each carrying the range it is
  -- valid across. Stored as JSONB because both are meaningless split apart:
  -- a regression without its fitted range is the exact defect critical
  -- implementation note 3 exists to prevent.
  easy_band JSONB,
  hr_pace_model JSONB,

  -- Strength metrics.
  one_rms JSONB,
  rep_profile_gap NUMERIC(6, 4),
  rep_profile_verdict TEXT,
  weak_lift TEXT,
  lift_ratios JSONB,
  stalled_lifts TEXT[] NOT NULL DEFAULT '{}',

  -- The unlock prompts: what this athlete would have to log to get a better
  -- diagnosis. A data-collection prompt that also happens to be a retention
  -- mechanic (brief 0e).
  data_gaps TEXT[] NOT NULL DEFAULT '{}',

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The four-weekly re-run reads the most recent profile for a user; nothing
-- else queries this table in bulk.
CREATE INDEX IF NOT EXISTS idx_hpe_profile_user_generated
  ON hpe_athlete_profile(user_id, generated_at DESC);

-- ─── Findings ─────────────────────────────────────────────────────────────────
-- One row per finding the run emitted. `finding_key` is the stable slug from
-- hpe/types.ts (FindingId); `body` is the plain-English string the athlete
-- actually reads. Brief 0d: "Those strings are the product — they are what
-- the athlete reads, and they are what makes the plan defensible."
CREATE TABLE IF NOT EXISTS hpe_findings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  profile_id UUID NOT NULL REFERENCES hpe_athlete_profile(id) ON DELETE CASCADE,
  finding_key TEXT NOT NULL,
  body TEXT NOT NULL,
  -- Order emitted, so the report screen can show them in the order the
  -- diagnostic reasoned rather than in an arbitrary one.
  ordinal SMALLINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (profile_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_hpe_findings_profile ON hpe_findings(profile_id);

-- ─── Plans ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hpe_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- RESTRICT, not CASCADE: a plan whose diagnostic has been deleted cannot
  -- explain itself, and an unexplainable plan is precisely what
  -- non-negotiable #7 forbids. Delete the plan first, or keep the profile.
  profile_id UUID NOT NULL REFERENCES hpe_athlete_profile(id) ON DELETE RESTRICT,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  constants_version TEXT NOT NULL,
  weeks_out SMALLINT NOT NULL,
  event_date DATE,
  -- The goal and constraints the plan was generated against, so a plan can be
  -- explained later without re-deriving what the athlete asked for at the time.
  goal JSONB NOT NULL DEFAULT '{}',
  constraints JSONB NOT NULL DEFAULT '{}',
  -- Set when a later diagnostic run superseded this plan, with the drift that
  -- caused it. NULL means current.
  superseded_at TIMESTAMPTZ,
  superseded_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpe_plans_user_generated ON hpe_plans(user_id, generated_at DESC);

-- ─── Sessions ─────────────────────────────────────────────────────────────────
-- finding_id is NOT NULL by design. Brief non-negotiable #7: "If the engine
-- cannot say *why* this athlete is doing this session, it does not prescribe
-- it." Making the column nullable would make that rule advisory; making it
-- NOT NULL makes the database refuse to store a session nobody can explain.
CREATE TABLE IF NOT EXISTS hpe_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  plan_id UUID NOT NULL REFERENCES hpe_plans(id) ON DELETE CASCADE,
  finding_id UUID NOT NULL REFERENCES hpe_findings(id) ON DELETE RESTRICT,

  week SMALLINT NOT NULL,
  phase TEXT NOT NULL,
  is_deload BOOLEAN NOT NULL DEFAULT FALSE,
  day_of_week TEXT,
  slot TEXT CHECK (slot IN ('AM', 'PM')),

  kind TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('endurance', 'strength')),
  emphasis_key TEXT NOT NULL,
  is_quality BOOLEAN NOT NULL DEFAULT FALSE,
  minutes NUMERIC(6, 1),
  distance_km NUMERIC(6, 2),
  pace_lo_s_per_km NUMERIC(8, 2),
  pace_hi_s_per_km NUMERIC(8, 2),
  hr_lo SMALLINT,
  hr_hi SMALLINT,
  -- Stated so the athlete knows how much to trust the band: their own
  -- regression, or HR reserve because the pace fell outside the range their
  -- own data covers.
  hr_source TEXT,
  prescription TEXT NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hpe_sessions_plan_week ON hpe_sessions(plan_id, week);
CREATE INDEX IF NOT EXISTS idx_hpe_sessions_finding ON hpe_sessions(finding_id);

-- ─── Row level security ───────────────────────────────────────────────────────
ALTER TABLE hpe_athlete_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpe_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpe_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE hpe_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own HPE profiles" ON hpe_athlete_profile FOR ALL
  USING (auth.uid() = user_id);

-- Findings and sessions carry no user_id of their own; ownership is inherited
-- through the parent, which keeps a single source of truth for who owns what.
CREATE POLICY "Users manage own HPE findings" ON hpe_findings FOR ALL
  USING (EXISTS (
    SELECT 1 FROM hpe_athlete_profile p
    WHERE p.id = hpe_findings.profile_id AND p.user_id = auth.uid()
  ));

CREATE POLICY "Users manage own HPE plans" ON hpe_plans FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Users manage own HPE sessions" ON hpe_sessions FOR ALL
  USING (EXISTS (
    SELECT 1 FROM hpe_plans pl
    WHERE pl.id = hpe_sessions.plan_id AND pl.user_id = auth.uid()
  ));
