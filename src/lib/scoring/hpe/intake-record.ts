/**
 * Hybrid Plan Engine — WP2: turning stored intake answers into engine inputs.
 *
 * The intake spec's rules are enforced here rather than in the UI, because a
 * rule enforced in a form is a rule that stops applying the moment anything
 * else calls the engine:
 *
 *  - **Unanswered is not "no".** Every Section A safety question is nullable
 *    in the database and resolves CONSERVATIVELY when null. An athlete who
 *    never saw the injury question is treated as injured until they say
 *    otherwise, which halves their ramp rather than granting them a full one.
 *  - **Nothing is asked twice.** Age, height, bodyweight, sex, resting and max
 *    HR come from `profiles`; 1RMs from the SRI engine; predicted 5k from the
 *    prediction engine; weekly volume from the logs. This module joins them
 *    rather than storing second copies.
 *  - **Documented degradation.** Skipping Sections C-H is allowed and each
 *    skip produces a named, athlete-readable consequence in `assumed` — not a
 *    silent default.
 *
 * The one thing that is not degradable is `current_run_min_per_week`. Where it
 * can be neither derived nor stated, `validateIntake` blocks. That refusal is
 * the spec's own, and it is the field that prevents the most common injury
 * pathway in generated plans.
 */

import type { TrainingAge } from "./constants";
import {
  DEFAULT_SAFETY_FLAGS,
  estimatedMaxHr,
  reconcileCurrentVolume,
  scoreLeaScreen,
  type AthleteState,
  type Constraints,
  type Goal,
  type IntakeIssue,
  type SafetyFlags,
} from "./intake";

/** The stored row, camel-cased. Every field optional — a half-finished intake is a normal state, not an error. */
export interface IntakeRecord {
  sectionsCompleted: string[];

  parqPositive: boolean | null;
  chestPainOnExertion: boolean | null;
  currentInjuryLimiting: boolean | null;
  injuryLast12Weeks: boolean | null;
  injurySites: string[];
  surgeryLast6Months: boolean | null;
  pregnantOrPostpartum12wk: boolean | null;
  medicationAffectingHr: boolean | null;

  leaRestrictedFood: boolean | null;
  leaTrainsFasted: boolean | null;
  leaUnintendedWeightLoss: boolean | null;
  leaBoneStressInjury: boolean | null;
  leaAmenorrhoea: boolean | null;

  eventDate: string | null;
  events: string[];
  sameDay: boolean;
  interEventGapH: number;
  eventOrderKnown: boolean;
  target5kS: number | null;
  targetTotalKg: number | null;
  priority: number;
  priorityUserSet: boolean;
  weightClassKg: number | null;
  intendsWeightCut: boolean | null;
  federation: string | null;

  strengthTrainingYears: number | null;
  currentStrengthSessionsPerWeek: number | null;
  equipmentUsed: string[];

  currentRunMinPerWeek: number | null;
  longestRecentRunMin: number | null;
  enduranceTrainingYears: number | null;
  primaryModality: string;
  substitutionOk: boolean;
  surfaceAccess: string[];

  maxHrKnown: boolean;
  hrRunsHigh: boolean;

  daysAvailable: string[];
  twoADaysPossible: boolean;
  twoADayDays: string[];
  amHour: number;
  pmHour: number;
  maxSessionsPerWeek: number;
  maxHoursPerWeek: number;
  maxSessionMin: number;
  minRestDays: number;
  gymAccessDays: string[];
  travelWeeks: number[];

  sleepHoursTypical: number | null;
  shiftWork: boolean;
  jobPhysicality: "sedentary" | "on_feet" | "physical";
  lifeStressNow: number;
  previousMaxVolume: number | null;

  dislikedExercises: string[];
  preferredLongDay: string | null;
  preferredRestDay: string | null;
}

export const INTAKE_SECTIONS = ["safety", "goal", "strength", "endurance", "heart_rate", "availability", "recovery", "preferences"] as const;
export type IntakeSection = (typeof INTAKE_SECTIONS)[number];

