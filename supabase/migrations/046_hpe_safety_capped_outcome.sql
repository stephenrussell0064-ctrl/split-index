-- The health screen caps plans; it no longer refuses them.
--
-- `safety_blocked` is now unreachable: every input that used to refuse a plan
-- sets an intensity ceiling and a ramp multiplier instead. See the note on
-- `safetyScreen` for why — a refusal does not stop someone training, it only
-- strips the caps and the referral off the training they were going to do.
--
-- The fleet operations view was reading block rate by reason, which is the
-- number a rollout decision is partly made from. Losing it outright would
-- leave that view blind to the screen entirely, so the signal is replaced
-- rather than deleted: `safety_capped` records that the screen constrained a
-- plan, and `reason_code` still carries which answer did it. Rate-by-reason
-- keeps working; it now measures how often the engine holds someone back
-- rather than how often it turns them away.
--
-- The old value is kept in the constraint on purpose. Historical rows carry
-- it, and dropping it from the CHECK would either fail against existing data
-- or silently require rewriting history — neither of which is worth doing to
-- retire a label.

ALTER TABLE hpe_generation_events DROP CONSTRAINT IF EXISTS hpe_generation_events_outcome_check;

ALTER TABLE hpe_generation_events ADD CONSTRAINT hpe_generation_events_outcome_check CHECK (
  outcome IN (
    'generated',
    -- Retired. Retained so historical rows stay valid.
    'safety_blocked',
    'safety_capped',
    'insufficient_data',
    'missing_intake',
    'feature_disabled',
    'error'
  )
);
