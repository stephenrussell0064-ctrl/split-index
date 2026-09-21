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
 */

import {
  ALLOMETRIC_EXPONENT,
  CONCURRENT_ATTENUATION_ENDURANCE,
  CONCURRENT_ATTENUATION_STRENGTH,
  CONCURRENT_ATTENUATION_LOWER_BODY_MALE,
  CONCURRENT_ATTENUATION_RUN_MIN_THRESHOLD,
  STRENGTH_GAIN_SD_PER_BLOCK,
  ENDURANCE_GAIN_SD_PER_BLOCK,
  STRENGTH_TRAINING_AGE_FLOOR_BY_RELATIVE_TOTAL,
  FEMALE_RELATIVE_TOTAL_FACTOR,
  RUN_TEST_NOISE_FRACTION,
  ONE_RM_TEST_NOISE_FRACTION,
  ADHERENCE_BASE,
  ADHERENCE_PRIOR_INJURY_MULTIPLIER,
  ADHERENCE_NOVICE_ENDURANCE_MULTIPLIER,
  PARTIAL_COMPLETION_GAIN_SHARE,
  JOINT_GOAL_CORRELATION,
  STRETCH_GOAL_SD,
  MULTI_BLOCK_GOAL_SD,
  AGE_GAIN_PENALTY_START,
  AGE_GAIN_PENALTY_PER_DECADE,
  DEVELOP_GAP_THRESHOLD,
  ENDURANCE_GAIN_PER_BLOCK,
  ENDURANCE_TRAINING_AGE_FLOOR_BY_5K,
  MAX_ENDURANCE_GAIN_PER_BLOCK,
  CAUTIOUS_GAIN_SHARE,
  MAX_GAIN_MULTIPLE_OF_RATE,
  MAX_STRENGTH_GAIN_PER_BLOCK,
  FRONTIER_MAX_DELTA_FRACTION,
  MAX_SAFE_LOSS_RATE_PCT_PER_WEEK,
  MIN_HEALTHY_BMI,
  PACE_COST_S_PER_KM_PER_KG,
  PRIORITY_SHARE_SKEW,
  RUNNING_ECONOMY_BONUS_PER_BLOCK,
  STRENGTH_GAIN_PER_BLOCK,
  type TrainingAge,
} from "./constants";
import { totalKg, type AthleteState, type Goal } from "./intake";
import { buildMacrocycle } from "./macrocycle";
import { requiredWeeklyMinutesFor5k } from "./diagnostics";

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

export interface FeasibilityResult {
  blocks: number;
  projectedTotalKg: number;
  projected5kS: number;
  /** [today, modelled best] — progress is not linear, so the athlete is shown a band, never a point. */
  projected5kRangeS: [number, number];
  projectedTotalRangeKg: [number, number];
  strengthGainPct: number;
  enduranceGainPct: number;
  strengthReachable: boolean | null;
  strengthShortfallKg: number | null;
  enduranceReachable: boolean | null;
  enduranceShortfallS: number | null;
  /**
   * The probabilistic view of each side: an expected outcome, an 80%
   * interval, the probability of the stated target once the odds of
   * finishing are included, and how ambitious that target is.
   *
   * Added alongside the point fields above rather than replacing them, so
   * everything that reads this result keeps working while the screen moves
   * to the richer numbers.
   */
  endurance: GoalComponentOutcome;
  strength: GoalComponentOutcome;
  /** Probability of hitting BOTH stated targets. Null when fewer than two are set. */
  jointProbability: number | null;
  /** The modelled chance the athlete completes the block as written. */
  adherence: number;
  /** The training ages the model used, after the performance floors. */
  strengthTrainingAgeUsed: TrainingAge;
  enduranceTrainingAgeUsed: TrainingAge;
  /** Plain-English summary for the athlete — this is the honest conversation about the target, delivered up front rather than at the finish line. */
  messages: string[];
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
 *    deadlift, which reads as a collapse; `classify` below already guarded
 *    against this for the develop/maintain decision, but the projection and the
 *    athlete-facing message never got the same treatment.
 *
 * 2. A MISSING 1RM COUNTED AS ZERO. A lift the athlete has a target for but has
 *    never logged contributed 0 to "current", so the shortfall came out as very
 *    nearly the whole target. Observed live: a 200kg squat + 135kg bench target
 *    against a logged bench of 132kg and no squat at all produced "Total: 335kg
 *    is ambitious... about 202kg short at best." The athlete is not 202kg short
 *    of anything. The engine does not know their squat, which is a different
 *    statement and the one worth making — the session prescription right beside
 *    it already says "no logged 1RM yet — work to the RIR".
 *
 * So: compare over exactly the lifts the target names, and report which named
 * lifts have no number rather than silently valuing them at nothing. A bare
 * `targetTotalKg` with no per-lift breakdown keeps the old all-three behaviour,
 * because there is no named subset to restrict to.
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
    // Bench is the exception the interference evidence is clearest about: it
    // is not affected by running volume, so it is not counted here.
    if (lift !== "bench") lowerKg += oneRm;
  }
  // Two thirds is the squat-plus-deadlift share of a typical total, and the
  // fallback for an athlete with nothing logged.
  return { currentKg, missingLifts, lowerBodyFraction: currentKg > 0 ? lowerKg / currentKg : 0.67 };
}

