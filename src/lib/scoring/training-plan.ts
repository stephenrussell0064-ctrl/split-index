/**
 * Goal-driven hybrid training plan (user feedback): "I now want... a
 * recommendation of what to train. I want generated plans for users to
 * build the most effective route to their goal, allow them to input their
 * goals for each cardio exercise and gym exercise that they wish to
 * achieve, and then create a plan which will prioritise the exercise or
 * activity which they are furthest away from, whilst still maintaining the
 * hybrid balance between all exercises."
 *
 * Pure functions over plain goal data — no DB/network here, so the
 * prioritization math itself is fully testable in isolation from how
 * "current value" gets sourced (predicted_benchmarks for cardio, best-ever
 * estimated 1RM for gym — see /api/training-plan/route.ts).
 */

export type TrainingGoalType = "cardio" | "gym";

export interface TrainingGoalInput {
  id: string;
  goalType: TrainingGoalType;
  /** Cardio: benchmark sport key (run/walk/row/swim/cycle/ski). Gym: exercise name. */
  targetKey: string;
  /** Cardio: seconds at the sport's canonical benchmark distance. Gym: kg (estimated 1RM). */
  targetValue: number;
  /** Same unit as targetValue — null when there's no current data to compare against yet (e.g. never logged this exercise/sport). */
  currentValue: number | null;
  /** Display label, e.g. "5K run" or "Squat". */
  label: string;
}

export interface RankedGoal extends TrainingGoalInput {
  /** 0 = goal met or beaten; otherwise how far off target as a fraction of the target itself (0.1 = 10% off) — comparable across completely different units (seconds vs kg) because it's normalized to each goal's own target. */
  gapFraction: number;
  achieved: boolean;
  /** Share of weekly training focus this goal should get (0-1), summing to 1 across all non-achieved goals. */
  weight: number;
  /** Integer session count out of the weekly capacity, summing exactly to weeklyCapacity across all goals (0 once achieved). */
  weeklySessions: number;
}

/**
 * Every active (non-achieved) goal gets at least this share of the
 * remaining weekly focus before the gap-proportional distribution runs —
 * the "whilst still maintaining the hybrid balance between all exercises"
 * requirement. Without a floor, a goal already 95% of the way there could
 * get crowded out to zero focus by one goal that's badly behind, which
 * would let it silently regress from neglect while chasing the other.
 */
const MIN_WEIGHT_FLOOR = 0.15;

/**
 * How far off target this goal currently is, as a fraction of the target
 * (always >= 0; 0 means met or beaten). No current data at all (never
 * logged this sport/exercise) is treated as maximally far off — the
 * intent is to nudge the athlete to log a baseline for it, not to hide it
 * from the plan for lack of data.
 */
export function computeGapFraction(goal: Pick<TrainingGoalInput, "goalType" | "targetValue" | "currentValue">): number {
  if (goal.targetValue <= 0) return 0;
  if (goal.currentValue == null) return 1;
  if (goal.goalType === "cardio") {
    // Lower is better (a time) — behind target means currently SLOWER (bigger number).
    return Math.max(0, (goal.currentValue - goal.targetValue) / goal.targetValue);
  }
  // Gym — higher is better (a 1RM) — behind target means currently LIGHTER.
  return Math.max(0, (goal.targetValue - goal.currentValue) / goal.targetValue);
}

/**
 * Largest-remainder method: distributes `total` whole sessions across
 * fractional weights so the integer allocations sum EXACTLY to `total`
 * (naive Math.round() on each share can over/under-count by a session or
 * two) — each goal gets its floor(weight*total) baseline, then whichever
 * goals had the largest rounding remainders receive the few sessions left
 * over one at a time until the count matches.
 */
function allocateSessions(weights: number[], total: number): number[] {
  if (total <= 0 || weights.every((w) => w === 0)) return weights.map(() => 0);
  const raw = weights.map((w) => w * total);
  const base = raw.map(Math.floor);
  let remainder = total - base.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...base];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i] += 1;
  }
  return result;
}

/**
 * Ranks goals furthest-behind-first and allocates a weekly session count
 * per goal that biases toward the biggest gaps while guaranteeing every
 * active goal keeps a real share (MIN_WEIGHT_FLOOR) — never a plan that's
 * 100% one goal at the total expense of the others.
 */
export function buildTrainingPlan(goals: TrainingGoalInput[], weeklyCapacity: number): RankedGoal[] {
  const withGap = goals.map((g) => {
    const gapFraction = computeGapFraction(g);
    return { ...g, gapFraction, achieved: gapFraction <= 0 };
  });

  const activeCount = withGap.filter((g) => !g.achieved).length;
  if (activeCount === 0) {
    return withGap
      .map((g) => ({ ...g, weight: 0, weeklySessions: 0 }))
      .sort((a, b) => b.gapFraction - a.gapFraction);
  }

  const floor = Math.min(MIN_WEIGHT_FLOOR, 1 / activeCount);
  const totalGap = withGap.reduce((sum, g) => sum + (g.achieved ? 0 : g.gapFraction), 0);
  const remainingBudget = 1 - floor * activeCount;

  const weighted = withGap.map((g) => {
    if (g.achieved) return { ...g, weight: 0 };
    const proportional = totalGap > 0 ? (g.gapFraction / totalGap) * remainingBudget : remainingBudget / activeCount;
    return { ...g, weight: floor + proportional };
  });

  const sessions = allocateSessions(
    weighted.map((g) => g.weight),
    Math.max(0, Math.round(weeklyCapacity))
  );

  return weighted
    .map((g, i) => ({ ...g, weeklySessions: sessions[i] }))
    .sort((a, b) => b.gapFraction - a.gapFraction);
}
