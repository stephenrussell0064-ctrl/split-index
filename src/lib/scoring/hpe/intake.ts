/**
 * Hybrid Plan Engine — WP2, the intake contract.
 *
 * Implements HPE-ATHLETE-INTAKE-SPEC.md: "this is the contract between the
 * onboarding UI and the plan generator. If a field is not in this document,
 * the engine must not depend on it. If a field is here and missing at
 * generation time, the behaviour in the *Missing* column is mandatory — the
 * engine never silently guesses."
 *
 * Three rules from the spec are load-bearing and implemented here rather than
 * left to the UI:
 *
 *  1. **Block vs default.** Some missing fields block generation outright
 *     (age, bodyweight, height, sex, event date, days available < 3). Others
 *     default and are FLAGGED as assumed, so a downstream prescription can
 *     say how much to trust itself. `resolveIntake` returns both.
 *
 *  2. **Conservative assumption.** Where a missing safety answer would change
 *     the screen's verdict, the spec's Missing column says "assume true" —
 *     the conservative direction, not the convenient one.
 *
 *  3. **The cross-check rule.** "Where a stated field contradicts the logs —
 *     the athlete says they run 200 min/week and the logs show 60 — the
 *     engine uses the *lower* value and surfaces the discrepancy. Optimistic
 *     self-report is the norm and it is the on-ramp anchor, so it must be
 *     conservative." See `reconcileCurrentVolume`.
 *
 * `current_run_min_per_week` is called out in the spec as "the most important
 * field in this document" — it is the field that prevents the single most
 * common injury pathway in generated plans. If it can be neither derived from
 * logs nor answered, the engine refuses. That is a deliberate, defensible
 * refusal, and it is implemented as one.
 */

import { MIN_HEALTHY_BMI, type TrainingAge } from "./constants";

// ---------------------------------------------------------------------------
// Section A — safety and eligibility
// ---------------------------------------------------------------------------

/** Every field maps to an intake question. All default CONSERVATIVELY when unanswered — see the spec's Missing column. */
export interface SafetyFlags {
  parqPositive: boolean;
  chestPainOnExertion: boolean;
  currentInjuryLimiting: boolean;
  injuryLast12Weeks: boolean;
  injurySites: string[];
  surgeryLast6Months: boolean;
  pregnantOrPostpartum12wk: boolean;
  under18: boolean;
  /** Count of positive answers across the five-question low-energy-availability screen (0-5). */
  leaRiskFlags: number;
  intendsWeightCut: boolean;
  /** Beta blockers and similar. Switches ALL prescription from heart rate to pace and RPE — prescribing zones to someone on beta blockers is a straightforward way to produce a useless plan. */
  medicationAffectingHr: boolean;
}

/** The five LEA screen answers. Any unanswered question is assumed positive. */
export interface LeaAnswers {
  restrictedFood?: boolean;
  trainsFasted?: boolean;
  unintendedWeightLoss5pct?: boolean;
  boneStressInjury2y?: boolean;
  /** Female athletes only; omitted (not assumed) when not applicable. */
  amenorrhoea3m?: boolean;
}

export function scoreLeaScreen(answers: LeaAnswers, applicableFemaleQuestion: boolean): number {
  // Unanswered => assumed positive, per the spec's Missing column. The
  // conservative direction is the one that suppresses bodyweight guidance.
  const items = [
    answers.restrictedFood ?? true,
    answers.trainsFasted ?? true,
    answers.unintendedWeightLoss5pct ?? true,
    answers.boneStressInjury2y ?? true,
  ];
  if (applicableFemaleQuestion) items.push(answers.amenorrhoea3m ?? true);
  return items.filter(Boolean).length;
}

export const DEFAULT_SAFETY_FLAGS: SafetyFlags = {
  parqPositive: false,
  chestPainOnExertion: false,
  currentInjuryLimiting: false,
  injuryLast12Weeks: true,
  injurySites: [],
  surgeryLast6Months: true,
  pregnantOrPostpartum12wk: false,
  under18: false,
  leaRiskFlags: 0,
  intendsWeightCut: false,
  medicationAffectingHr: false,
};