/**
 * Training age inferred from performance, floored against what the athlete
 * said. An 18:25 5k is not a beginner's time however long they say they have
 * been running, and novice gain rates applied to it produce a projection the
 * athlete will read as a promise.
 */
export function inferredEnduranceTrainingAge(stated: TrainingAge, predicted5kS: number): TrainingAge {
  const order: TrainingAge[] = ["novice", "intermediate", "advanced", "elite"];
  let floor: TrainingAge = "novice";
  for (const [seconds, age] of ENDURANCE_TRAINING_AGE_FLOOR_BY_5K) {
    if (predicted5kS <= seconds) {
      floor = age;
      break;
    }
  }
  return order.indexOf(floor) > order.indexOf(stated) ? floor : stated;
}


/** Standard normal CDF, Abramowitz & Stegun 7.1.26 — far more precision than this model claims. */
export function normalCdf(z: number): number {
  if (!Number.isFinite(z)) return z > 0 ? 1 : 0;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-x * x);
  return Math.min(1, Math.max(0, 0.5 * (1 + (z >= 0 ? erf : -erf))));
}

/** 80% interval half-width, in SDs. */
const Z_80 = 1.2816;

export type GoalLevel = "within-reach" | "stretch" | "multi-block";

export interface GoalComponentOutcome {
  /** The expected outcome of a completed block — a 5k time in seconds, or a total in kg. */
  expected: number;
  /** 80% interval around it. */
  interval80: [number, number];
  sd: number;
  /** Probability of reaching the stated target, the odds of finishing the block included. Null without a target. */
  probability: number | null;
  level: GoalLevel | null;
  /** The milestone to train toward when the target is a stretch or multi-block goal: the expected outcome. */
  primaryGoal: number | null;
  /** How many SDs past the expected outcome the stated target sits. Null without a target. */
  zRequired: number | null;
  /** True when the expected gain is inside the test's own repeatability. */
  belowNoiseFloor: boolean;
}

/**
 * Strength training age inferred from relative strength, as a floor under
 * what the athlete typed — the same rule `inferredEnduranceTrainingAge`
 * already applies to the 5k.
 *
 * An unanswered training-age question resolves to zero years, which is the
 * novice bucket and the biggest gain rate in the table. Somebody squatting
 * twice bodyweight who skipped the history section was being promised a
 * beginner's progress.
 */
export function inferredStrengthTrainingAge(
  stated: TrainingAge,
  state: Pick<AthleteState, "oneRms" | "bodyweightKg" | "sex">
): TrainingAge {
  const order: TrainingAge[] = ["novice", "intermediate", "advanced", "elite"];
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
  return order.indexOf(floor) > order.indexOf(stated) ? floor : stated;
}

