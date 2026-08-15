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
  DEVELOP_GAP_THRESHOLD,
  ENDURANCE_GAIN_PER_BLOCK,
  ENDURANCE_TRAINING_AGE_FLOOR_BY_5K,
  MAX_ENDURANCE_GAIN_PER_BLOCK,
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
  strengthGainPct: number;
  enduranceGainPct: number;
  strengthReachable: boolean | null;
  strengthShortfallKg: number | null;
  enduranceReachable: boolean | null;
  enduranceShortfallS: number | null;
  /** Plain-English summary for the athlete — this is the honest conversation about the target, delivered up front rather than at the finish line. */
  messages: string[];
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

export function feasibilityScreen(state: AthleteState, goal: Goal): FeasibilityResult {
  const blocks = goal.weeksOut / 12.0;
  const strengthRate = STRENGTH_GAIN_PER_BLOCK[state.strengthTrainingAge];
  const enduranceRate = ENDURANCE_GAIN_PER_BLOCK[inferredEnduranceTrainingAge(state.enduranceTrainingAge, state.predicted5kS)];

  // The priority slider splits the available adaptation between domains.
  const strengthShare = 0.5 + 0.5 * (goal.priority - 0.5) * 2 * PRIORITY_SHARE_SKEW;
  const enduranceShare = 1.0 - strengthShare;

  const strengthGain = strengthRate * blocks * (2 * strengthShare) * (1 - CONCURRENT_ATTENUATION_STRENGTH);
  let enduranceGain = enduranceRate * blocks * (2 * enduranceShare) * (1 - CONCURRENT_ATTENUATION_ENDURANCE);
  // Strength work improves running economy independently of aerobic gain —
  // the one place concurrent training pays rather than costs.
  enduranceGain += RUNNING_ECONOMY_BONUS_PER_BLOCK * blocks;

  const currentTotal = totalKg(state);
  // Capped. The multiplier chain — training-age rate, block count, and a
  // priority share that reaches 1.6x — compounds to 10.7% over eleven weeks
  // for an athlete tagged novice with endurance-only goals. That projected an
  // 18:25 5k to 16:26, which is not a forecast, and the athlete reads it as a
  // promise the plan has made them.
  const cappedStrengthGain = Math.min(strengthGain, MAX_STRENGTH_GAIN_PER_BLOCK * blocks);
  const cappedEnduranceGain = Math.min(enduranceGain, MAX_ENDURANCE_GAIN_PER_BLOCK * blocks);

  const projectedTotalKg = currentTotal * (1 + cappedStrengthGain);
  const projected5kS = state.predicted5kS * (1 - cappedEnduranceGain);

  const messages: string[] = [];
  let strengthReachable: boolean | null = null;
  let strengthShortfallKg: number | null = null;
  if (goal.targetTotalKg != null) {
    strengthReachable = projectedTotalKg >= goal.targetTotalKg;
    strengthShortfallKg = goal.targetTotalKg - projectedTotalKg;
    messages.push(
      strengthReachable
        ? `Total: ${goal.targetTotalKg}kg is reachable — ${goal.weeksOut} weeks projects to ${projectedTotalKg.toFixed(0)}kg from ${currentTotal.toFixed(0)}kg.`
        : `Total: ${goal.targetTotalKg}kg is ambitious. ${goal.weeksOut} weeks at your training age projects ` +
          `${projectedTotalKg.toFixed(0)}kg — about ${strengthShortfallKg.toFixed(0)}kg short. The plan still ` +
          `chases it; treat the number as a stretch rather than a forecast.`
    );
  }

  let enduranceReachable: boolean | null = null;
  let enduranceShortfallS: number | null = null;
  if (goal.target5kS != null) {
    enduranceReachable = projected5kS <= goal.target5kS;
    enduranceShortfallS = projected5kS - goal.target5kS;
    const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
    messages.push(
      enduranceReachable
        ? `5k: ${fmt(goal.target5kS)} is reachable — ${goal.weeksOut} weeks projects to ${fmt(projected5kS)}.`
        : `5k: ${fmt(goal.target5kS)} is ambitious. ${goal.weeksOut} weeks projects ${fmt(projected5kS)} — about ` +
          `${Math.round(enduranceShortfallS)}s short. Worth knowing now rather than at the finish line.`
    );
  }

  return {
    blocks,
    projectedTotalKg,
    projected5kS,
    strengthGainPct: cappedStrengthGain * 100,
    enduranceGainPct: cappedEnduranceGain * 100,
    strengthReachable,
    strengthShortfallKg,
    enduranceReachable,
    enduranceShortfallS,
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
    const current = Math.max(totalKg(state), 1);
    // A partial target compares against the same lifts only, or a single
    // bench goal would read as a collapse in the total.
    const comparable =
      goal.targetTotalKg != null
        ? current
        : Math.max(
            1,
            (goal.targetSquatKg != null ? (state.oneRms.squat ?? 0) : 0) +
              (goal.targetBenchKg != null ? (state.oneRms.bench ?? 0) : 0) +
              (goal.targetDeadliftKg != null ? (state.oneRms.deadlift ?? 0) : 0)
          );
    const gap = (strengthTarget - comparable) / comparable;
    const headroom = STRENGTH_GAIN_PER_BLOCK[state.strengthTrainingAge] * (goal.weeksOut / 12);
    out.strength = gap > DEVELOP_GAP_THRESHOLD * headroom ? "develop" : "maintain";
  }

  if (goal.target5kS != null) {
    const gap = (state.predicted5kS - goal.target5kS) / Math.max(state.predicted5kS, 1);
    const headroom = ENDURANCE_GAIN_PER_BLOCK[inferredEnduranceTrainingAge(state.enduranceTrainingAge, state.predicted5kS)] * (goal.weeksOut / 12);
    out.endurance = gap > DEVELOP_GAP_THRESHOLD * headroom ? "develop" : "maintain";
  }

  return out;
}
