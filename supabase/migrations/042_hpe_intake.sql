-- Hybrid Plan Engine — WP2: the athlete intake.
--
-- HPE-ATHLETE-INTAKE-SPEC.md is explicit about what this table is: "the
-- contract between the onboarding UI and the plan generator. If a field is not
-- in this document, the engine must not depend on it." So the columns here are
-- exactly the fields the spec lists and nothing else — no speculative extras,
-- because a stored field the engine ignores is a question the athlete answered
-- for nothing.
--
-- What is deliberately NOT here: anything Split Index already holds. Age,
-- height, bodyweight, sex, resting and max HR live on `profiles`; 1RMs come
-- from the SRI engine; predicted 5k from the prediction engine; current weekly
-- volume from the logs. Design rule 1 is "nothing is asked twice" — those are
-- pre-filled and shown for confirmation, never re-entered, and duplicating
-- them here would create two sources of truth that drift apart.
--
-- One row per athlete, upserted. Intake is a standing answer that gets
-- revised, not an event log.

CREATE TABLE IF NOT EXISTS hpe_intake (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Which sections the athlete has actually been through. Sections C-H are
  -- skippable with documented degradation, so "not answered" and "answered
  -- no" have to be distinguishable — a nullable boolean cannot do that on its
  -- own, and the difference decides whether a conservative default applies.
  sections_completed TEXT[] NOT NULL DEFAULT '{}',

  -- ─── Section A: safety and eligibility (mandatory, blocking) ──────────────
  -- Nullable on purpose. NULL means unanswered, and every unanswered safety
  -- question resolves to the CONSERVATIVE value in code, per the spec's
  -- Missing column. Storing a default of false here would quietly convert
  -- "we never asked" into "they said no".
  parq_positive BOOLEAN,
  chest_pain_on_exertion BOOLEAN,
  current_injury_limiting BOOLEAN,
  injury_last_12_weeks BOOLEAN,
  injury_sites TEXT[] NOT NULL DEFAULT '{}',
  surgery_last_6_months BOOLEAN,
  pregnant_or_postpartum_12wk BOOLEAN,
  medication_affecting_hr BOOLEAN,

  -- The five-question low-energy-availability screen. Two or more positives
  -- blocks plan generation entirely and suppresses all bodyweight guidance;
  -- one suppresses the guidance and proceeds with fuelling reminders.
  lea_restricted_food BOOLEAN,
  lea_trains_fasted BOOLEAN,
  lea_unintended_weight_loss BOOLEAN,
  lea_bone_stress_injury BOOLEAN,
  -- Female athletes only. NULL here means "not applicable" as well as
  -- "unanswered", and the scoring function is told which case it is.
  lea_amenorrhoea BOOLEAN,

  -- ─── Section B: the goal (mandatory) ──────────────────────────────────────
  event_date DATE,
  events TEXT[] NOT NULL DEFAULT '{}',
  same_day BOOLEAN NOT NULL DEFAULT FALSE,
  inter_event_gap_h NUMERIC(4, 1) NOT NULL DEFAULT 4.0 CHECK (inter_event_gap_h BETWEEN 0.5 AND 14),
  event_order_known BOOLEAN NOT NULL DEFAULT FALSE,
  target_5k_s INTEGER CHECK (target_5k_s BETWEEN 720 AND 2700),
  target_total_kg NUMERIC(6, 1),
  -- Open product decision D2, resolved as the spec recommends: pre-set from
  -- the goal gap, movable by the athlete. Stored so a deliberate move is not
  -- overwritten by the next re-derivation.
  priority NUMERIC(3, 2) NOT NULL DEFAULT 0.5 CHECK (priority BETWEEN 0 AND 1),
  priority_user_set BOOLEAN NOT NULL DEFAULT FALSE,
  weight_class_kg NUMERIC(5, 1),
  intends_weight_cut BOOLEAN,
  federation TEXT,

  -- ─── Section C: current strength ──────────────────────────────────────────
  strength_training_years NUMERIC(4, 1) CHECK (strength_training_years BETWEEN 0 AND 40),
  current_strength_sessions_per_week SMALLINT CHECK (current_strength_sessions_per_week BETWEEN 0 AND 10),
  lift_variants JSONB NOT NULL DEFAULT '{}',
  equipment_used TEXT[] NOT NULL DEFAULT '{}',

  -- ─── Section D: current endurance ─────────────────────────────────────────
  -- The spec calls this "the most important field in this document". Stated
  -- here, reconciled against the logs in code, and the LOWER of the two wins.
  current_run_min_per_week SMALLINT CHECK (current_run_min_per_week BETWEEN 0 AND 800),
  longest_recent_run_min SMALLINT CHECK (longest_recent_run_min BETWEEN 0 AND 300),
  endurance_training_years NUMERIC(4, 1) CHECK (endurance_training_years BETWEEN 0 AND 40),
  primary_modality TEXT NOT NULL DEFAULT 'run',
  substitution_ok BOOLEAN NOT NULL DEFAULT TRUE,
  surface_access TEXT[] NOT NULL DEFAULT '{road}',

  -- ─── Section E: heart rate ────────────────────────────────────────────────
  -- resting_hr / max_hr live on `profiles` and are not duplicated. Only the
  -- two intake-specific answers are stored.
  max_hr_known BOOLEAN NOT NULL DEFAULT FALSE,
  hr_runs_high BOOLEAN NOT NULL DEFAULT FALSE,

  -- ─── Section F: availability (drives the scheduler directly) ──────────────
  days_available TEXT[] NOT NULL DEFAULT '{}',
  two_a_days_possible BOOLEAN NOT NULL DEFAULT FALSE,
  two_a_day_days TEXT[] NOT NULL DEFAULT '{}',
  -- Real clock times, not assumed ones. The spec: "an athlete training at
  -- 06:00 and 12:00 has a 6-hour gap while one training at 12:00 and 17:00
  -- does not. Assuming default clock times silently breaks the constraint the
  -- engine claims to enforce."
  am_hour NUMERIC(4, 2) NOT NULL DEFAULT 7 CHECK (am_hour BETWEEN 0 AND 23.99),
  pm_hour NUMERIC(4, 2) NOT NULL DEFAULT 18 CHECK (pm_hour BETWEEN 0 AND 23.99),
  max_sessions_per_week SMALLINT NOT NULL DEFAULT 6 CHECK (max_sessions_per_week BETWEEN 3 AND 12),
  max_hours_per_week NUMERIC(4, 1) NOT NULL DEFAULT 8 CHECK (max_hours_per_week BETWEEN 2 AND 20),
  max_session_min SMALLINT NOT NULL DEFAULT 90 CHECK (max_session_min BETWEEN 20 AND 240),
  min_rest_days SMALLINT NOT NULL DEFAULT 1 CHECK (min_rest_days BETWEEN 0 AND 4),
  gym_access_days TEXT[] NOT NULL DEFAULT '{}',
  travel_weeks SMALLINT[] NOT NULL DEFAULT '{}',

  -- ─── Section G: recovery and life load ────────────────────────────────────
  -- "Individually weak; collectively they are the difference between a plan
  -- that fits a life and one that fits a spreadsheet."
  sleep_hours_typical NUMERIC(3, 1) CHECK (sleep_hours_typical BETWEEN 3 AND 12),
  shift_work BOOLEAN NOT NULL DEFAULT FALSE,
  job_physicality TEXT NOT NULL DEFAULT 'sedentary' CHECK (job_physicality IN ('sedentary', 'on_feet', 'physical')),
  life_stress_now SMALLINT NOT NULL DEFAULT 3 CHECK (life_stress_now BETWEEN 1 AND 5),
  previous_max_volume SMALLINT CHECK (previous_max_volume BETWEEN 0 AND 800),

  -- ─── Section H: preferences ───────────────────────────────────────────────
  disliked_exercises TEXT[] NOT NULL DEFAULT '{}',
  preferred_long_day TEXT,
  preferred_rest_day TEXT,

  -- Free text is captured for the athlete's own notes only and never drives
  -- logic — design rule 3. Kept out of every code path that reads this table.
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_hpe_intake_updated ON hpe_intake(updated_at DESC);

ALTER TABLE hpe_intake ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own HPE intake" ON hpe_intake FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
