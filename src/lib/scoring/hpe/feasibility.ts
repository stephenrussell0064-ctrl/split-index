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
): { currentKg: number; missingLifts: string[] } {
  const named = (["squat", "bench", "deadlift"] as const).filter((lift) => {
    const target =
      lift === "squat" ? goal.targetSquatKg : lift === "bench" ? goal.targetBenchKg : goal.targetDeadliftKg;
    return target != null && target > 0;
  });

  if (named.length === 0) return { currentKg: totalKg(state), missingLifts: [] };

  let currentKg = 0;
  const missingLifts: string[] = [];
  for (const lift of named) {
    const oneRm = state.oneRms[lift];
    if (oneRm == null || oneRm <= 0) missingLifts.push(LIFT_LABELS[lift]);
    else currentKg += oneRm;
  }
  return { currentKg, missingLifts };
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

  // Focus SCALES the published rate down; it never scales it up.
  //
  // This was `2 * share`, which doubled the rate for a single-sport athlete.
  // The published rates already describe someone training that discipline
  // properly — an advanced runner's 1.5% per block is 1.5% for a runner who
  // runs, not for a runner who also does nothing else. Doubling it for focus
  // counted the same focus twice, and that factor of two is most of how an
  // 18:25 became a 16:22.
  const strengthGain = strengthRate * blocks * strengthShare * (1 - CONCURRENT_ATTENUATION_STRENGTH);
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
  const cappedEnduranceGain = Math.min(
    enduranceGain,
    MAX_ENDURANCE_GAIN_PER_BLOCK * blocks,
    enduranceRate * blocks * MAX_GAIN_MULTIPLE_OF_RATE
  );

  const projectedTotalKg = currentTotal * (1 + cappedStrengthGain);
  const projected5kS = state.predicted5kS * (1 - cappedEnduranceGain);

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
