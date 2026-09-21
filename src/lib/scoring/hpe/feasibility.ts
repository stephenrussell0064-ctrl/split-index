/**
 * Hybrid Plan Engine — WP4: feasibility, the bounded bodyweight frontier, and
 * the develop/maintain decision.
 *
 * Closes F7 (Major): "Rev A's linear pace-cost model predicted a 14:10 5k at
 * 60 kg for an athlete currently running 19:20. Any extrapolation model needs
 * bounds; this one now refuses to report beyond ±8% bodyweight or below
 * BMI 19." That refusal is the same discipline as `predictHrAtPace` returning
 * null outside its fitted range — non-negotiable #6, bound every
 * extrapolation or refuse to make it.
 *
 * The frontier is also the subject of F2, the finding the assurance review
 * would put first in any conversation. Every row carries the minimum number
 * of weeks the change would take at a ≤0.6%/week ceiling, which reframes it
 * from "lose 8 kg" to "this would take 11 weeks and here is what it costs you
 * in kilos on the bar." No row is emitted at all unless the safety screen has
 * cleared bodyweight guidance, and no calorie, macro or rate-of-loss output
 * is produced under any configuration.
 *
 * ---------------------------------------------------------------------------
 * The feasibility model (constants 3.0.0) is PROBABILISTIC. The previous one
 * multiplied a training-age rate by a block count and reported a point with a
 * fixed 35% "cautious" shading. It had no variance, no dose term, no sex or
 * age term, and it did not know how much running the plan actually delivered.
 * An athlete read "projects 21:46-22:15" as a promise and the engine had no
 * basis for the width of that band.
 *
 * What it does now, each step traceable to the evidence register:
 *
 *  1. Gain per block is a distribution — a mean and an SD by training age —
 *     taken from the cohorts that report one (Ahtiainen 2016, Latella
 *     2020/2024, Muñoz 2014, Festa 2020, HERITAGE). Training age is inferred
 *     from performance as a floor under what the athlete typed, on BOTH sides
 *     now, not only endurance.
 *  2. Multi-block horizons flatten (exponent 0.85) rather than compounding.
 *  3. Interference is applied where the meta-analyses find it — lower-body
 *     strength, men, with a real running load (Petré 2021, Huiberts 2024) —
 *     and nowhere else. Not to bench, not to women, not as a flat 18%.
 *  4. The DOSE the plan delivers scales the expected gain (Montero & Lundby
 *     2017 for endurance minutes; Androulakis-Korakakis 2021 for hard sets).
 *     A plan that cannot deliver the dose says so before it says the goal is
 *     out of reach.
 *  5. Measurement noise is added in quadrature, and a gain smaller than the
 *     noise is labelled as not measurable rather than promised.
 *  6. An adherence prior scales the probability, because the outcome the
 *     athlete experiences includes the chance they do not finish the block.
 *  7. The output is an expected outcome, an 80% interval, a probability of
 *     reaching the stated target, and a goal LEVEL: within reach, stretch, or
 *     multi-block — with a primary milestone at the expected outcome when the
 *     target is beyond one SD (Bar-Eli 1997; Locke & Latham).
 */

import {
  ADHERENCE_BASE,
  ADHERENCE_LIFE_LOAD_MULTIPLIER,
  ADHERENCE_NOVICE_ENDURANCE_MULTIPLIER,
  ADHERENCE_OVER_AVAILABILITY_MULTIPLIER,
  ADHERENCE_PRIOR_INJURY_MULTIPLIER,
  AGE_GAIN_PENALTY_PER_DECADE,
  AGE_GAIN_PENALTY_START,
  ALLOMETRIC_EXPONENT,
  CONCURRENT_ATTENUATION_ENDURANCE_NOVICE,
  CONCURRENT_ATTENUATION_LOWER_BODY_MALE,
  CONCURRENT_ATTENUATION_RUN_MIN_THRESHOLD,
  DEVELOP_GAP_THRESHOLD,
  ENDURANCE_DOSE_FLOOR_MIN_PER_WEEK,
  ENDURANCE_DOSE_FLOOR_SHARE,
  ENDURANCE_DOSE_FULL_MIN_PER_WEEK,
  ENDURANCE_GAIN_PER_BLOCK,
  ENDURANCE_GAIN_SD_PER_BLOCK,
  ENDURANCE_TRAINING_AGE_FLOOR_BY_5K,
  EVENT_RIEGEL_K_MARATHON_HIGH_VOLUME,
  EVENT_RIEGEL_K_MARATHON_LOW_VOLUME,
  EVENT_RIEGEL_K_UP_TO_HALF,
  FEMALE_RELATIVE_TOTAL_FACTOR,
  FRONTIER_MAX_DELTA_FRACTION,
  JOINT_GOAL_CORRELATION,
  LIFE_LOAD_SLEEP_HOURS_THRESHOLD,
  LIFE_LOAD_STRESS_THRESHOLD,
  MARATHON_HIGH_VOLUME_MIN_PER_WEEK,
  MAX_HORIZON_WEEKS,
  MAX_SAFE_LOSS_RATE_PCT_PER_WEEK,
  MIN_HEALTHY_BMI,
  MULTI_BLOCK_GAIN_EXPONENT,
  MULTI_BLOCK_GOAL_SD,
  ONE_RM_TEST_NOISE_FRACTION,
  PACE_COST_S_PER_KM_PER_KG,
  PARTIAL_COMPLETION_GAIN_SHARE,
  PRIORITY_SHARE_SKEW,
  RUNNING_ECONOMY_BONUS_PER_BLOCK,
  RUNNING_ECONOMY_MIN_HEAVY_SESSIONS,
  RUN_TEST_NOISE_FRACTION,
  STRENGTH_DOSE_FLOOR_SETS_PER_LIFT_PER_WEEK,
  STRENGTH_DOSE_FLOOR_SHARE,
  STRENGTH_DOSE_FULL_SETS_PER_LIFT_PER_WEEK,
  STRENGTH_GAIN_PER_BLOCK,
  STRENGTH_GAIN_SD_PER_BLOCK,
  STRENGTH_TRAINING_AGE_FLOOR_BY_RELATIVE_TOTAL,
  STRETCH_GOAL_SD,
  type TrainingAge,
} from "./constants";
import { totalKg, type AthleteState, type Goal } from "./intake";
import { blendRate, type ObservedResponse } from "./response";

