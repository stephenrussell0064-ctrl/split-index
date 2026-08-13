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

import { DAYS, type TrainingAge } from "./constants";
import {
  DEFAULT_SAFETY_FLAGS,
  estimatedMaxHr,
  reconcileCurrentVolume,
  scoreLeaScreen,
  type AthleteState,
  type Constraints,
  type Goal,
  deriveTargetTotal,
  resolveHorizon,
  type DayWindow,
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
  /** Chosen block length in weeks when there is no event date. Null = let the engine suggest one. */
  planTimeframeWeeks: number | null;
  events: string[];
  sameDay: boolean;
  interEventGapH: number;
  eventOrderKnown: boolean;
  target5kS: number | null;
  /** Per-lift targets, each independently skippable. */
  targetSquatKg: number | null;
  targetBenchKg: number | null;
  targetDeadliftKg: number | null;
  /** Legacy combined target, kept so older rows still resolve. */
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
  /**
   * Whether the athlete can get to a gym at all. This is the question that
   * matters — "do you have a barbell" is a detail inside the real answer, and
   * asking it first got the order backwards. Someone training at home with
   * dumbbells needs a different plan, not a barbell plan they cannot perform.
   */
  hasGymAccess: boolean;
  twoADaysPossible: boolean;
  /** Per-day training windows — real clock times, which differ by day. */
  dayWindows: DayWindow[];
  /** True when the week genuinely varies and fixed day placement would be fiction. */
  availabilityVaries: boolean;
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

/** Reads stored per-day windows, dropping anything malformed rather than throwing inside a request. */
function parseDayWindows(value: unknown): DayWindow[] {
  if (!Array.isArray(value)) return [];
  const out: DayWindow[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    const day = String(e.day ?? "");
    if (!DAYS.includes(day as (typeof DAYS)[number])) continue;
    const startHour = Number(e.start_hour ?? e.startHour);
    const endHour = Number(e.end_hour ?? e.endHour);
    if (!Number.isFinite(startHour) || !Number.isFinite(endHour)) continue;
    out.push({
      day,
      available: e.available !== false,
      startHour: Math.min(23, Math.max(0, startHour)),
      endHour: Math.min(23, Math.max(0, endHour)),
      twoSessions: Boolean(e.two_sessions ?? e.twoSessions),
    });
  }
  return out;
}

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
    planTimeframeWeeks: n("plan_timeframe_weeks"),
    events: arr("events"),
    sameDay: Boolean(row?.same_day),
    interEventGapH: n("inter_event_gap_h") ?? 4,
    eventOrderKnown: Boolean(row?.event_order_known),
    target5kS: n("target_5k_s"),
    targetSquatKg: n("target_squat_kg"),
    targetBenchKg: n("target_bench_kg"),
    targetDeadliftKg: n("target_deadlift_kg"),
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
    hasGymAccess: row?.has_gym_access == null ? true : Boolean(row.has_gym_access),
    twoADaysPossible: Boolean(row?.two_a_days_possible),
    dayWindows: parseDayWindows(row?.day_windows),
    availabilityVaries: Boolean(row?.availability_varies),
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

  // An event date is no longer required. Horizon resolves from a date, then a
  // chosen timeframe, then the engine's own default — and records which, so
  // the plan can say "your 12-week block" rather than implying a race the
  // athlete never entered.
  const horizon = resolveHorizon(record.eventDate, record.planTimeframeWeeks, now);
  if (horizon.note) assumed.push(horizon.note);

  const daysAvailable = record.daysAvailable.length > 0 ? record.daysAvailable : [];
  const gymAccessDays = record.gymAccessDays.length > 0 ? record.gymAccessDays : daysAvailable;
  if (record.gymAccessDays.length === 0 && daysAvailable.length > 0) {
    assumed.push("Gym access is assumed on every day you train, since you have not narrowed it.");
  }

  // Per-day windows. Any day the athlete gave a window for uses it; the rest
  // fall back to the flat AM/PM hours. Real clock times differ by day, and the
  // six-hour separation rule between hard sessions is computed from them.
  const dayWindows: DayWindow[] = DAYS.map((day) => {
    const stated = record.dayWindows.find((w) => w.day === day);
    if (stated) return stated;
    return {
      day,
      available: daysAvailable.includes(day),
      startHour: record.amHour,
      endHour: record.pmHour,
      twoSessions: record.twoADaysPossible,
    };
  });

  if (!record.hasGymAccess) {
    assumed.push(
      "You said you cannot get to a gym, so no barbell work is prescribed. The strength side of this plan is " +
        "currently written around barbell lifts, so what you get instead is thinner than it should be — full " +
        "home and dumbbell programming is not built yet, and pretending otherwise would prescribe you sessions " +
        "you cannot perform."
    );
  }

  if (record.availabilityVaries) {
    assumed.push(
      "You said your week varies, so the plan gives you an ordered list of sessions rather than fixing them to " +
        "days. The order is what matters — the spacing rules are applied as you place them, and the hardest " +
        "sessions are the ones to protect."
    );
  } else if (record.dayWindows.length === 0 && record.sectionsCompleted.includes("availability")) {
    assumed.push(
      "You have not given per-day training times, so the same morning and evening hours are assumed every day. " +
        "The six-hour rule between hard sessions is computed from those times, so per-day hours are worth setting " +
        "if yours differ."
    );
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
    weeksOut: horizon.weeksOut,
    horizonSource: horizon.horizonSource,
    target5kS: record.target5kS,
    targetSquatKg: record.targetSquatKg,
    targetBenchKg: record.targetBenchKg,
    targetDeadliftKg: record.targetDeadliftKg,
    // Derived from whichever lifts they gave. A partial answer is still an
    // answer; no answer is not a total of zero.
    targetTotalKg:
      deriveTargetTotal(record.targetSquatKg, record.targetBenchKg, record.targetDeadliftKg) ?? record.targetTotalKg,
    priority: record.priority,
    sameDay: record.sameDay,
    interEventGapH: record.interEventGapH,
    weightClassKg: record.weightClassKg,
    eventOrderKnown: record.eventOrderKnown,
  };

  const constraints: Constraints = {
    daysAvailable,
    twoADaysPossible: record.twoADaysPossible,
    dayWindows,
    availabilityVaries: record.availabilityVaries,
    amHour: record.amHour,
    pmHour: record.pmHour,
    maxSessionsPerWeek: record.maxSessionsPerWeek,
    maxHoursPerWeek: record.maxHoursPerWeek,
    maxSessionMin: record.maxSessionMin,
    minRestDays: record.minRestDays,
    gymAccessDays,
    // Gym access governs; the equipment list refines it. Without a gym the
    // barbell is not available whatever the equipment list says.
    equipment: record.hasGymAccess
      ? record.equipmentUsed.length > 0
        ? record.equipmentUsed
        : ["barbell"]
      : record.equipmentUsed.filter((e) => e !== "barbell"),
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
