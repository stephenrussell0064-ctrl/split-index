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
  FRONTIER_MAX_DELTA_FRACTION,
  MAX_SAFE_LOSS_RATE_PCT_PER_WEEK,
  MIN_HEALTHY_BMI,
  PACE_COST_S_PER_KM_PER_KG,
  PRIORITY_SHARE_SKEW,
  RUNNING_ECONOMY_BONUS_PER_BLOCK,
  STRENGTH_GAIN_PER_BLOCK,
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

export function feasibilityScreen(state: AthleteState, goal: Goal): FeasibilityResult {
  const blocks = goal.weeksOut / 12.0;
  const strengthRate = STRENGTH_GAIN_PER_BLOCK[state.strengthTrainingAge];
  const enduranceRate = ENDURANCE_GAIN_PER_BLOCK[state.enduranceTrainingAge];

  // The priority slider splits the available adaptation between domains.
  const strengthShare = 0.5 + 0.5 * (goal.priority - 0.5) * 2 * PRIORITY_SHARE_SKEW;
  const enduranceShare = 1.0 - strengthShare;

  const strengthGain = strengthRate * blocks * (2 * strengthShare) * (1 - CONCURRENT_ATTENUATION_STRENGTH);
  let enduranceGain = enduranceRate * blocks * (2 * enduranceShare) * (1 - CONCURRENT_ATTENUATION_ENDURANCE);
  // Strength work improves running economy independently of aerobic gain —
  // the one place concurrent training pays rather than costs.
  enduranceGain += RUNNING_ECONOMY_BONUS_PER_BLOCK * blocks;

  const currentTotal = totalKg(state);
  const projectedTotalKg = currentTotal * (1 + strengthGain);
  const projected5kS = state.predicted5kS * (1 - enduranceGain);

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
    strengthGainPct: strengthGain * 100,
    enduranceGainPct: enduranceGain * 100,
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
export function classifyDomains(state: AthleteState, goal: Goal): Record<"strength" | "endurance", DomainMode> {
  const out: Record<"strength" | "endurance", DomainMode> = { strength: "maintain", endurance: "maintain" };

  if (goal.targetTotalKg != null) {
    const current = Math.max(totalKg(state), 1);
    const gap = (goal.targetTotalKg - current) / current;
    const headroom = STRENGTH_GAIN_PER_BLOCK[state.strengthTrainingAge] * (goal.weeksOut / 12);
    out.strength = gap > DEVELOP_GAP_THRESHOLD * headroom ? "develop" : "maintain";
  }

  if (goal.target5kS != null) {
    const gap = (state.predicted5kS - goal.target5kS) / Math.max(state.predicted5kS, 1);
    const headroom = ENDURANCE_GAIN_PER_BLOCK[state.enduranceTrainingAge] * (goal.weeksOut / 12);
    out.endurance = gap > DEVELOP_GAP_THRESHOLD * headroom ? "develop" : "maintain";
  }

  return out;
}