// ---------------------------------------------------------------------------
// The bounded frontier (F7)
// ---------------------------------------------------------------------------

export interface FrontierPoint {
  bodyweightKg: number;
  projected5kS: number;
  projectedTotalKg: number;
  /** Minimum weeks the change would take at the safe-rate ceiling. Reframes the row from a target into a cost. */
  minWeeks: number;
}

/**
 * Returns null — refuses to report — outside ±8% bodyweight or below the BMI
 * floor. A null here is not an error, it is the model declining to
 * extrapolate past where it is credible.
 */
export function frontierPoint(state: AthleteState, targetBodyweightKg: number): FrontierPoint | null {
  const delta = targetBodyweightKg - state.bodyweightKg;
  if (Math.abs(delta) / state.bodyweightKg > FRONTIER_MAX_DELTA_FRACTION) return null;
  if (targetBodyweightKg / (state.heightCm / 100) ** 2 < MIN_HEALTHY_BMI) return null;

  const projectedTotalKg = totalKg(state) * Math.pow(targetBodyweightKg / state.bodyweightKg, ALLOMETRIC_EXPONENT);
  const projected5kS = state.predicted5kS + delta * PACE_COST_S_PER_KM_PER_KG * 5.0;
  return {
    bodyweightKg: targetBodyweightKg,
    projected5kS,
    projectedTotalKg,
    minWeeks: minWeeksForBodyweightChange(state, targetBodyweightKg),
  };
}

/** How long the change would take at the safe-rate ceiling. Stated as a duration, never as a prescription. */
export function minWeeksForBodyweightChange(state: AthleteState, targetBodyweightKg: number): number {
  if (targetBodyweightKg >= state.bodyweightKg) return 0;
  const fraction = (state.bodyweightKg - targetBodyweightKg) / state.bodyweightKg;
  return Math.ceil(fraction / MAX_SAFE_LOSS_RATE_PCT_PER_WEEK);
}

/**
 * The frontier as shown to the athlete — or an empty list plus the reason,
 * when the safety screen has suppressed it. Callers must pass
 * `showBodyweightGuidance` from the safety screen; there is no path that
 * renders this without consulting it.
 */
export function bodyweightFrontier(
  state: AthleteState,
  showBodyweightGuidance: boolean,
  candidateWeights?: number[]
): { points: FrontierPoint[]; suppressed: boolean; note: string } {
  if (!showBodyweightGuidance) {
    return {
      points: [],
      suppressed: true,
      note:
        "Bodyweight guidance is not shown for this account. Performance here is built by training, and that is what " +
        "the plan does.",
    };
  }
  const weights =
    candidateWeights ??
    [-0.08, -0.05, -0.03, 0, 0.03, 0.05, 0.08].map((f) => Math.round(state.bodyweightKg * (1 + f)));
  const points = weights
    .map((w) => frontierPoint(state, w))
    .filter((p): p is FrontierPoint => p !== null)
    .sort((a, b) => a.bodyweightKg - b.bodyweightKg);
  return {
    points,
    suppressed: false,
    note:
      `Bounded to ±${Math.round(FRONTIER_MAX_DELTA_FRACTION * 100)}% of your current bodyweight and never below ` +
      `BMI ${MIN_HEALTHY_BMI}. Each row shows what the change would cost you on the bar and how many weeks it would ` +
      `take at a sustainable rate — it is a trade-off, not a recommendation.`,
  };
}

// ---------------------------------------------------------------------------
// Feasibility (Stage A)
// ---------------------------------------------------------------------------

/** Standard normal CDF, Abramowitz & Stegun 7.1.26 — accurate to 1.5e-7, which is far inside anything this model claims. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  // erf is evaluated at z/√2; the CDF is (1 + erf(z/√2)) / 2.
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  const p = 0.5 * (1 + (z >= 0 ? erf : -erf));
  return Math.min(1, Math.max(0, p));
}

/** 80% interval half-width in SDs. */
const Z_80 = 1.2816;

export type GoalLevel = "within-reach" | "stretch" | "multi-block";

