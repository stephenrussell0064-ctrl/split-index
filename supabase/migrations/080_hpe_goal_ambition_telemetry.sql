-- Numbered 080 on purpose.
--
-- Checked against every branch, tag and remote ref in the repository at the
-- time of writing: 079 is the highest in use (079_personal_best_efforts).
-- Supabase records applied migrations by the leading version number, so a file
-- reusing a number already applied is read as already-done and skipped in
-- silence — the columns below would never be created and the failure would
-- surface as a missing column at runtime rather than as a failed push.
--
-- Hybrid Plan Engine — goal-ambition telemetry (constants 3.0.0).
--
-- HPE-EVIDENCE-REVIEW-2026-09.md, section 4: "No dataset ties goal ambition to
-- plan abandonment. The model's stretch / multi-block grading is the best
-- available proxy. Instrumenting abandonment against the required-gain z-score
-- is the single most valuable number this product could collect."
--
-- That is not a rhetorical flourish. The feasibility model grades a target as
-- within-reach, stretch or multi-block from published cohort spreads, and the
-- goal-setting literature it leans on (Bar-Eli 1997; Locke & Latham; Swann
-- 2021) is about performance in short supervised experiments, not about who
-- quietly stops opening the app. Nobody has published the curve that matters
-- here: how far past their own mean a person's target can sit before they
-- abandon the block. Split Index is in an unusually good position to measure
-- it, because it already knows the required gain at generation time and
-- already tracks whether the sessions got done.
--
-- So: record the ambition when the plan is generated. The abandonment side is
-- already derivable from hpe_session_feedback and the activity log, and the
-- join is user_id plus occurred_at. No analysis is shipped with this
-- migration — an analysis over zero rows would be worse than none, and the
-- rows have to start accumulating before there is anything to look at.
--
-- Nothing here is health data. The z-score is a distance between two numbers
-- the athlete typed and a population rate; the goal level is a three-value
-- label derived from it. Article 9 does not bite, and the columns are
-- deliberately narrow so that it stays that way.

ALTER TABLE hpe_generation_events
  -- How many standard deviations above this athlete's own expected outcome the
  -- stated target sits. Negative means the target is easier than the block is
  -- expected to deliver. NULL when no target of that kind was set.
  ADD COLUMN IF NOT EXISTS endurance_goal_z NUMERIC(6, 3),
  ADD COLUMN IF NOT EXISTS strength_goal_z NUMERIC(6, 3),

  -- The label the athlete was actually shown, stored alongside the number that
  -- produced it so a later change to the thresholds cannot silently rewrite
  -- history.
  ADD COLUMN IF NOT EXISTS endurance_goal_level TEXT
    CHECK (endurance_goal_level IN ('within-reach', 'stretch', 'multi-block')),
  ADD COLUMN IF NOT EXISTS strength_goal_level TEXT
    CHECK (strength_goal_level IN ('within-reach', 'stretch', 'multi-block')),

  -- The probability quoted to the athlete, adherence included. Worth storing
  -- separately from the z-score: the z-score is about the goal, this is about
  -- the goal AND the plan AND the odds of finishing it, and the three come
  -- apart for a time-poor athlete with a modest target.
  ADD COLUMN IF NOT EXISTS endurance_goal_probability NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS strength_goal_probability NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS adherence_prior NUMERIC(4, 3),

  -- What the plan actually delivered per week, so a shortfall can be read as
  -- an under-dosed plan rather than as an unwilling athlete. The dose gates
  -- (Montero & Lundby 2017) mean these two numbers explain a large share of
  -- any missed projection before ambition is blamed for it.
  ADD COLUMN IF NOT EXISTS delivered_endurance_min NUMERIC(6, 1),
  ADD COLUMN IF NOT EXISTS delivered_sets_per_lift NUMERIC(5, 2),

  -- Whether this generation continued an existing block or started a new one.
  -- A block that is restarted every week and a block that is lived through
  -- produce very different adherence, and telling them apart is the whole
  -- point of the continuity work this release shipped.
  ADD COLUMN IF NOT EXISTS continued_block BOOLEAN,
  ADD COLUMN IF NOT EXISTS plan_week SMALLINT;

-- The query this exists to serve: ambition against adherence, bucketed.
-- Indexed on the label rather than the z-score because the grouping is by
-- label and the z-score is the detail inside each group.
CREATE INDEX IF NOT EXISTS idx_hpe_events_goal_level
  ON hpe_generation_events (endurance_goal_level, strength_goal_level)
  WHERE outcome = 'generated';

COMMENT ON COLUMN hpe_generation_events.endurance_goal_z IS
  'Standard deviations between the stated 5k target and the expected outcome. The ambition half of the ambition-versus-abandonment question the evidence review flagged as unmeasured.';
COMMENT ON COLUMN hpe_generation_events.delivered_endurance_min IS
  'Weekly running minutes the generated plan actually prescribes. A missed projection is read against this before it is read against the athlete.';