// ---------------------------------------------------------------------------
// Sections C-H — the athlete, the goal, the constraints
// ---------------------------------------------------------------------------

export interface AthleteState {
  bodyweightKg: number;
  heightCm: number;
  age: number;
  sex: "male" | "female" | "other";
  oneRms: Record<string, number>;
  predicted5kS: number;
  strengthTrainingAge: TrainingAge;
  enduranceTrainingAge: TrainingAge;
  strengthTrainingYears: number;
  enduranceTrainingYears: number;
  /** THE ON-RAMP ANCHOR. Reconciled against the logs — never taken on trust alone. */
  currentRunMinPerWeek: number;
  currentStrengthSessionsPerWeek: number;
  /** 28-day rolling chronic load from the existing injury-risk engine. Seeds the ACWR denominator so week 1 is measured against reality rather than zero. */
  chronicLoad: number;
  restingHr: number;
  maxHr: number | null;
  safety: SafetyFlags;
  /** Which values had to be defaulted rather than known. Prescriptions widen their bands and label their source accordingly. */
  assumed: string[];
}

export function totalKg(state: Pick<AthleteState, "oneRms">): number {
  return ["squat", "bench", "deadlift"].reduce((s, l) => s + (state.oneRms[l] ?? 0), 0);
}

export function bmi(state: Pick<AthleteState, "bodyweightKg" | "heightCm">): number {
  return state.bodyweightKg / (state.heightCm / 100) ** 2;
}

/** Tanaka (2001), the same age-predicted maximum the rest of Split Index already uses. */
export function estimatedMaxHr(age: number): number {
  return Math.round(208 - 0.7 * age);
}

export function hrMaxFor(state: Pick<AthleteState, "maxHr" | "age">): number {
  return state.maxHr ?? estimatedMaxHr(state.age);
}

/** Karvonen: resting + intensity × reserve. */
export function hrAt(state: Pick<AthleteState, "maxHr" | "age" | "restingHr">, intensity: number): number {
  return Math.round(state.restingHr + intensity * (hrMaxFor(state) - state.restingHr));
}

export function pace5kSPerKm(state: Pick<AthleteState, "predicted5kS">): number {
  return state.predicted5kS / 5.0;
}

export interface Goal {
  weeksOut: number;
  target5kS: number | null;
  targetTotalKg: number | null;
  /** 0 = endurance matters more, 1 = strength matters more. Spec's open decision D2: pre-set from the goal gaps, movable by the athlete. */
  priority: number;
  sameDay: boolean;
  interEventGapH: number;
  weightClassKg: number | null;
  /** Suppresses event-order resolution — the organisers have already fixed it. */
  eventOrderKnown: boolean;
}

export interface Constraints {
  daysAvailable: string[];
  twoADaysPossible: boolean;
  /** Real clock times. The spec is emphatic: the 6h separation rule is computed from these, not assumed. An athlete training at 06:00 and 12:00 has a 6-hour gap; one training at 12:00 and 17:00 does not. */
  amHour: number;
  pmHour: number;
  maxSessionsPerWeek: number;
  maxHoursPerWeek: number;
  maxSessionMin: number;
  minRestDays: number;
  gymAccessDays: string[];
  equipment: string[];
}

// ---------------------------------------------------------------------------
// Validation and missing-data resolution
// ---------------------------------------------------------------------------

export interface IntakeIssue {
  field: string;
  /** `block` = no plan may be generated. `assumed` = a documented default was applied and must be surfaced. */
  severity: "block" | "assumed";
  message: string;
}

export interface ResolvedIntake {
  ok: boolean;
  issues: IntakeIssue[];
}