export interface GoalComponentOutcome {
  /** The expected outcome of a completed block — a 5k time in seconds, or a total in kg. */
  expected: number;
  /** 80% interval, [better, worse] for a time and [lower, higher] for a total. */
  interval80: [number, number];
  /** SD of the outcome, test noise included. */
  sd: number;
  /** Expected fractional gain after every adjustment, positive. */
  gainFraction: number;
  /** How much of the prior gain the plan's dose supports, 0-1. */
  doseMultiplier: number;
  /** Probability of reaching the stated target, adherence included. Null when there is no target. */
  probability: number | null;
  level: GoalLevel | null;
  /** The milestone to train toward when the target is a stretch or a multi-block goal — the expected outcome. */
  primaryGoal: number | null;
  /** For a multi-block goal, roughly how many weeks the model thinks the stated target needs. */
  weeksNeeded: number | null;
  /** True when the expected gain is inside the test's own noise. */
  belowNoiseFloor: boolean;
  /** How many SDs above the mean the stated target sits. Null without a target. */
  zRequired: number | null;
}

/**
 * What the generated plan actually delivers each week, on average across the
 * development phases. The feasibility model is run once BEFORE the sessions
 * are built (so the quality-session pace anchor exists) and once after, with
 * this filled in, so the athlete reads the projection for the plan they were
 * actually given.
 */
export interface DeliveredDose {
  enduranceMinPerWeek: number;
  /** Strength sessions at or above 80% on a lower-body lift, per week. */
  heavyStrengthSessionsPerWeek: number;
  /** Direct hard sets per competition lift per week, averaged over the three lifts that have a target. */
  setsPerLiftPerWeek: number;
  sessionsPerWeek: number;
}

export interface FeasibilityResult {
  blocks: number;
  /** Kept for callers that read the point estimates — they are the expected outcomes. */
  projectedTotalKg: number;
  projected5kS: number;
  /** [best, cautious] — the 80% interval, so both ends are meaningful now rather than an arbitrary shading. */
  projected5kRangeS: [number, number];
  projectedTotalRangeKg: [number, number];
  strengthGainPct: number;
  enduranceGainPct: number;
  strengthReachable: boolean | null;
  strengthShortfallKg: number | null;
  enduranceReachable: boolean | null;
  enduranceShortfallS: number | null;
  /** The full probabilistic outcome per component. */
  endurance: GoalComponentOutcome;
  strength: GoalComponentOutcome;
  /** Probability of hitting BOTH stated targets, or null when fewer than two are stated. */
  jointProbability: number | null;
  /** Probability the athlete completes the block as written — the adherence prior. */
  adherence: number;
  /** Projected time for the named running event, from the expected 5k and a volume-conditioned exponent. Null without a running event. */
  projectedEventS: number | null;
  projectedEventRangeS: [number, number] | null;
  /** The training ages the model actually used, after the performance floors. */
  strengthTrainingAgeUsed: TrainingAge;
  enduranceTrainingAgeUsed: TrainingAge;
  /** This athlete's own measured rate, where there was enough history to measure one. */
  observedResponse: ObservedResponse | null;
  /** Plain-English summary for the athlete — this is the honest conversation about the target, delivered up front rather than at the finish line. */
  messages: string[];
  /** Dose limitations of the plan itself, stated separately from the goal verdict. */
  doseWarnings: string[];
}

const LIFT_LABELS: Record<"squat" | "bench" | "deadlift", string> = {
  squat: "squat",
  bench: "bench",
  deadlift: "deadlift",
};

/**
 * What the target total should actually be measured against.
 *
 * TWO WAYS THIS WENT WRONG, both of them producing a number that looked
 * authoritative and meant nothing.
 *
 * 1. DIFFERENT LIFT SETS. `targetTotalKg` is derived from whichever lifts the
 *    athlete named (deriveTargetTotal), while the current total summed all
 *    three. A bench-only target was therefore compared against squat + bench +
 *    deadlift, which reads as a collapse.
 *
 * 2. A MISSING 1RM COUNTED AS ZERO. A lift the athlete has a target for but has
 *    never logged contributed 0 to "current", so the shortfall came out as very
 *    nearly the whole target.
 *
 * So: compare over exactly the lifts the target names, and report which named
 * lifts have no number rather than silently valuing them at nothing.
 */
export function strengthComparisonBasis(
  state: Pick<AthleteState, "oneRms">,
  goal: Pick<Goal, "targetSquatKg" | "targetBenchKg" | "targetDeadliftKg">
): { currentKg: number; missingLifts: string[]; lowerBodyFraction: number } {
  const named = (["squat", "bench", "deadlift"] as const).filter((lift) => {
    const target =
      lift === "squat" ? goal.targetSquatKg : lift === "bench" ? goal.targetBenchKg : goal.targetDeadliftKg;
    return target != null && target > 0;
  });

  const lifts = named.length === 0 ? (["squat", "bench", "deadlift"] as const) : named;
  let currentKg = 0;
  let lowerKg = 0;
  const missingLifts: string[] = [];
  for (const lift of lifts) {
    const oneRm = state.oneRms[lift];
    if (oneRm == null || oneRm <= 0) {
      if (named.length > 0) missingLifts.push(LIFT_LABELS[lift]);
      continue;
    }
    currentKg += oneRm;
    if (lift !== "bench") lowerKg += oneRm;
  }
  return { currentKg, missingLifts, lowerBodyFraction: currentKg > 0 ? lowerKg / currentKg : 0.67 };
}

const AGE_ORDER: TrainingAge[] = ["novice", "intermediate", "advanced", "elite"];

function olderOf(a: TrainingAge, b: TrainingAge): TrainingAge {
  return AGE_ORDER.indexOf(a) >= AGE_ORDER.indexOf(b) ? a : b;
}