/**
 * The chance the block gets completed as written. The probability quoted to
 * the athlete includes it, because finishing is part of the outcome they
 * face and the dropout literature is not kind: STRRIDE loses about 30%,
 * unsupervised novice running plans far more, and prior injury carries an
 * odds ratio of 7.6 (Relph 2023).
 */
export function adherencePrior(state: AthleteState, goal: Goal, enduranceAge: TrainingAge): number {
  let a = ADHERENCE_BASE;
  if (state.safety.injuryLast12Weeks || state.safety.currentInjuryLimiting) a *= ADHERENCE_PRIOR_INJURY_MULTIPLIER;
  if (enduranceAge === "novice" && (goal.enduranceEventKm != null || goal.target5kS != null)) {
    a *= ADHERENCE_NOVICE_ENDURANCE_MULTIPLIER;
  }
  return Math.min(1, Math.max(0, a));
}

function goalLevelFor(z: number | null): GoalLevel | null {
  if (z == null) return null;
  if (z <= STRETCH_GOAL_SD) return "within-reach";
  if (z <= MULTI_BLOCK_GOAL_SD) return "stretch";
  return "multi-block";
}

/**
 * Turns a point projection into an outcome with a spread, a probability and
 * a verdict on how ambitious the target is.
 */
function outcomeFor(args: {
  baseline: number;
  lowerIsBetter: boolean;
  target: number | null;
  gain: number;
  sd: number;
  noise: number;
  adherence: number;
}): GoalComponentOutcome {
  const { baseline, lowerIsBetter, target, gain, sd, noise, adherence } = args;
  const sign = lowerIsBetter ? -1 : 1;
  const expected = baseline * (1 + sign * gain);
  const spread = Math.sqrt((baseline * sd) ** 2 + (baseline * noise) ** 2);
  const interval80: [number, number] = [expected - Z_80 * spread, expected + Z_80 * spread];

  let probability: number | null = null;
  let zRequired: number | null = null;
  let level: GoalLevel | null = null;
  let primaryGoal: number | null = null;

  if (target != null && target > 0 && baseline > 0) {
    const required = lowerIsBetter ? (baseline - target) / baseline : (target - baseline) / baseline;
    zRequired = (required - gain) / Math.max(sd, 1e-6);
    level = required <= 0 ? "within-reach" : goalLevelFor(zRequired);
    const pComplete = lowerIsBetter
      ? normalCdf((target - expected) / spread)
      : normalCdf((expected - target) / spread);
    const partial = baseline * (1 + sign * gain * PARTIAL_COMPLETION_GAIN_SHARE);
    const pPartial = lowerIsBetter
      ? normalCdf((target - partial) / spread)
      : normalCdf((partial - target) / spread);
    probability = Math.min(1, Math.max(0, adherence * pComplete + (1 - adherence) * pPartial));
    if (level === "stretch" || level === "multi-block") primaryGoal = expected;
  }

  return {
    expected,
    interval80,
    sd: spread,
    probability,
    level,
    primaryGoal,
    zRequired,
    belowNoiseFloor: gain < 2 * noise,
  };
}