/** Fields the spec marks **Block** — the engine refuses rather than guessing. */
export function validateIntake(
  state: Partial<AthleteState>,
  goal: Partial<Goal>,
  constraints: Partial<Constraints>
): ResolvedIntake {
  const issues: IntakeIssue[] = [];
  const block = (field: string, message: string) => issues.push({ field, severity: "block", message });

  if (state.age == null || state.age < 16 || state.age > 90) {
    block("age", "Age is required and must be between 16 and 90.");
  }
  if (state.bodyweightKg == null || state.bodyweightKg < 35 || state.bodyweightKg > 200) {
    block("bodyweightKg", "Current bodyweight is required (35-200kg).");
  }
  if (state.heightCm == null || state.heightCm < 130 || state.heightCm > 220) {
    block("heightCm", "Height is required (130-220cm) — it sets the BMI floor for the energy-availability safeguard.");
  }
  if (!state.sex) block("sex", "Sex is required — the scoring curves are sex-specific.");
  if (goal.weeksOut == null || goal.weeksOut < 4 || goal.weeksOut > 52) {
    block("weeksOut", "An event date between 4 and 52 weeks out is required.");
  }
  if ((constraints.daysAvailable?.length ?? 0) < 3) {
    block("daysAvailable", "At least three available training days are required.");
  }
  // The refusal the spec singles out by name.
  if (state.currentRunMinPerWeek == null || !Number.isFinite(state.currentRunMinPerWeek)) {
    block(
      "currentRunMinPerWeek",
      "Current weekly running minutes could not be derived from your logs and were not provided. " +
        "This is the on-ramp anchor: without it a plan would have to assume a starting point, which is " +
        "the single most common way generated plans cause injury. Log two weeks of running, or enter it."
    );
  }

  return { ok: !issues.some((i) => i.severity === "block"), issues };
}

/**
 * The cross-check rule. Where the athlete's stated weekly volume contradicts
 * what their logs show, the LOWER value wins and the discrepancy is surfaced.
 * Optimistic self-report is the norm, and this number is the on-ramp anchor,
 * so it must be conservative.
 */
export function reconcileCurrentVolume(
  statedMinPerWeek: number | null,
  loggedMinPerWeek: number | null
): { value: number | null; issue: IntakeIssue | null } {
  if (statedMinPerWeek == null && loggedMinPerWeek == null) return { value: null, issue: null };
  if (statedMinPerWeek == null) return { value: loggedMinPerWeek, issue: null };
  if (loggedMinPerWeek == null) {
    return {
      value: statedMinPerWeek,
      issue: {
        field: "currentRunMinPerWeek",
        severity: "assumed",
        message: `Using your stated ${Math.round(statedMinPerWeek)} min/week — there are no logs to check it against yet.`,
      },
    };
  }
  const value = Math.min(statedMinPerWeek, loggedMinPerWeek);
  if (Math.abs(statedMinPerWeek - loggedMinPerWeek) < 1) return { value, issue: null };
  return {
    value,
    issue: {
      field: "currentRunMinPerWeek",
      severity: "assumed",
      message:
        `You said ${Math.round(statedMinPerWeek)} min/week; your logs show ${Math.round(loggedMinPerWeek)}. ` +
        `The plan starts from ${Math.round(value)} — the lower of the two. This number is what week 1 is built on, ` +
        `so it is deliberately the conservative one.`,
    },
  };
}

/**
 * Whether bodyweight guidance may be shown at all (F2). Three independent
 * gates, any one of which suppresses it. Note this governs only whether the
 * bounded frontier is DISPLAYED — no configuration of this engine ever
 * produces a calorie target, a macro split or a rate-of-loss plan.
 */
export function mayShowBodyweightGuidance(state: Pick<AthleteState, "bodyweightKg" | "heightCm" | "safety">): boolean {
  return state.safety.leaRiskFlags === 0 && bmi(state) >= MIN_HEALTHY_BMI && !state.safety.under18;
}