/**
 * Training age inferred from performance, floored against what the athlete
 * said. An 18:25 5k is not a beginner's time however long they say they have
 * been running, and novice gain rates applied to it produce a projection the
 * athlete will read as a promise.
 */
export function inferredEnduranceTrainingAge(stated: TrainingAge, predicted5kS: number): TrainingAge {
  let floor: TrainingAge = "novice";
  for (const [seconds, age] of ENDURANCE_TRAINING_AGE_FLOOR_BY_5K) {
    if (predicted5kS <= seconds) {
      floor = age;
      break;
    }
  }
  return olderOf(stated, floor);
}

/**
 * The same floor on the strength side. Someone with a 2×bodyweight squat who
 * left the history section blank was being given the novice rate — 12% a
 * block — because unanswered resolves to zero years. Relative total is the
 * signal; the female factor mirrors the scoring engine's own sex adjustment.
 */
export function inferredStrengthTrainingAge(
  stated: TrainingAge,
  state: Pick<AthleteState, "oneRms" | "bodyweightKg" | "sex">
): TrainingAge {
  const total = totalKg(state);
  if (total <= 0 || state.bodyweightKg <= 0) return stated;
  const factor = state.sex === "female" ? FEMALE_RELATIVE_TOTAL_FACTOR : 1;
  const relative = total / state.bodyweightKg / factor;
  let floor: TrainingAge = "novice";
  for (const [threshold, age] of STRENGTH_TRAINING_AGE_FLOOR_BY_RELATIVE_TOTAL) {
    if (relative >= threshold) {
      floor = age;
      break;
    }
  }
  return olderOf(stated, floor);
}

/** Riegel exponent for projecting the 5k to the named event — volume-conditioned for the marathon. */
export function eventRiegelK(eventKm: number, runMinPerWeek: number): number {
  if (eventKm <= 21.2) return EVENT_RIEGEL_K_UP_TO_HALF;
  return runMinPerWeek >= MARATHON_HIGH_VOLUME_MIN_PER_WEEK
    ? EVENT_RIEGEL_K_MARATHON_HIGH_VOLUME
    : EVENT_RIEGEL_K_MARATHON_LOW_VOLUME;
}