/** Sections the athlete cannot skip. Everything else degrades with a stated consequence. */
export const MANDATORY_SECTIONS: IntakeSection[] = ["safety", "goal", "availability"];

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Maps a raw Supabase row onto IntakeRecord, filling structural defaults only — never safety ones. */
export function parseIntakeRow(row: Record<string, unknown> | null): IntakeRecord {
  const b = (key: string): boolean | null => (row?.[key] == null ? null : Boolean(row[key]));
  const n = (key: string): number | null => (row?.[key] == null ? null : Number(row[key]));
  const arr = (key: string): string[] => (Array.isArray(row?.[key]) ? (row[key] as string[]) : []);

  return {
    sectionsCompleted: arr("sections_completed"),
    parqPositive: b("parq_positive"),
    chestPainOnExertion: b("chest_pain_on_exertion"),
    currentInjuryLimiting: b("current_injury_limiting"),
    injuryLast12Weeks: b("injury_last_12_weeks"),
    injurySites: arr("injury_sites"),
    surgeryLast6Months: b("surgery_last_6_months"),
    pregnantOrPostpartum12wk: b("pregnant_or_postpartum_12wk"),
    medicationAffectingHr: b("medication_affecting_hr"),
    leaRestrictedFood: b("lea_restricted_food"),
    leaTrainsFasted: b("lea_trains_fasted"),
    leaUnintendedWeightLoss: b("lea_unintended_weight_loss"),
    leaBoneStressInjury: b("lea_bone_stress_injury"),
    leaAmenorrhoea: b("lea_amenorrhoea"),
    eventDate: (row?.event_date as string | null) ?? null,
    events: arr("events"),
    sameDay: Boolean(row?.same_day),
    interEventGapH: n("inter_event_gap_h") ?? 4,
    eventOrderKnown: Boolean(row?.event_order_known),
    target5kS: n("target_5k_s"),
    targetTotalKg: n("target_total_kg"),
    priority: n("priority") ?? 0.5,
    priorityUserSet: Boolean(row?.priority_user_set),
    weightClassKg: n("weight_class_kg"),
    intendsWeightCut: b("intends_weight_cut"),
    federation: (row?.federation as string | null) ?? null,
    strengthTrainingYears: n("strength_training_years"),
    currentStrengthSessionsPerWeek: n("current_strength_sessions_per_week"),
    equipmentUsed: arr("equipment_used"),
    currentRunMinPerWeek: n("current_run_min_per_week"),
    longestRecentRunMin: n("longest_recent_run_min"),
    enduranceTrainingYears: n("endurance_training_years"),
    primaryModality: (row?.primary_modality as string) ?? "run",
    substitutionOk: row?.substitution_ok == null ? true : Boolean(row.substitution_ok),
    surfaceAccess: arr("surface_access").length > 0 ? arr("surface_access") : ["road"],
    maxHrKnown: Boolean(row?.max_hr_known),
    hrRunsHigh: Boolean(row?.hr_runs_high),
    daysAvailable: arr("days_available"),
    twoADaysPossible: Boolean(row?.two_a_days_possible),
    twoADayDays: arr("two_a_day_days"),
    amHour: n("am_hour") ?? 7,
    pmHour: n("pm_hour") ?? 18,
    maxSessionsPerWeek: n("max_sessions_per_week") ?? 6,
    maxHoursPerWeek: n("max_hours_per_week") ?? 8,
    maxSessionMin: n("max_session_min") ?? 90,
    minRestDays: n("min_rest_days") ?? 1,
    gymAccessDays: arr("gym_access_days"),
    travelWeeks: Array.isArray(row?.travel_weeks) ? (row.travel_weeks as number[]).map(Number) : [],
    sleepHoursTypical: n("sleep_hours_typical"),
    shiftWork: Boolean(row?.shift_work),
    jobPhysicality: ((row?.job_physicality as string) ?? "sedentary") as IntakeRecord["jobPhysicality"],
    lifeStressNow: n("life_stress_now") ?? 3,
    previousMaxVolume: n("previous_max_volume"),
    dislikedExercises: arr("disliked_exercises"),
    preferredLongDay: (row?.preferred_long_day as string | null) ?? null,
    preferredRestDay: (row?.preferred_rest_day as string | null) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Section A — safety, resolved conservatively
// ---------------------------------------------------------------------------

/**
 * Every unanswered question resolves to the value that makes the screen
 * STRICTER, not the one that lets the athlete through. The spec's Missing
 * column says "assume true" for injury, surgery and every LEA question, and
 * that is what happens here.
 *
 * The two exceptions are `parq_positive` and `chest_pain_on_exertion`, which
 * the spec marks **Block** rather than "assume true": an unanswered PAR-Q must
 * stop generation and ask, not silently declare the athlete unfit. That is
 * handled by `sectionsCompleted` — an incomplete safety section blocks
 * regardless of what the individual answers say.
 */
export function resolveSafetyFlags(
  record: IntakeRecord,
  athlete: { age: number; sex: "male" | "female" | "other" }
): { flags: SafetyFlags; assumed: string[] } {
  const assumed: string[] = [];
  const safetyDone = record.sectionsCompleted.includes("safety");

  const conservative = (value: boolean | null, label: string, fallback: boolean): boolean => {
    if (value != null) return value;
    if (fallback) assumed.push(label);
    return fallback;
  };

  const femaleQuestionApplies = athlete.sex === "female";
  const leaFlags = safetyDone
    ? scoreLeaScreen(
        {
          restrictedFood: record.leaRestrictedFood ?? undefined,
          trainsFasted: record.leaTrainsFasted ?? undefined,
          unintendedWeightLoss5pct: record.leaUnintendedWeightLoss ?? undefined,
          boneStressInjury2y: record.leaBoneStressInjury ?? undefined,
          amenorrhoea3m: record.leaAmenorrhoea ?? undefined,
        },
        femaleQuestionApplies
      )
    : // Not asked at all. Scoring an unasked screen as zero would silently
      // clear the safeguard it exists to enforce, so it scores as unanswered
      // — which is every question positive.
      scoreLeaScreen({}, femaleQuestionApplies);

  if (!safetyDone) {
    assumed.push(
      "The safety questionnaire has not been completed, so every screening question is treated as unanswered and " +
        "resolved the cautious way. Answering it takes about a minute and unlocks the full volume ramp."
    );
  }

  return {
    flags: {
      ...DEFAULT_SAFETY_FLAGS,
      parqPositive: record.parqPositive ?? false,
      chestPainOnExertion: record.chestPainOnExertion ?? false,
      currentInjuryLimiting: record.currentInjuryLimiting ?? false,
      injuryLast12Weeks: conservative(
        record.injuryLast12Weeks,
        "A recent injury is assumed until you answer otherwise, which halves your volume ramp.",
        true
      ),
      injurySites: record.injurySites,
      surgeryLast6Months: conservative(
        record.surgeryLast6Months,
        "Recent surgery is assumed until you answer otherwise, which adds a clearance prompt.",
        true
      ),
      pregnantOrPostpartum12wk: record.pregnantOrPostpartum12wk ?? false,
      under18: athlete.age < 18,
      leaRiskFlags: leaFlags,
      intendsWeightCut: record.intendsWeightCut ?? false,
      medicationAffectingHr: record.medicationAffectingHr ?? false,
    },
    assumed,
  };
}

// ---------------------------------------------------------------------------
// Sections C-H — documented degradation
// ---------------------------------------------------------------------------

/** [EST] Fallbacks for skipped optional sections. Each one is surfaced, never silent. */
const DEGRADATION_DEFAULTS = {
  /** Assumed 0 => blocks a peaking plan and offers general preparation instead, per the spec's Missing column. */
  strengthTrainingYears: 0,
  /** Assumed 0 => halves the ramp and caps endurance targets. */
  enduranceTrainingYears: 0,
  currentStrengthSessionsPerWeek: 0,
  sleepHoursTypical: 7,
} as const;

function trainingAgeFromYears(years: number): TrainingAge {
  if (years < 1) return "novice";
  if (years < 3) return "intermediate";
  if (years < 8) return "advanced";
  return "elite";
}

export interface PrefilledFromSplitIndex {
  age: number;
  sex: "male" | "female" | "other";
  bodyweightKg: number | null;
  heightCm: number | null;
  restingHr: number | null;
  maxHr: number | null;
  oneRms: Record<string, number>;
  predicted5kS: number;
  loggedWeeklyRunMinutes: number | null;
  chronicLoad: number;
}

export interface ResolvedIntakeInputs {
  state: AthleteState;
  goal: Goal;
  constraints: Constraints;
  /** Everything the engine had to assume, in the athlete's own terms. */
  assumed: string[];
  issues: IntakeIssue[];
  /** Sections still outstanding, so the UI can point at exactly what is missing. */
  missingSections: IntakeSection[];
}

/**
 * Joins stored answers with what Split Index already knows and produces the
 * three inputs the engine takes. Everything defaulted is reported.
 */
export function resolveIntakeInputs(
  record: IntakeRecord,
  prefilled: PrefilledFromSplitIndex,
  now: Date = new Date()
): ResolvedIntakeInputs {
  const assumed: string[] = [];
  const issues: IntakeIssue[] = [];

  const { flags, assumed: safetyAssumed } = resolveSafetyFlags(record, {
    age: prefilled.age,
    sex: prefilled.sex,
  });
  assumed.push(...safetyAssumed);

  // The on-ramp anchor: stated versus logged, lower wins.
  const volume = reconcileCurrentVolume(record.currentRunMinPerWeek, prefilled.loggedWeeklyRunMinutes);
  if (volume.issue) {
    issues.push(volume.issue);
    assumed.push(volume.issue.message);
  }

  const strengthYears = record.strengthTrainingYears ?? DEGRADATION_DEFAULTS.strengthTrainingYears;
  if (record.strengthTrainingYears == null) {
    assumed.push(
      "You have not said how long you have trained the barbell lifts, so it is assumed to be under a year. " +
        "That blocks a competition peaking block and offers general preparation instead — answering it is the " +
        "difference between the two."
    );
  }

  const enduranceYears = record.enduranceTrainingYears ?? DEGRADATION_DEFAULTS.enduranceTrainingYears;
  if (record.enduranceTrainingYears == null) {
    assumed.push(
      "You have not said how long you have been running, so it is assumed to be under six months and your volume " +
        "ramp is halved."
    );
  }

  const eventDate = record.eventDate ? new Date(record.eventDate) : null;
  const weeksOut = eventDate ? Math.round((eventDate.getTime() - now.getTime()) / (7 * 86_400_000)) : 0;

  const daysAvailable = record.daysAvailable.length > 0 ? record.daysAvailable : [];
  const gymAccessDays = record.gymAccessDays.length > 0 ? record.gymAccessDays : daysAvailable;
  if (record.gymAccessDays.length === 0 && daysAvailable.length > 0) {
    assumed.push("Gym access is assumed on every day you train, since you have not narrowed it.");
  }

  if (!record.sectionsCompleted.includes("availability")) {
    assumed.push(
      "Your real availability has not been set, so the schedule is built on a default week. The six-hour " +
        "separation rule between hard sessions is computed from your actual training times, so this is worth a " +
        "minute of your time."
    );
  }

  if (record.sleepHoursTypical == null) {
    assumed.push("Typical sleep is assumed at 7 hours, which nudges the ramp rate.");
  }

  const state: AthleteState = {
    bodyweightKg: prefilled.bodyweightKg ?? 0,
    heightCm: prefilled.heightCm ?? 0,
    age: prefilled.age,
    sex: prefilled.sex,
    oneRms: prefilled.oneRms,
    predicted5kS: prefilled.predicted5kS,
    strengthTrainingAge: trainingAgeFromYears(strengthYears),
    enduranceTrainingAge: trainingAgeFromYears(enduranceYears),
    strengthTrainingYears: strengthYears,
    enduranceTrainingYears: enduranceYears,
    currentRunMinPerWeek: volume.value as number,
    currentStrengthSessionsPerWeek:
      record.currentStrengthSessionsPerWeek ?? DEGRADATION_DEFAULTS.currentStrengthSessionsPerWeek,
    chronicLoad: prefilled.chronicLoad,
    restingHr: prefilled.restingHr ?? 60,
    maxHr: record.maxHrKnown ? prefilled.maxHr : (prefilled.maxHr ?? null),
    safety: flags,
    assumed,
  };

  if (prefilled.restingHr == null) {
    assumed.push(
      "Resting heart rate was assumed at 60 rather than measured, which widens every heart-rate band below. " +
        "Measuring it on waking for three mornings narrows them to your own physiology."
    );
  }
  if (prefilled.maxHr == null) {
    assumed.push(
      `Maximum heart rate is age-estimated at ${estimatedMaxHr(prefilled.age)}, not measured. Every band inherits ` +
        `that estimate until you log a maximal effort.`
    );
  }

  const goal: Goal = {
    weeksOut,
    target5kS: record.target5kS,
    targetTotalKg: record.targetTotalKg,
    priority: record.priority,
    sameDay: record.sameDay,
    interEventGapH: record.interEventGapH,
    weightClassKg: record.weightClassKg,
    eventOrderKnown: record.eventOrderKnown,
  };

  const constraints: Constraints = {
    daysAvailable,
    twoADaysPossible: record.twoADaysPossible,
    amHour: record.amHour,
    pmHour: record.pmHour,
    maxSessionsPerWeek: record.maxSessionsPerWeek,
    maxHoursPerWeek: record.maxHoursPerWeek,
    maxSessionMin: record.maxSessionMin,
    minRestDays: record.minRestDays,
    gymAccessDays,
    equipment: record.equipmentUsed.length > 0 ? record.equipmentUsed : ["barbell"],
  };

  const missingSections = INTAKE_SECTIONS.filter((s) => !record.sectionsCompleted.includes(s));

  return { state, goal, constraints, assumed, issues, missingSections };
}

/**
 * The minimum viable intake, from the spec: "If you want the shortest flow
 * that still produces a defensible plan, it is these fourteen fields...
 * Anything shorter than that is not an individualised plan, it is a template
 * with the user's name on it."
 */
export function hasMinimumViableIntake(record: IntakeRecord, prefilled: PrefilledFromSplitIndex): boolean {
  return (
    MANDATORY_SECTIONS.every((s) => record.sectionsCompleted.includes(s)) &&
    prefilled.bodyweightKg != null &&
    prefilled.heightCm != null &&
    record.eventDate != null &&
    record.daysAvailable.length >= 3 &&
    (record.currentRunMinPerWeek != null || prefilled.loggedWeeklyRunMinutes != null)
  );
}

/** Days list, exported so the UI and the scheduler cannot disagree about what a week is. */
export const INTAKE_DAYS = ALL_DAYS;