function fmtMMSS(sec: number): string {
  const t = Math.max(0, Math.round(sec));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = t % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(ss).padStart(2, "0")}`
    : `${m}:${String(ss).padStart(2, "0")}`;
}

export function feasibilityScreen(
  state: AthleteState,
  goal: Goal,
  /**
   * The same ramp multiplier the macrocycle will be built with — safety x
   * tailoring. Defaulted so existing callers and tests keep working, but the
   * engine passes the real one: without it this function builds the block at
   * full ramp and quotes a peak the athlete's actual plan never reaches.
   */
  rampMultiplier = 1
): FeasibilityResult {
  const blocks = goal.weeksOut / 12.0;
  const strengthAge = inferredStrengthTrainingAge(state.strengthTrainingAge, state);
  const strengthRate = STRENGTH_GAIN_PER_BLOCK[strengthAge];
  const enduranceAgeUsed = inferredEnduranceTrainingAge(state.enduranceTrainingAge, state.predicted5kS);
  const enduranceRate = ENDURANCE_GAIN_PER_BLOCK[enduranceAgeUsed];

  // The priority slider splits the available adaptation between domains.
  const strengthShare = 0.5 + 0.5 * (goal.priority - 0.5) * 2 * PRIORITY_SHARE_SKEW;
  const enduranceShare = 1.0 - strengthShare;

  // Focus SCALES the published rate down; it never scales it up.
  //
  // This was `2 * share`, which doubled the rate for a single-sport athlete.
  // The published rates already describe someone training that discipline
  // properly — an advanced runner's 1.5% per block is 1.5% for a runner who
  // runs, not for a runner who also does nothing else. Doubling it for focus
  // counted the same focus twice, and that factor of two is most of how an
  // 18:25 became a 16:22.
  /*
   * Interference, applied where the meta-analyses actually find it.
   *
   * The flat CONCURRENT_ATTENUATION_STRENGTH is Wilson 2012, whose sample was
   * largely untrained and whose 18% is a ratio of within-group effect sizes.
   * Schumann 2022 puts the pooled effect on maximal strength at SMD -0.06 —
   * indistinguishable from zero. What replicates is narrower: Petre 2021 finds
   * ES -0.35 in trained lifters, and Huiberts 2024 finds SMD -0.43 in men
   * against +0.08 in women, with upper body unaffected throughout.
   *
   * So the penalty lands on the lower-body share of the target, for men, once
   * running is a real weekly load — and nowhere else.
   */
  const lowerBodyShare = strengthComparisonBasis(state, goal).lowerBodyFraction;
  const interference =
    state.sex === "male" && state.currentRunMinPerWeek >= CONCURRENT_ATTENUATION_RUN_MIN_THRESHOLD
      ? CONCURRENT_ATTENUATION_LOWER_BODY_MALE * lowerBodyShare
      : 0;
  const strengthGain = strengthRate * blocks * strengthShare * (1 - interference);
  let enduranceGain = enduranceRate * blocks * enduranceShare * (1 - CONCURRENT_ATTENUATION_ENDURANCE);
  // Strength work improves running economy independently of aerobic gain —
  // the one place concurrent training pays rather than costs.
  enduranceGain += RUNNING_ECONOMY_BONUS_PER_BLOCK * blocks;

  const strengthBasis = strengthComparisonBasis(state, goal);
  const currentTotal = strengthBasis.currentKg;
  // Two caps, and the tighter one wins. The absolute cap is a backstop for the
  // novice rates, which are legitimately large. The relative cap holds a
  // trained athlete near their own rate, which is the case that went wrong.
  const cappedStrengthGain = Math.min(
    strengthGain,
    MAX_STRENGTH_GAIN_PER_BLOCK * blocks,
    strengthRate * blocks * MAX_GAIN_MULTIPLE_OF_RATE
  );
  /*
   * The projection has to know how much running the plan actually prescribes.
   *
   * Everything above derives the endurance gain from training age, block
   * length and the priority split, and nothing else — volume never entered it.
   * So an athlete whose block tops out at two runs a week was told their 18:00
   * target was "reachable", by the same plan that could not deliver it. The
   * number was not wrong about their potential; it was answering a question
   * nobody asked, and it was printed as a forecast.
   *
   * The block's ceiling is knowable here without building it: every week is a
   * multiple of the on-ramp anchor and none exceeds `anchor *
   * ONRAMP_MAX_MULTIPLE`. Measured against the volume the TARGET time is
   * historically built on — the same lookup the diagnostic uses to tell an
   * athlete whether volume is their limiting factor — that gives an honest
   * attenuation.
   *
   * Capped at 1, so it can only hold a projection back, never inflate one, and
   * applied only where there is a 5k target to measure against.
   */
  /*
   * The peak the block ACTUALLY reaches, from the block itself.
   *
   * The first version of this multiplied the on-ramp anchor by
   * ONRAMP_MAX_MULTIPLE. That is the ceiling the ramp is not allowed to pass,
   * not the volume it gets to: at MAX_WEEKLY_VOLUME_RAMP, twelve weeks with
   * deloads does not come close to 2.6x. For the reported athlete it claimed
   * the block built to 163 min/week when the plan prescribed 73 — the
   * attenuation was too generous, and worse, the message quoted the wrong
   * figure back to them.
   *
   * `buildMacrocycle` is pure, so asking it is cheaper than restating its ramp
   * here and cannot drift from it. The engine passes the same ramp multiplier
   * it will build the real block with, so the peak quoted to the athlete is
   * the peak they are actually prescribed.
   */
  const peakWeeklyEnduranceMin = Math.max(
    0,
    ...buildMacrocycle(state, goal, rampMultiplier).map((w) => w.enduranceMin)
  );
  const volumeSupport =
    goal.target5kS != null
      ? Math.min(1, peakWeeklyEnduranceMin / Math.max(requiredWeeklyMinutesFor5k(goal.target5kS), 1))
      : 1;
  enduranceGain *= volumeSupport;

  const cappedEnduranceGain = Math.min(
    enduranceGain,
    MAX_ENDURANCE_GAIN_PER_BLOCK * blocks,
    enduranceRate * blocks * MAX_GAIN_MULTIPLE_OF_RATE
  );

  const projectedTotalKg = currentTotal * (1 + cappedStrengthGain);
  const projected5kS = state.predicted5kS * (1 - cappedEnduranceGain);

  /*
   * THE SPREAD, AND WHAT IT MEANS FOR THE TARGET.
   *
   * Everything above produces a point. Two athletes of the same training age
   * on the same plan do not get the same result, and the spread the cohorts
   * report is wide — Ahtiainen 2016 found 21 +/- 11.5% on strength, HERITAGE
   * found VO2max responses from about -2% to over +40% on one identical
   * programme. Quoting the mean as a forecast is what made this engine's
   * projections read as promises.
   *
   * So each side also comes back as a distribution: an expected outcome, an
   * 80% interval, and the probability of the target once the chance of
   * finishing the block is folded in. The verdict on the target follows from
   * where it sits in that distribution rather than from whether it happens to
   * fall on the right side of a point estimate.
   */
  const enduranceSd = ENDURANCE_GAIN_SD_PER_BLOCK[enduranceAgeUsed] * blocks;
  const strengthSd = STRENGTH_GAIN_SD_PER_BLOCK[strengthAge] * blocks;
  const adherence = adherencePrior(state, goal, enduranceAgeUsed);
  const enduranceOutcome = outcomeFor({
    baseline: state.predicted5kS,
    lowerIsBetter: true,
    target: goal.target5kS,
    gain: cappedEnduranceGain,
    sd: enduranceSd,
    noise: RUN_TEST_NOISE_FRACTION,
    adherence,
  });
  const strengthOutcome = outcomeFor({
    baseline: currentTotal,
    lowerIsBetter: false,
    target: strengthBasis.missingLifts.length > 0 ? null : goal.targetTotalKg,
    gain: cappedStrengthGain,
    sd: strengthSd,
    noise: ONE_RM_TEST_NOISE_FRACTION,
    adherence,
  });
  const jointProbability =
    enduranceOutcome.probability != null && strengthOutcome.probability != null
      ? enduranceOutcome.probability * strengthOutcome.probability * JOINT_GOAL_CORRELATION
      : null;

  // The projection is a RANGE, and all of it is faster than today.
  //
  // The slow end used to be the athlete's current time, which made the bottom
  // of every band "this block may do nothing". That was an overcorrection from
  // the opposite error — a single optimistic number, read as a promise — and
  // it is wrong in its own way: quoting someone's own PB back at them as a
  // possible outcome of sixteen weeks of work is dispiriting, and it is not
  // what the evidence says either. A block that gets completed makes people
  // faster; how much is the uncertain part, not whether.
  //
  // So the band runs from a cautious share of the modelled gain to the full
  // modelled gain, and the fact that progress is not linear is said in words
  // underneath. That is the honest place for it. A plateau is a real
  // possibility and it deserves a sentence, not a silent widening of the
  // arithmetic until the range stops claiming anything.
  const cautious5kS = state.predicted5kS * (1 - cappedEnduranceGain * CAUTIOUS_GAIN_SHARE);
  const projected5kRangeS: [number, number] = [projected5kS, cautious5kS];
  const projectedTotalRangeKg: [number, number] = [
    currentTotal * (1 + cappedStrengthGain * CAUTIOUS_GAIN_SHARE),
    projectedTotalKg,
  ];

  const messages: string[] = [];
  let strengthReachable: boolean | null = null;
  let strengthShortfallKg: number | null = null;
  if (goal.targetTotalKg != null) {
    if (strengthBasis.missingLifts.length > 0) {
      // Reachability is genuinely unknown, so it stays null rather than being
      // reported as false: "we cannot tell yet" and "you will miss it" are
      // different answers and the athlete deserves the one that is true. The
      // shortfall is left null for the same reason — there is no honest number
      // to put in it while a named lift has never been logged.
      const missing = strengthBasis.missingLifts.join(" or ");
      messages.push(
        `Total: ${goal.targetTotalKg}kg — no projection yet, because you have a target for your ${missing} ` +
          `but nothing logged for it. Log one working set and this becomes a real forecast; until then the plan ` +
          `programmes that lift by effort rather than by percentage.`
      );
    } else {
      strengthReachable = projectedTotalKg >= goal.targetTotalKg;
      strengthShortfallKg = goal.targetTotalKg - projectedTotalKg;
      const band = `${projectedTotalRangeKg[0].toFixed(0)}-${projectedTotalRangeKg[1].toFixed(0)}kg`;
      messages.push(
        strengthReachable
          ? `Total: ${goal.targetTotalKg}kg is reachable — ${goal.weeksOut} weeks puts you in the ${band} range, ` +
            `with the top end assuming the block goes well.`
          : `Total: ${goal.targetTotalKg}kg is ambitious. ${goal.weeksOut} weeks at your training age puts you in ` +
            `the ${band} range — about ${strengthShortfallKg.toFixed(0)}kg short at best. The plan still chases ` +
            `it; treat the top of the range as a stretch rather than a forecast.`
      );
    }
  }

  let enduranceReachable: boolean | null = null;
  let enduranceShortfallS: number | null = null;
  if (goal.target5kS != null) {
    enduranceReachable = projected5kS <= goal.target5kS;
    enduranceShortfallS = projected5kS - goal.target5kS;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    // Quoted as a band, and the band is stated as a band. Endurance form
    // moves in steps and setbacks, not down a line, and an athlete who runs
    // 18:20 off a well-executed block has not failed at anything — but a plan
    // that promised them one number has told them they did.
    // Best first, then the cautious end — both faster than where they are now.
    const band = `${fmt(projected5kRangeS[0])}-${fmt(projected5kRangeS[1])}`;
    messages.push(
      enduranceReachable
        ? `5k: ${fmt(goal.target5kS)} is reachable — ${goal.weeksOut} weeks of this block projects ${band}, from ` +
          `${fmt(state.predicted5kS)} today. The fast end assumes the block goes well. Running does not improve in ` +
          `a straight line and a flat block happens to everyone, so treat this as the range worth training for ` +
          `rather than a guarantee.`
        : `5k: ${fmt(goal.target5kS)} is ambitious. ${goal.weeksOut} weeks of this block projects ${band}, from ` +
          `${fmt(state.predicted5kS)} today — about ${Math.round(enduranceShortfallS)}s short of the target at ` +
          `best. Running does not improve in a straight line and a flat block happens to everyone, so this is a ` +
          `range rather than a promise. Worth knowing now rather than at the finish line.`
    );

    /*
     * When VOLUME is what is holding the projection back, say so.
     *
     * "Ambitious" on its own reads as a verdict on the athlete. It is not:
     * the attenuation above may be entirely down to how little running the
     * block contains, and the block contains that little because of one
     * number the athlete typed — or did not type — on the intake. Told only
     * that their target is out of reach, they have no way to know that the
     * fix is a field on a form rather than a different body.
     *
     * Only raised when volume is actually binding. An athlete whose block
     * already carries the volume their target is built on gets the message
     * above and nothing else, because for them the shortfall is real.
     */
    if (!enduranceReachable && volumeSupport < 1) {
      const requiredMin = requiredWeeklyMinutesFor5k(goal.target5kS);
      messages.push(
        `That projection is limited by how much running this block contains, not only by the time you have. ` +
          `It builds to about ${Math.round(peakWeeklyEnduranceMin)} min/week, and an ${fmt(goal.target5kS)} 5k is ` +
          `usually built on nearer ${requiredMin}. The block starts from the weekly running minutes you gave on ` +
          `the intake — if that number is lower than what you actually run, correct it there (and say so if some ` +
          `of your training is not recorded here), and the plan rebuilds around the real figure.`
      );
    }
  }

  /*
   * The odds, said out loud.
   *
   * The messages above report whether a point estimate clears the target.
   * That framing has no room for "probably not, but it is worth training
   * for", which is the honest description of most ambitious goals. These add
   * the probability and, where the target sits more than a standard
   * deviation past what the block is expected to deliver, name it as a
   * stretch and give the athlete a primary goal they can actually measure
   * progress against.
   *
   * Bar-Eli 1997 found difficult-but-realistic goals beat improbable ones,
   * and Locke & Latham find commitment collapses when a goal reads as a
   * threat. A stretch goal is kept; it is just no longer the only number on
   * the page.
   */
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  if (enduranceOutcome.probability != null && goal.target5kS != null) {
    const band = `${fmtMMSS(enduranceOutcome.interval80[0])}-${fmtMMSS(enduranceOutcome.interval80[1])}`;
    if (enduranceOutcome.level === "within-reach") {
      messages.push(
        `Odds on the 5k: about ${pct(enduranceOutcome.probability)}, counting the chance the block gets finished. ` +
          `The 80% range is ${band}.`
      );
    } else {
      messages.push(
        `Odds on the 5k: about ${pct(enduranceOutcome.probability)}. ${fmtMMSS(goal.target5kS)} is ` +
          `${enduranceOutcome.level === "multi-block" ? "a multi-block goal" : "a stretch"} from where you are, so ` +
          `the block is written toward ${fmtMMSS(enduranceOutcome.expected)} (80% range ${band}) and keeps your ` +
          `time as the stretch. Progress is worth judging against the first number.`
      );
    }
  }
  if (strengthOutcome.probability != null && goal.targetTotalKg != null) {
    const band = `${strengthOutcome.interval80[0].toFixed(0)}-${strengthOutcome.interval80[1].toFixed(0)}kg`;
    if (strengthOutcome.level === "within-reach") {
      messages.push(
        `Odds on the total: about ${pct(strengthOutcome.probability)}, counting the chance the block gets ` +
          `finished. The 80% range is ${band}.`
      );
    } else {
      messages.push(
        `Odds on the total: about ${pct(strengthOutcome.probability)}. ${goal.targetTotalKg}kg is ` +
          `${strengthOutcome.level === "multi-block" ? "a multi-block goal" : "a stretch"} at your training age, so ` +
          `the block is written toward ${strengthOutcome.expected.toFixed(0)}kg (80% range ${band}).`
      );
    }
  }
  if (jointProbability != null && (enduranceOutcome.level !== "within-reach" || strengthOutcome.level !== "within-reach")) {
    messages.push(
      `Both together: about ${pct(jointProbability)}. Picking one as the priority, or giving the block longer, ` +
        `moves that far more than any change to the sessions can.`
    );
  }

  return {
    blocks,
    projectedTotalKg,
    projected5kS,
    projected5kRangeS,
    projectedTotalRangeKg,
    strengthGainPct: cappedStrengthGain * 100,
    enduranceGainPct: cappedEnduranceGain * 100,
    strengthReachable,
    strengthShortfallKg,
    enduranceReachable,
    enduranceShortfallS,
    endurance: enduranceOutcome,
    strength: strengthOutcome,
    jointProbability,
    adherence,
    strengthTrainingAgeUsed: strengthAge,
    enduranceTrainingAgeUsed: enduranceAgeUsed,
    messages,
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

  // Per-lift targets count as a strength goal. Reading only `targetTotalKg`
  // classified a powerlifter with explicit squat/bench/deadlift targets as
  // "maintain" — and maintain mode prescribes two generic maintenance
  // sessions, so the athlete whose entire goal is the barbell received no
  // barbell work at all. Found by the five-persona simulation.
  const perLift = [goal.targetSquatKg, goal.targetBenchKg, goal.targetDeadliftKg].filter(
    (v): v is number => v != null && v > 0
  );
  const strengthTarget = goal.targetTotalKg ?? (perLift.length > 0 ? perLift.reduce((a, b) => a + b, 0) : null);

  // Choosing a gym split is itself a statement of intent to train.
  //
  // "No numeric 1RM target" was being read as "maintain", and maintain is the
  // Spiering minimum dose — one session, 2 reps at 80%, no accessories, split
  // ignored. That is the right prescription for holding strength through a
  // marathon build and the wrong one for someone who just told us how they
  // want their gym week organised. Most people lifting have no goal total;
  // they want to get bigger and stronger, which is a develop goal without a
  // number attached.
  if (strengthTarget == null && splitImpliesTraining) {
    out.strength = "develop";
  }

  if (strengthTarget != null) {
    // A partial target compares against the same lifts only, or a single bench
    // goal would read as a collapse in the total. This used to duplicate that
    // rule inline AND skip it whenever targetTotalKg was set — which
    // deriveTargetTotal now sets from the per-lift answers, so the guard was
    // being bypassed in exactly the case it was written for. One shared basis
    // with the projection above, so the classification and the message the
    // athlete reads cannot disagree about which lifts are being compared.
    const comparable = Math.max(strengthComparisonBasis(state, goal).currentKg, 1);
    // A named lift with no logged 1RM leaves the gap wide, and that is the
    // right way for it to err: an athlete targeting a lift they have never
    // logged needs it programmed, not maintained.
    const gap = (strengthTarget - comparable) / comparable;
    const headroom = STRENGTH_GAIN_PER_BLOCK[state.strengthTrainingAge] * (goal.weeksOut / 12);
    out.strength = gap > DEVELOP_GAP_THRESHOLD * headroom ? "develop" : "maintain";
  }

  // Entering a race is a develop goal, with or without a target time.
  //
  // This read `target5kS` and nothing else, so an athlete training for a half
  // marathon who had not named a time was classified as MAINTAINING endurance
  // — and maintain mode never reaches the quality floor, which is why their
  // plan was long runs and easy runs for sixteen weeks with no speed work in
  // it anywhere. Most people entering a race want to finish it well and have
  // no goal time in mind; that is a develop goal without a number attached,
  // exactly as a gym split is.
  if (goal.enduranceEventKm != null) {
    out.endurance = "develop";
  }

  if (goal.target5kS != null) {
    const gap = (state.predicted5kS - goal.target5kS) / Math.max(state.predicted5kS, 1);
    const headroom = ENDURANCE_GAIN_PER_BLOCK[inferredEnduranceTrainingAge(state.enduranceTrainingAge, state.predicted5kS)] * (goal.weeksOut / 12);
    // A named time can only ever RAISE the ambition. Someone who enters a
    // marathon and names a soft time is still training for a marathon.
    if (gap > DEVELOP_GAP_THRESHOLD * headroom) out.endurance = "develop";
  }

  return out;
}