export function fmtTime(s: number): string {
  const total = Math.max(0, Math.round(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** How much of the prior gain the delivered dose supports — linear between the floor and the full dose. */
function doseMultiplier(delivered: number, floorAt: number, fullAt: number, floorShare: number): number {
  if (delivered >= fullAt) return 1;
  if (delivered <= floorAt) return floorShare;
  return floorShare + (1 - floorShare) * ((delivered - floorAt) / (fullAt - floorAt));
}

function goalLevelFor(zRequired: number | null): GoalLevel | null {
  if (zRequired == null) return null;
  if (zRequired <= STRETCH_GOAL_SD) return "within-reach";
  if (zRequired <= MULTI_BLOCK_GOAL_SD) return "stretch";
  return "multi-block";
}

/** Adherence prior — the chance the block gets done as written. */
export function adherencePrior(
  state: AthleteState,
  goal: Goal,
  dose: DeliveredDose | undefined,
  enduranceAge: TrainingAge,
  maxSessionsPerWeek: number | null
): number {
  let a = ADHERENCE_BASE;
  if (state.safety.injuryLast12Weeks || state.safety.currentInjuryLimiting) a *= ADHERENCE_PRIOR_INJURY_MULTIPLIER;
  if (enduranceAge === "novice" && (goal.enduranceEventKm != null || goal.target5kS != null)) {
    a *= ADHERENCE_NOVICE_ENDURANCE_MULTIPLIER;
  }
  const stress = state.lifeStressNow ?? 3;
  const sleep = state.sleepHoursTypical ?? 7;
  if (stress >= LIFE_LOAD_STRESS_THRESHOLD || sleep < LIFE_LOAD_SLEEP_HOURS_THRESHOLD) a *= ADHERENCE_LIFE_LOAD_MULTIPLIER;
  if (dose && maxSessionsPerWeek != null && dose.sessionsPerWeek > maxSessionsPerWeek) {
    a *= ADHERENCE_OVER_AVAILABILITY_MULTIPLIER;
  }
  return clamp01(a);
}

function componentOutcome(args: {
  baseline: number;
  /** True for a time (lower is better), false for a load. */
  lowerIsBetter: boolean;
  target: number | null;
  mu: number;
  sigma: number;
  dose: number;
  noise: number;
  adherence: number;
  blocks: number;
  weeksOut: number;
}): GoalComponentOutcome {
  const { baseline, lowerIsBetter, target, mu, sigma, dose, noise, adherence, blocks, weeksOut } = args;
  const gain = Math.max(0, mu * dose);
  const sign = lowerIsBetter ? -1 : 1;
  const expected = baseline * (1 + sign * gain);
  const sd = Math.sqrt((baseline * sigma * dose) ** 2 + (baseline * noise) ** 2);
  const interval80: [number, number] = lowerIsBetter
    ? [expected - Z_80 * sd, expected + Z_80 * sd]
    : [expected - Z_80 * sd, expected + Z_80 * sd];

  let probability: number | null = null;
  let zRequired: number | null = null;
  let level: GoalLevel | null = null;
  let primaryGoal: number | null = null;
  let weeksNeeded: number | null = null;

  if (target != null && target > 0 && baseline > 0) {
    // Required fractional gain, positive when the target is better than today.
    const required = lowerIsBetter ? (baseline - target) / baseline : (target - baseline) / baseline;
    const priorSd = Math.max(1e-6, sigma * dose);
    zRequired = (required - gain) / priorSd;
    level = required <= 0 ? "within-reach" : goalLevelFor(zRequired);

    const pComplete = lowerIsBetter ? normalCdf((target - expected) / sd) : normalCdf((expected - target) / sd);
    const partialExpected = baseline * (1 + sign * gain * PARTIAL_COMPLETION_GAIN_SHARE);
    const pPartial = lowerIsBetter
      ? normalCdf((target - partialExpected) / sd)
      : normalCdf((partialExpected - target) / sd);
    probability = clamp01(adherence * pComplete + (1 - adherence) * pPartial);

    if (level === "stretch" || level === "multi-block") primaryGoal = expected;
    if (level === "multi-block" && mu > 0 && required > 0) {
      // Solve mu_block × (w/12)^exp = required for w, capped at the engine's own horizon.
      const perBlock = mu * dose / Math.pow(Math.max(blocks, 1e-6), MULTI_BLOCK_GAIN_EXPONENT);
      const w = 12 * Math.pow(required / Math.max(perBlock, 1e-6), 1 / MULTI_BLOCK_GAIN_EXPONENT);
      weeksNeeded = Math.min(MAX_HORIZON_WEEKS, Math.max(weeksOut, Math.round(w)));
    }
  }

  return {
    expected,
    interval80,
    sd,
    gainFraction: gain,
    doseMultiplier: dose,
    probability,
    level,
    primaryGoal,
    weeksNeeded,
    belowNoiseFloor: gain < 2 * noise,
    zRequired,
  };
}

export interface FeasibilityOptions {
  /** What the plan delivers. Absent on the pre-session pass. */
  dose?: DeliveredDose;
  maxSessionsPerWeek?: number | null;
  /**
   * This athlete's own measured rate of improvement, from their logged
   * diagnostic history. Blended into the population prior at the weight the
   * observation length supports — see `response.ts` for why that weight is
   * deliberately small.
   */
  observed?: ObservedResponse | null;
}

export function feasibilityScreen(state: AthleteState, goal: Goal, options: FeasibilityOptions = {}): FeasibilityResult {
  const { dose, observed } = options;
  const blocks = goal.weeksOut / 12.0;
  const blockScale = Math.pow(Math.max(blocks, 1e-6), MULTI_BLOCK_GAIN_EXPONENT);

  const strengthAge = inferredStrengthTrainingAge(state.strengthTrainingAge, state);
  const enduranceAge = inferredEnduranceTrainingAge(state.enduranceTrainingAge, state.predicted5kS);

  // The priority slider splits the available adaptation between domains.
  // Focus SCALES the published rate down; it never scales it up — the rates
  // already describe someone training that discipline properly.
  const strengthShare = 0.5 + 0.5 * (goal.priority - 0.5) * 2 * PRIORITY_SHARE_SKEW;
  const enduranceShare = 1.0 - strengthShare;
  // A split athlete gives up a little of each rate to shared recovery and
  // shared hours (Prieto-González 2022: both improved, each at 50-80% of a
  // single-focus block, the endurance side less penalised). Full focus is the
  // published rate; a 50/50 split is a small step under it. Focus never
  // scales a rate UP — the rates already describe someone training that
  // discipline properly.
  const focusFor = (share: number) => 0.8 + 0.2 * Math.min(1, share / (0.5 + 0.5 * PRIORITY_SHARE_SKEW));
  const strengthFocus = focusFor(strengthShare);
  const enduranceFocus = focusFor(enduranceShare);

  const agePenalty =
    state.age > AGE_GAIN_PENALTY_START
      ? Math.max(0.5, 1 - AGE_GAIN_PENALTY_PER_DECADE * ((state.age - AGE_GAIN_PENALTY_START) / 10))
      : 1;

  // ---- strength prior --------------------------------------------------
  const basis = strengthComparisonBasis(state, goal);
  let muS = STRENGTH_GAIN_PER_BLOCK[strengthAge] * blockScale * strengthFocus * agePenalty;
  const sigmaS = STRENGTH_GAIN_SD_PER_BLOCK[strengthAge] * blockScale;
  // Interference, where the evidence finds it: lower-body, men, real running load.
  const runningLoad = Math.max(state.currentRunMinPerWeek, dose?.enduranceMinPerWeek ?? 0);
  if (state.sex === "male" && runningLoad >= CONCURRENT_ATTENUATION_RUN_MIN_THRESHOLD) {
    muS *= 1 - CONCURRENT_ATTENUATION_LOWER_BODY_MALE * basis.lowerBodyFraction;
  }
  const doseS = dose
    ? doseMultiplier(
        dose.setsPerLiftPerWeek,
        STRENGTH_DOSE_FLOOR_SETS_PER_LIFT_PER_WEEK,
        STRENGTH_DOSE_FULL_SETS_PER_LIFT_PER_WEEK,
        STRENGTH_DOSE_FLOOR_SHARE
      )
    : 1;

  // ---- endurance prior -------------------------------------------------
  let muE = ENDURANCE_GAIN_PER_BLOCK[enduranceAge] * blockScale * enduranceFocus * agePenalty;
  const sigmaE = ENDURANCE_GAIN_SD_PER_BLOCK[enduranceAge] * blockScale;
  const hasStrengthGoal = goal.targetTotalKg != null;
  if (enduranceAge === "novice" && hasStrengthGoal) muE *= 1 - CONCURRENT_ATTENUATION_ENDURANCE_NOVICE;
  // Heavy strength work improves running economy — only when the plan
  // actually delivers it.
  if ((dose?.heavyStrengthSessionsPerWeek ?? 0) >= RUNNING_ECONOMY_MIN_HEAVY_SESSIONS) {
    muE += RUNNING_ECONOMY_BONUS_PER_BLOCK * blockScale;
  }
  const doseE = dose
    ? doseMultiplier(
        dose.enduranceMinPerWeek,
        ENDURANCE_DOSE_FLOOR_MIN_PER_WEEK,
        ENDURANCE_DOSE_FULL_MIN_PER_WEEK,
        ENDURANCE_DOSE_FLOOR_SHARE
      )
    : 1;

  // ---- this athlete's own measured rate --------------------------------
  // Applied AFTER the priors and their adjustments, and before the dose
  // scaling, because the observation already contains whatever dose the
  // athlete was actually doing while it was measured.
  const priorMuE = muE;
  const priorMuS = muS;
  if (observed) {
    muE = blendRate(muE, observed.endurancePerBlock, observed.weight, blocks);
    muS = blendRate(muS, observed.strengthPerBlock, observed.weight, blocks);
  }

  const adherence = adherencePrior(state, goal, dose, enduranceAge, options.maxSessionsPerWeek ?? null);

  const endurance = componentOutcome({
    baseline: state.predicted5kS,
    lowerIsBetter: true,
    target: goal.target5kS,
    mu: muE,
    sigma: sigmaE,
    dose: doseE,
    noise: RUN_TEST_NOISE_FRACTION,
    adherence,
    blocks,
    weeksOut: goal.weeksOut,
  });

  const strengthTarget = basis.missingLifts.length > 0 ? null : goal.targetTotalKg;
  const strength = componentOutcome({
    baseline: basis.currentKg,
    lowerIsBetter: false,
    target: strengthTarget,
    mu: muS,
    sigma: sigmaS,
    dose: doseS,
    noise: ONE_RM_TEST_NOISE_FRACTION,
    adherence,
    blocks,
    weeksOut: goal.weeksOut,
  });

  // ---- the named running event, projected from the expected 5k -----------
  let projectedEventS: number | null = null;
  let projectedEventRangeS: [number, number] | null = null;
  if (goal.enduranceEventKm != null && goal.enduranceEventKm > 0) {
    const k = eventRiegelK(goal.enduranceEventKm, runningLoad);
    const scale = Math.pow(goal.enduranceEventKm / 5, k);
    projectedEventS = endurance.expected * scale;
    projectedEventRangeS = [endurance.interval80[0] * scale, endurance.interval80[1] * scale];
  }

  // ---- messages ----------------------------------------------------------
  const messages: string[] = [];
  const doseWarnings: string[] = [];
  const pct = (p: number) => `${Math.round(p * 100)}%`;

  if (dose && doseE < 1 && (goal.target5kS != null || goal.enduranceEventKm != null)) {
    doseWarnings.push(
      `This plan delivers about ${Math.round(dose.enduranceMinPerWeek)} minutes of running a week. Below ` +
        `${ENDURANCE_DOSE_FULL_MIN_PER_WEEK} the chance of no measurable aerobic gain rises sharply (roughly 40% at ` +
        `120 minutes, 70% at 60), so the projection below is scaled to ${pct(doseE)} of what a full dose would ` +
        `support. More minutes is the lever — more intensity is not.`
    );
  }
  if (dose && doseS < 1 && goal.targetTotalKg != null) {
    doseWarnings.push(
      `This plan gives each lift about ${dose.setsPerLiftPerWeek.toFixed(1)} hard sets a week. Under ` +
        `${STRENGTH_DOSE_FULL_SETS_PER_LIFT_PER_WEEK} the strength projection is scaled to ${pct(doseS)}; another gym ` +
        `day, or fewer running sessions, is what would raise it.`
    );
  }

  let strengthReachable: boolean | null = null;
  let strengthShortfallKg: number | null = null;
  if (goal.targetTotalKg != null) {
    if (basis.missingLifts.length > 0) {
      const missing = basis.missingLifts.join(" or ");
      messages.push(
        `Total: ${goal.targetTotalKg}kg — no projection yet, because you have a target for your ${missing} ` +
          `but nothing logged for it. Log one working set and this becomes a real forecast; until then the plan ` +
          `programmes that lift by effort rather than by percentage.`
      );
    } else {
      strengthReachable = strength.expected >= goal.targetTotalKg;
      strengthShortfallKg = goal.targetTotalKg - strength.expected;
      const band = `${strength.interval80[0].toFixed(0)}-${strength.interval80[1].toFixed(0)}kg`;
      const prob = strength.probability != null ? pct(strength.probability) : "—";
      if (goal.targetTotalKg <= basis.currentKg) {
        messages.push(
          `Total: ${goal.targetTotalKg}kg is at or under what you already lift (${basis.currentKg.toFixed(0)}kg). ` +
            `${goal.weeksOut} weeks projects about ${strength.expected.toFixed(0)}kg (80% range ${band}) — worth ` +
            `setting a target that asks something of the block.`
        );
      } else if (strength.level === "within-reach") {
        messages.push(
          `Total: ${goal.targetTotalKg}kg is within reach — ${goal.weeksOut} weeks projects about ` +
            `${strength.expected.toFixed(0)}kg (80% range ${band}), a ${prob} chance of the target itself once the ` +
            `odds of finishing the block are included.`
        );
      } else if (strength.level === "stretch") {
        messages.push(
          `Total: ${goal.targetTotalKg}kg is a stretch. ${goal.weeksOut} weeks projects about ` +
            `${strength.expected.toFixed(0)}kg (80% range ${band}) — roughly a ${prob} chance of the full target. ` +
            `The block is written toward ${strength.expected.toFixed(0)}kg as the primary goal and keeps ` +
            `${goal.targetTotalKg}kg as the stretch; progress is measured against the primary.`
        );
      } else if (strength.level === "multi-block") {
        messages.push(
          `Total: ${goal.targetTotalKg}kg is a multi-block goal at your training age — ${goal.weeksOut} weeks ` +
            `projects about ${strength.expected.toFixed(0)}kg (80% range ${band}), and the model puts the target ` +
            `nearer ${strength.weeksNeeded ?? "?"} weeks out. This block is built toward ` +
            `${strength.expected.toFixed(0)}kg as its milestone. Compressing the gap into faster weekly loading ` +
            `is how lifters get hurt, not how they get there sooner.`
        );
      }
      if (strength.belowNoiseFloor) {
        messages.push(
          `A gain this size is close to the day-to-day swing in a 1RM (about ` +
            `${Math.round(ONE_RM_TEST_NOISE_FRACTION * 100)}%), so judge it on the trend of your logged working ` +
            `sets across the block rather than on one test day.`
        );
      }
    }
  }

  let enduranceReachable: boolean | null = null;
  let enduranceShortfallS: number | null = null;
  if (goal.target5kS != null) {
    enduranceReachable = endurance.expected <= goal.target5kS;
    enduranceShortfallS = endurance.expected - goal.target5kS;
    const band = `${fmtTime(endurance.interval80[0])}-${fmtTime(endurance.interval80[1])}`;
    const prob = endurance.probability != null ? pct(endurance.probability) : "—";
    const from = `from ${fmtTime(state.predicted5kS)} today`;
    if (goal.target5kS >= state.predicted5kS) {
      messages.push(
        `5k: ${fmtTime(goal.target5kS)} is already inside your current fitness (${fmtTime(state.predicted5kS)}). ` +
          `${goal.weeksOut} weeks projects about ${fmtTime(endurance.expected)} (80% range ${band}) — worth setting ` +
          `a target that asks something of the block.`
      );
    } else if (endurance.level === "within-reach") {
      messages.push(
        `5k: ${fmtTime(goal.target5kS)} is within reach — ${goal.weeksOut} weeks projects about ` +
          `${fmtTime(endurance.expected)} (80% range ${band}) ${from}, a ${prob} chance of the target itself once ` +
          `the odds of finishing the block are included. Running does not improve in a straight line, so this is ` +
          `a range worth training for rather than a guarantee.`
      );
    } else if (endurance.level === "stretch") {
      messages.push(
        `5k: ${fmtTime(goal.target5kS)} is a stretch. ${goal.weeksOut} weeks projects about ` +
          `${fmtTime(endurance.expected)} (80% range ${band}) ${from} — roughly a ${prob} chance of the full ` +
          `target. The block is written toward ${fmtTime(endurance.expected)} as the primary goal and keeps ` +
          `${fmtTime(goal.target5kS)} as the stretch; the hard sessions are paced off what your fitness supports, ` +
          `not off the stretch time.`
      );
    } else if (endurance.level === "multi-block") {
      messages.push(
        `5k: ${fmtTime(goal.target5kS)} is a multi-block goal from ${fmtTime(state.predicted5kS)} — ` +
          `${goal.weeksOut} weeks projects about ${fmtTime(endurance.expected)} (80% range ${band}), and the model ` +
          `puts the target nearer ${endurance.weeksNeeded ?? "?"} weeks out. This block is built toward ` +
          `${fmtTime(endurance.expected)} as its milestone, and every quality session is paced to that rather than ` +
          `to a time your current fitness cannot hold.`
      );
    }
    if (endurance.belowNoiseFloor) {
      messages.push(
        `A gain this size is close to the repeatability of a time trial (about ` +
          `${Math.round(RUN_TEST_NOISE_FRACTION * 100)}%), so one race day may not show all of it — the trend in ` +
          `your logged paces at a fixed heart rate will.`
      );
    }
  } else if (goal.enduranceEventKm != null && projectedEventS != null && projectedEventRangeS != null) {
    messages.push(
      `${goal.enduranceEventKey}: this block projects about ${fmtTime(projectedEventS)} (80% range ` +
        `${fmtTime(projectedEventRangeS[0])}-${fmtTime(projectedEventRangeS[1])}), from a current 5k of ` +
        `${fmtTime(state.predicted5kS)}. No target time was set, so nothing here is graded against one.`
    );
  }
  if (goal.target5kS != null && goal.enduranceEventKm != null && goal.enduranceEventKm > 5.5 && projectedEventS != null) {
    messages.push(
      `Over ${goal.enduranceEventKey} that 5k fitness projects to about ${fmtTime(projectedEventS)} — using a ` +
        `fatigue exponent conditioned on your weekly volume, because the textbook 1.06 under-predicts the marathon ` +
        `for half of recreational runners.`
    );
  }

  let jointProbability: number | null = null;
  if (endurance.probability != null && strength.probability != null) {
    jointProbability = clamp01(endurance.probability * strength.probability * JOINT_GOAL_CORRELATION);
    if (endurance.level !== "within-reach" || strength.level !== "within-reach") {
      messages.push(
        `Both targets together: about a ${pct(jointProbability)} chance. Choosing one as the priority, or a ` +
          `longer horizon, moves the primary target's odds far more than any change to the sessions can.`
      );
    }
  }

  // What the athlete's own history did to the projection. Said plainly,
  // because a number that moves without explanation is indistinguishable
  // from a number that is broken.
  if (observed) {
    const weeks = Math.round(observed.weeksObserved);
    const share = `${Math.round(observed.weight * 100)}%`;
    const moved = (before: number, after: number) => Math.abs(after - before) / Math.max(before, 1e-6) > 0.05;
    const parts: string[] = [];
    if (observed.endurancePerBlock != null && moved(priorMuE, muE)) {
      parts.push(
        `your 5k has been moving ${muE > priorMuE ? "faster" : "slower"} than the population rate for your training age`
      );
    } else if (observed.withinNoise.endurance) {
      parts.push(`your 5k has moved less than a time trial's own repeatability, so nothing is read into it yet`);
    }
    if (observed.strengthPerBlock != null && moved(priorMuS, muS)) {
      parts.push(`your lifts have been moving ${muS > priorMuS ? "faster" : "slower"} than that rate`);
    }
    if (parts.length > 0) {
      messages.push(
        `Measured on you, not on the population: across ${weeks} weeks of your own logged history, ${parts.join(" and ")}. ` +
          `That observation carries ${share} of the weight in the projection above and the population rate carries the ` +
          `rest — four weeks of anyone's data is mostly noise, so it moves the number without taking it over.`
      );
    }
  } else {
    messages.push(
      `The first four weeks are a dose check — the projection is recomputed from your logged sessions as the block ` +
        `goes on, and the remaining weeks are rebuilt if it moves.`
    );
  }

  return {
    blocks,
    projectedTotalKg: strength.expected,
    projected5kS: endurance.expected,
    projected5kRangeS: endurance.interval80,
    projectedTotalRangeKg: strength.interval80,
    strengthGainPct: strength.gainFraction * 100,
    enduranceGainPct: endurance.gainFraction * 100,
    strengthReachable,
    strengthShortfallKg,
    enduranceReachable,
    enduranceShortfallS,
    endurance,
    strength,
    jointProbability,
    adherence,
    projectedEventS,
    projectedEventRangeS,
    strengthTrainingAgeUsed: strengthAge,
    enduranceTrainingAgeUsed: enduranceAge,
    observedResponse: observed ?? null,
    messages,
    doseWarnings,
  };
}

// ---------------------------------------------------------------------------
// Develop / maintain (Stage B)
// ---------------------------------------------------------------------------

export type DomainMode = "develop" | "maintain";

/**
 * A domain with no target, or a target already within reach of a fraction of
 * the available headroom, goes to `maintain` — which is not "ignore": the
 * minimum maintenance dose (Spiering 2021 for strength) still applies and is
 * reserved before anything else is allocated.
 */
export function classifyDomains(
  state: AthleteState,
  goal: Goal,
  /** Set when the athlete chose a gym split — an intent signal in its own right. */
  splitImpliesTraining = false
): Record<"strength" | "endurance", DomainMode> {
  const out: Record<"strength" | "endurance", DomainMode> = { strength: "maintain", endurance: "maintain" };

  // Per-lift targets count as a strength goal.
  const perLift = [goal.targetSquatKg, goal.targetBenchKg, goal.targetDeadliftKg].filter(
    (v): v is number => v != null && v > 0
  );
  const strengthTarget = goal.targetTotalKg ?? (perLift.length > 0 ? perLift.reduce((a, b) => a + b, 0) : null);

  // Choosing a gym split is itself a statement of intent to train.
  if (strengthTarget == null && splitImpliesTraining) {
    out.strength = "develop";
  }

  if (strengthTarget != null) {
    const comparable = Math.max(strengthComparisonBasis(state, goal).currentKg, 1);
    const gap = (strengthTarget - comparable) / comparable;
    const headroom =
      STRENGTH_GAIN_PER_BLOCK[inferredStrengthTrainingAge(state.strengthTrainingAge, state)] * (goal.weeksOut / 12);
    out.strength = gap > DEVELOP_GAP_THRESHOLD * headroom ? "develop" : "maintain";
  }

  // Entering a race is a develop goal, with or without a target time.
  if (goal.enduranceEventKm != null) {
    out.endurance = "develop";
  }

  if (goal.target5kS != null) {
    const gap = (state.predicted5kS - goal.target5kS) / Math.max(state.predicted5kS, 1);
    const headroom =
      ENDURANCE_GAIN_PER_BLOCK[inferredEnduranceTrainingAge(state.enduranceTrainingAge, state.predicted5kS)] *
      (goal.weeksOut / 12);
    // A named time can only ever RAISE the ambition.
    if (gap > DEVELOP_GAP_THRESHOLD * headroom) out.endurance = "develop";
  }

  return out;
}
