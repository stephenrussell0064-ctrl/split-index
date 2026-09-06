import { bounded, text, z } from "@/lib/validation/boundary";
import { BOUND_DURATION_S, BOUND_LIFT_LOAD_KG } from "@/lib/security/config";
import { SECTION_FIELDS, type IntakeSection } from "@/lib/scoring/hpe/intake-record";

/**
 * Per-field types for the Hybrid Plan intake.
 *
 * The route already allowlists field NAMES per section, which stops a PATCH
 * claiming to be the preferences screen from rewriting the safety answers. It
 * did nothing about VALUES: `values` arrived as Record<string, unknown> and
 * whatever was in it went into the table. A string where a boolean belongs, a
 * 1e9 where a target lift belongs, an array of objects where a list of injury
 * sites belongs — all stored, and all read back later by the safety screen and
 * the plan generator.
 *
 * That matters most for the health screen, because those answers decide
 * whether the engine will programme for somebody at all. `parq_positive: "no"`
 * is a truthy string: a coercing reader treats it as YES and refers a healthy
 * athlete to a doctor, and a different reader treats the same value as a
 * failed parse and silently drops a real YES. Neither is acceptable for a
 * question about chest pain.
 *
 * COVERAGE, STATED HONESTLY
 * -------------------------
 * Every Tier 2 field is typed here — that is the complete health and fuelling
 * set, and TIER_2_FULLY_TYPED below is asserted in intake-schema.test.ts so it
 * stays complete as fields are added. The Tier 1 sections are partially typed:
 * the numeric targets and the fields that reach the engine are covered, and
 * the remaining preference fields are not yet.
 *
 * Untyped fields pass through as they did before rather than being rejected,
 * because rejecting them would break the screens that write them. That is a
 * known gap, deliberately left rather than papered over, and it is recorded as
 * an open finding in AUDIT-split-index.md.
 */

const bool = z.boolean({ message: "Answer yes or no." });

/** A list of short tags — injury sites, event names, day labels. */
const tagList = z
  .array(text(40, "Value"))
  .max(30, "That is more than we can store for this answer.");

/**
 * The health and fuelling screens, in full.
 *
 * Every one is a plain boolean except injury_sites. There is deliberately no
 * coercion: "no", 0 and "" are rejected rather than interpreted, because a
 * misread answer here changes what the engine is willing to prescribe.
 */
const TIER2_SCHEMAS = {
  parq_positive: bool,
  chest_pain_on_exertion: bool,
  current_injury_limiting: bool,
  injury_last_12_weeks: bool,
  injury_sites: tagList,
  surgery_last_6_months: bool,
  pregnant_or_postpartum_12wk: bool,
  medication_affecting_hr: bool,

  lea_restricted_food: bool,
  lea_trains_fasted: bool,
  lea_unintended_weight_loss: bool,
  lea_bone_stress_injury: bool,
  lea_amenorrhoea: bool,
} as const;

/** Tier 1 fields that reach the engine as numbers, plus the obvious lists and flags. */
const TIER1_SCHEMAS = {
  target_squat_kg: bounded(BOUND_LIFT_LOAD_KG, "target squat").nullish(),
  target_bench_kg: bounded(BOUND_LIFT_LOAD_KG, "target bench").nullish(),
  target_deadlift_kg: bounded(BOUND_LIFT_LOAD_KG, "target deadlift").nullish(),
  target_total_kg: bounded([0, 1_500], "target total").nullish(),
  target_5k_s: bounded(BOUND_DURATION_S, "target 5k time").int().nullish(),
  plan_timeframe_weeks: bounded([1, 104], "plan length").int().nullish(),
  weight_class_kg: bounded([25, 300], "weight class").nullish(),
  inter_event_gap_h: bounded([0, 168], "gap between events").nullish(),

  max_hr_override: bounded([100, 230], "max heart rate").int().nullish(),
  resting_hr_override: bounded([25, 120], "resting heart rate").int().nullish(),
  squat_1rm_override: bounded(BOUND_LIFT_LOAD_KG, "squat 1RM").nullish(),

  current_run_min_per_week: bounded([0, 3_000], "weekly running minutes").nullish(),
  longest_recent_run_min: bounded([0, 1_440], "longest run").nullish(),
  previous_max_volume: bounded([0, 12_000], "previous monthly volume").nullish(),
  endurance_training_years: bounded([0, 80], "years of endurance training").nullish(),
  strength_training_years: bounded([0, 80], "years of strength training").nullish(),
  current_strength_sessions_per_week: bounded([0, 21], "strength sessions").nullish(),

  max_sessions_per_week: bounded([0, 21], "sessions per week").int().nullish(),
  max_hours_per_week: bounded([0, 60], "hours per week").nullish(),
  max_session_min: bounded([0, 600], "session length").int().nullish(),
  min_rest_days: bounded([0, 7], "rest days").int().nullish(),
  travel_weeks: bounded([0, 52], "travel weeks").int().nullish(),

  same_day: bool.nullish(),
  event_order_known: bool.nullish(),
  intends_weight_cut: bool.nullish(),
  priority_user_set: bool.nullish(),
  two_a_days_possible: bool.nullish(),
  shift_work: bool.nullish(),
  substitution_ok: bool.nullish(),
  cross_train_ok: bool.nullish(),
  trains_outside_app: bool.nullish(),
  max_hr_known: bool.nullish(),
  hr_runs_high: bool.nullish(),
  availability_varies: bool.nullish(),

  events: tagList.nullish(),
  days_available: tagList.nullish(),
  two_a_day_days: tagList.nullish(),
  gym_access_days: tagList.nullish(),
  disliked_exercises: tagList.nullish(),
  equipment_used: tagList.nullish(),
  surface_access: tagList.nullish(),
  cardio_modalities: tagList.nullish(),

  notes: text(2_000, "Notes").nullish(),
} as const;

export const INTAKE_FIELD_SCHEMAS: Record<string, z.ZodType> = {
  ...TIER2_SCHEMAS,
  ...TIER1_SCHEMAS,
};

/** Asserted in the tests: every health and fuelling field has a type here. */
export const TIER_2_FULLY_TYPED: readonly IntakeSection[] = ["health", "fuelling"];

export interface IntakeValueError {
  path: string;
  message: string;
}

/**
 * Validate one section's values.
 *
 * Returns the values to write and the fields that failed. A field with no
 * schema passes through untouched — see the coverage note above. A field that
 * HAS a schema and fails it is an error, never a silent drop: dropping it
 * would tell the athlete their answer saved when it did not, which on the
 * health screen is the worst of the available outcomes.
 */
export function validateIntakeValues(
  section: IntakeSection,
  values: Record<string, unknown>
): { values: Record<string, unknown>; errors: IntakeValueError[] } {
  const allowed = new Set(SECTION_FIELDS[section]);
  const out: Record<string, unknown> = {};
  const errors: IntakeValueError[] = [];

  for (const [key, value] of Object.entries(values)) {
    if (!allowed.has(key)) continue;

    const schema = INTAKE_FIELD_SCHEMAS[key];
    if (!schema) {
      out[key] = value;
      continue;
    }

    const parsed = schema.safeParse(value);
    if (parsed.success) {
      out[key] = parsed.data;
    } else {
      errors.push({
        path: key,
        message: parsed.error.issues[0]?.message ?? "That value is not valid.",
      });
    }
  }

  return { values: out, errors };
}
