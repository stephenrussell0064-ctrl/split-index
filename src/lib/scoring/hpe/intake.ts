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

import {
  DEFAULT_PLANNING_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
  MIN_HORIZON_WEEKS, MIN_HEALTHY_BMI, type SplitDay, type TrainingAge, type TrainingSplit } from "./constants";
import type { CardioModality } from "./modality";

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
  /**
   * Whether that screen was actually answered.
   *
   * Unanswered questions resolve to `true` (the conservative direction), which
   * was harmless while the count only SUPPRESSED things — suppressing on a
   * guess errs safe in both readings. It stopped being harmless the moment the
   * count started driving prose: an athlete who skipped the section was being
   * told "your answers on fuelling suggest you may be under-eating" and shown
   * an eating-disorder helpline, on the basis of answers they never gave.
   *
   * Suppression still keys off the count alone. Assertions key off this.
   */
  leaScreenAnswered: boolean;
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
  // `trainsFasted` is deliberately NOT scored.
  //
  // It was one of five flags, so answering yes to a fasted easy run moved an
  // athlete a fifth of the way to being told they are under-fuelling. Training
  // fasted is an ordinary, widely-used practice — a morning easy run before
  // breakfast is not a clinical finding, and neither is a deliberate cut.
  // The markers that actually predict low energy availability are the ones
  // below: restriction, UNINTENDED loss, bone stress, and amenorrhoea. The
  // answer is still collected because it is useful context for a dietitian;
  // it just no longer votes.
  const items = [
    answers.restrictedFood ?? true,
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
  leaScreenAnswered: true,
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

/**
 * The athlete's typed 1RMs applied as a FLOOR under what their logs say.
 *
 * `Math.max` rather than a replacement is the whole point: a tested single
 * still beats a lower inference, and a later logged lift that beats the typed
 * number takes over instead of being ignored for the life of the intake record.
 *
 * It lives HERE, next to AthleteState, rather than in the intake parser,
 * because two things now have to agree about an athlete's 1RMs and only one of
 * them is the intake. `AthleteState.oneRms` — what the plan is promised
 * against — and `AthleteProfile.oneRms` — what the plan is programmed from —
 * were built by different code from different sources, and diverged by exactly
 * the athlete's own typed correction: the plan judged a meet total feasible
 * from a 180kg squat and then wrote every session at percentages of the 160kg
 * the logs showed, and picked meet attempts off 160 too. Both now run through
 * this function, so there is one number.
 */
export function overriddenOneRms(
  logged: Record<string, number>,
  overrides: Record<string, number | null>
): Record<string, number> {
  const out = { ...logged };
  for (const [lift, override] of Object.entries(overrides)) {
    if (override == null || !Number.isFinite(override) || override <= 0) continue;
    out[lift] = Math.max(out[lift] ?? 0, override);
  }
  return out;
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

export type HorizonSource = "event_date" | "chosen_timeframe" | "suggested";

export interface Goal {
  weeksOut: number;
  /**
   * How `weeksOut` was arrived at. An event date is the strongest signal — it
   * is a real deadline the taper must land on. A chosen timeframe is a
   * training block with no deadline, so the taper becomes a test week instead.
   * `suggested` means the athlete gave neither and the engine picked; the plan
   * says so rather than implying they committed to a date.
   */
  horizonSource: HorizonSource;
  target5kS: number | null;
  /**
   * The endurance race distance the athlete is training for, in kilometres.
   *
   * The intake asked and the answer stopped at the intake — every endurance
   * goal reached the engine as `target5kS` or as nothing, so a marathon block
   * and a 5k block were the same block. This is what makes a long run long
   * enough to be a marathon long run.
   */
  enduranceEventKm: number | null;
  /** The raw event key, so the plan can name what it is preparing for. */
  enduranceEventKey: string | null;
  /**
   * Per-lift targets, each independently skippable. Asking for a "total" is
   * asking the athlete to do arithmetic on three numbers they may not all
   * know — and it makes the whole answer unavailable if one of the three is
   * missing. Any subset is useful: a bench target alone still tells the engine
   * which lift the athlete cares about.
   */
  targetSquatKg: number | null;
  targetBenchKg: number | null;
  targetDeadliftKg: number | null;
  /** Derived from whichever per-lift targets were given. Null when none were. */
  targetTotalKg: number | null;
  /** 0 = endurance matters more, 1 = strength matters more. Spec's open decision D2: pre-set from the goal gaps, movable by the athlete. */
  priority: number;
  sameDay: boolean;
  interEventGapH: number;
  weightClassKg: number | null;
  /** Suppresses event-order resolution — the organisers have already fixed it. */
  eventOrderKnown: boolean;
}

/** One day's training window. Times are local clock hours. */
export interface DayWindow {
  day: string;
  /** False = a rest day this athlete cannot train at all. */
  available: boolean;
  /** Earliest and latest they could start a session that day. */
  startHour: number;
  endHour: number;
  /** Whether they could fit two sessions on this specific day. */
  twoSessions: boolean;
}

export interface Constraints {
  daysAvailable: string[];
  twoADaysPossible: boolean;
  /**
   * Per-day training windows. The intake spec is emphatic that the six-hour
   * separation rule must be computed from real clock times rather than
   * assumed — and real clock times differ BY DAY. An athlete who trains at
   * 06:00 on weekdays and 10:00 at weekends has a different separation
   * profile on each, and collapsing that to one amHour/pmHour pair throws
   * away the thing the rule depends on.
   */
  dayWindows: DayWindow[];
  /**
   * True when the athlete's week genuinely varies — shift work, childcare,
   * an unpredictable job. The scheduler stops treating day placement as
   * meaningful and produces a prioritised session list for the week instead,
   * because a fixed Tuesday/Thursday plan that gets ignored every second week
   * is worse than an ordered list the athlete can place themselves.
   */
  availabilityVaries: boolean;
  /**
   * Soft scheduling preferences. Honoured where nothing physiological objects.
   *
   * These were collected by the intake, parsed into the record, and then never
   * reached the scheduler at all — while the form told the athlete they were
   * "soft preferences the scheduler honours where it can". Either wire them up
   * or stop asking; this is the wiring.
   */
  preferredRestDay?: string | null;
  preferredLongDay?: string | null;
  /** Fallback clock hours, used only for days with no window of their own. */
  amHour: number;
  pmHour: number;
  maxSessionsPerWeek: number;
  maxHoursPerWeek: number;
  maxSessionMin: number;
  minRestDays: number;
  /**
   * How the athlete wants their gym week carved up. A preference, not a
   * finding — two people with identical diagnostics can reasonably want
   * different structures, so it is asked rather than inferred.
   */
  trainingSplit: TrainingSplit | null;
  /**
   * The athlete's own day structure, when they wanted one the five stock
   * splits do not describe. Overrides `trainingSplit` when non-empty.
   *
   * Kept as data on the constraints rather than as a sixth entry in
   * `TRAINING_SPLITS` because it is not a split the engine knows about — it is
   * this athlete's week, and there is exactly one of it.
   */
  customSplitDays?: SplitDay[];
  /**
   * Exercises the athlete picked for a given day label ("Push", "Legs"), from
   * the exercises they have ACTUALLY logged.
   *
   * Empty means the engine chooses, exactly as it did before the question
   * existed — selection is an enhancement, never a requirement. Where a day
   * has picks, they replace the accessory rotation for that day; the primary
   * lift, the load and the rep scheme still come from the diagnostic, because
   * choosing which exercises to do is a preference and choosing how hard to do
   * them is not.
   */
  exercisesByDay?: Record<string, string[]>;
  gymAccessDays: string[];
  equipment: string[];
  /**
   * Which cardio modalities the athlete is willing to train in. A WHITELIST:
   * nothing outside it is ever prescribed.
   *
   * Empty means running, which is what this engine did before the question
   * existed — the default has to be something, and silently switching every
   * existing athlete's plan to a different sport would be a worse surprise
   * than the question itself.
   */
  cardioModalities?: CardioModality[];
  /**
   * Whether the athlete wants the plan to mix modalities at all.
   *
   * Off with a single modality chosen means every endurance session is that
   * modality — the "otherwise only provide a plan with their given cardio
   * choice(s)" half of the question, which is the half that is easy to ignore.
   */
  crossTrainOk?: boolean;
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
  // Data gaps no longer block. Every one of these degrades to a documented,
  // surfaced assumption instead — see the module note on `assessTailoring`.
  // The engine pays for uncertainty in caution (a halved ramp, a lower start,
  // wider bands) rather than in a refusal that teaches the athlete nothing.
  //
  // The safety screen is untouched and still blocks. It runs in
  // `safetyScreen`, not here, and the difference is the point: a missing
  // bodyweight is a gap more logging fills, whereas exertional chest pain is
  // not a gap at all.
  const assume = (field: string, message: string) => issues.push({ field, severity: "assumed", message });

  if (state.age == null || state.age < 16 || state.age > 90) {
    assume("age", "Age was not available, so 30 is assumed. It sets your estimated maximum heart rate, so every heart-rate band below inherits the guess.");
  }
  if (state.bodyweightKg == null || state.bodyweightKg < 35 || state.bodyweightKg > 200) {
    assume(
      "bodyweightKg",
      "Bodyweight is not on file. Nothing in the plan depends on it except the energy-availability safeguard, so " +
        "no bodyweight guidance of any kind is shown until it is."
    );
  }
  if (state.heightCm == null || state.heightCm < 130 || state.heightCm > 220) {
    assume(
      "heightCm",
      "Height is not on file, so the BMI floor cannot be checked and bodyweight guidance stays suppressed."
    );
  }
  if (!state.sex) {
    assume("sex", "Sex is not set, so population-average scoring curves are used rather than sex-specific ones.");
  }
  if ((constraints.daysAvailable?.length ?? 0) < 3) {
    assume(
      "daysAvailable",
      "Fewer than three training days are set, so the plan is built around a default week. Setting your real days " +
        "is what lets the scheduler space hard sessions properly."
    );
  }
  // No longer a refusal. The on-ramp anchor still matters more than anything
  // else here — starting 60% above where an athlete actually is remains the
  // most common way generated plans injure people — so when it is unknown the
  // plan starts LOW and ramps at half rate rather than not existing.
  if (state.currentRunMinPerWeek == null || !Number.isFinite(state.currentRunMinPerWeek)) {
    assume(
      "currentRunMinPerWeek",
      "Your current weekly running volume is not known from your logs and was not entered, so week 1 starts at a " +
        "deliberately low default and the ramp runs at half rate. Log a normal week, or enter the number, and the " +
        "plan will restart from where you actually are."
    );
  }
  if (goal.weeksOut == null || goal.weeksOut < MIN_HORIZON_WEEKS || goal.weeksOut > MAX_HORIZON_WEEKS) {
    assume(
      "weeksOut",
      `No event date or timeframe was set, so a ${DEFAULT_PLANNING_HORIZON_WEEKS}-week block is used. You can pick a ` +
        `different timeframe, or add an event date, at any time.`
    );
  }

  return { ok: !issues.some((i) => i.severity === "block"), issues };
}

/**
 * Resolves the planning horizon from whatever the athlete gave, in order of
 * strength: a real event date, then a chosen timeframe, then the engine's own
 * default.
 *
 * The distinction is not cosmetic. An event date is a deadline the taper has
 * to land on; a chosen timeframe is a block with no deadline, so the last ten
 * days become a test week rather than a peak. Recording WHICH is why the plan
 * can say "your 12-week block" rather than implying a race the athlete never
 * entered.
 */
export function resolveHorizon(
  eventDate: string | null,
  chosenTimeframeWeeks: number | null,
  now: Date = new Date()
): { weeksOut: number; horizonSource: HorizonSource; note: string | null } {
  if (eventDate) {
    const weeks = Math.round((new Date(eventDate).getTime() - now.getTime()) / (7 * 86_400_000));
    if (Number.isFinite(weeks) && weeks >= MIN_HORIZON_WEEKS && weeks <= MAX_HORIZON_WEEKS) {
      return { weeksOut: weeks, horizonSource: "event_date", note: null };
    }
    if (Number.isFinite(weeks) && weeks < MIN_HORIZON_WEEKS) {
      return {
        weeksOut: MIN_HORIZON_WEEKS,
        horizonSource: "event_date",
        note:
          `Your event is under ${MIN_HORIZON_WEEKS} weeks away. There is not enough runway to build anything, so ` +
          `this is a sharpening and taper block rather than a training block — the goal is arriving fresh, not fitter.`,
      };
    }
    if (Number.isFinite(weeks) && weeks > MAX_HORIZON_WEEKS) {
      return {
        weeksOut: MAX_HORIZON_WEEKS,
        horizonSource: "event_date",
        note:
          `Your event is more than a year out, so this plan covers the next ${MAX_HORIZON_WEEKS} weeks. It will be ` +
          `rebuilt well before the event as your data accumulates.`,
      };
    }
  }

  if (chosenTimeframeWeeks != null && Number.isFinite(chosenTimeframeWeeks)) {
    const weeks = Math.min(MAX_HORIZON_WEEKS, Math.max(MIN_HORIZON_WEEKS, Math.round(chosenTimeframeWeeks)));
    return { weeksOut: weeks, horizonSource: "chosen_timeframe", note: null };
  }

  return {
    weeksOut: DEFAULT_PLANNING_HORIZON_WEEKS,
    horizonSource: "suggested",
    note:
      `You have not set an event date or picked a timeframe, so this is a ${DEFAULT_PLANNING_HORIZON_WEEKS}-week ` +
      `block — the standard length, and the horizon every progression rate in this engine is expressed against. ` +
      `Change it whenever you like.`,
  };
}

/** Sums whichever per-lift targets were given. Null when none were — a partial answer is still an answer, but no answer is not a total of zero. */
export function deriveTargetTotal(
  squat: number | null,
  bench: number | null,
  deadlift: number | null
): number | null {
  const given = [squat, bench, deadlift].filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  return given.length > 0 ? given.reduce((a, b) => a + b, 0) : null;
}

/**
 * The cross-check rule. Where the athlete's stated weekly volume contradicts
 * what their logs show, the LOWER value wins and the discrepancy is surfaced.
 * Optimistic self-report is the norm, and this number is the on-ramp anchor,
 * so it must be conservative.
 */
export function reconcileCurrentVolume(
  statedMinPerWeek: number | null,
  loggedMinPerWeek: number | null,
  /** The athlete has said not all their training is recorded in this app. */
  trainsOutsideApp = false
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
  // The athlete's own figure wins when they have said they train outside the
  // app.
  //
  // Taking the lower of the two is the right default: an inflated starting
  // number ramps someone into an injury, and most gaps between stated and
  // logged are optimism. But it is wrong when the gap is simply that the
  // training was not recorded here — a week on a treadmill at a hotel, a club
  // session logged on someone else's watch — and there was no way to say so.
  // The plan then anchored week 1 to a number the athlete had already told us
  // was incomplete, and no amount of re-typing it would move it.
  if (trainsOutsideApp) {
    return {
      value: statedMinPerWeek,
      issue: {
        field: "currentRunMinPerWeek",
        severity: "assumed",
        message:
          `Using your stated ${Math.round(statedMinPerWeek)} min/week rather than the ` +
          `${Math.round(loggedMinPerWeek)} your logs show, because you said not all of your training gets ` +
          `recorded here. Week 1 is built on this number, so it is worth being honest rather than optimistic ` +
          `about it — the ramp is measured from here.`,
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
        `so it is deliberately the conservative one. If the gap is because not all your training is recorded ` +
        `here, say so on the intake and your own figure will be used instead.`,
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
