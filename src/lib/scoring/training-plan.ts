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

import { sessionContentForInstance, type SessionContent } from "./training-session-content";
import type { SessionType } from "@/types";

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

/**
 * Weekly schedule builder (user feedback: "you forgot to actually making
 * the training plan, this should be a weekly plan where you ask how many
 * hours they can do each week, or per day, and then you create a weekly
 * plan which allows the user to work towards these goals"). buildTrainingPlan
 * above already answers "how many sessions per goal" — this layer answers
 * the question that was still missing: which DAY does each of those
 * sessions actually happen on, laid out Monday through Sunday.
 */

/** Rough session length by goal type, used only to convert an hours budget into a session count — not shown to the user as a promise, just an estimate. */
export interface SessionDurationHours {
  cardio: number;
  gym: number;
}

export const DEFAULT_SESSION_HOURS: SessionDurationHours = { cardio: 0.75, gym: 1 };

export const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/**
 * Converts a hard "I have N hours this week" budget into an integer
 * session count for buildTrainingPlan, using the blended average session
 * length across whatever goals are actually in play (a week that's all
 * gym lifts needs fewer, longer sessions than one split across several
 * quick cardio efforts).
 */
export function estimateSessionCount(
  goals: Pick<TrainingGoalInput, "goalType">[],
  totalWeeklyHours: number,
  sessionHours: SessionDurationHours = DEFAULT_SESSION_HOURS
): number {
  if (goals.length === 0 || totalWeeklyHours <= 0) return 0;
  const avgHours = goals.reduce((sum, g) => sum + sessionHours[g.goalType], 0) / goals.length;
  if (avgHours <= 0) return 0;
  return Math.max(0, Math.round(totalWeeklyHours / avgHours));
}

export interface ScheduledSession {
  goalId: string;
  goalLabel: string;
  goalType: TrainingGoalType;
  durationHours: number;
  /** Curated session content — real accessory work / DUP-varied prescriptions for gym, real easy/quality/long structure for cardio. See training-session-content.ts. */
  title: string;
  description: string;
  sessionType?: SessionType;
}

export interface DaySchedule {
  /** 0 = Monday .. 6 = Sunday. */
  day: number;
  dayLabel: string;
  /** null when the athlete gave one flat weekly number rather than a per-day breakdown — there's no real per-day figure to show. */
  capacityHours: number | null;
  sessions: ScheduledSession[];
}

/**
 * Lays each goal's weekly session count onto specific days.
 *
 * - `perDayHours` given (Mon-first, length 7): greedy bin-packing — each
 *   session goes on whichever day still has the most room for it,
 *   preferring a day that doesn't already carry the same goal today if an
 *   alternative with room exists (spreads repeat sessions of one goal
 *   across the week instead of stacking them).
 * - `perDayHours` omitted (one flat weekly number was given instead): even
 *   index-spacing across all 7 days — we don't know real day-by-day
 *   availability, just that "these N sessions should land roughly evenly
 *   through the week" (3 sessions → Mon/Wed/Fri, not Mon/Tue/Wed).
 *
 * Sessions are interleaved round-robin across goals in ranked (furthest-
 * behind-first) order before placement, not grouped goal-by-goal — so the
 * priority goal doesn't just claim the first half of the week outright.
 */
export function buildWeeklySchedule(
  rankedGoals: RankedGoal[],
  perDayHours?: number[],
  sessionHours: SessionDurationHours = DEFAULT_SESSION_HOURS
): DaySchedule[] {
  const days: DaySchedule[] = WEEKDAY_LABELS.map((label, i) => ({
    day: i,
    dayLabel: label,
    capacityHours: perDayHours ? (perDayHours[i] ?? 0) : null,
    sessions: [],
  }));

  const queues = rankedGoals
    .filter((g) => !g.achieved && g.weeklySessions > 0)
    .map((g) => ({ goal: g, remaining: g.weeklySessions, totalInstances: g.weeklySessions, seen: 0 }));

  // Every other active gym goal's own exercise name — accessory picks below
  // must never just re-list a lift that's already someone's own dedicated
  // goal elsewhere in the plan.
  const activeGymGoalNames = new Set(
    rankedGoals.filter((g) => g.goalType === "gym" && !g.achieved).map((g) => g.targetKey)
  );

  const instances: { goal: RankedGoal; duration: number; content: SessionContent }[] = [];
  let anyLeft = queues.length > 0;
  while (anyLeft) {
    anyLeft = false;
    for (const q of queues) {
      if (q.remaining > 0) {
        const content = sessionContentForInstance(q.goal, q.seen, q.totalInstances, activeGymGoalNames);
        instances.push({ goal: q.goal, duration: sessionHours[q.goal.goalType], content });
        q.seen += 1;
        q.remaining -= 1;
        anyLeft = true;
      }
    }
  }

  if (instances.length === 0) return days;

  if (perDayHours) {
    const remaining = [...perDayHours];
    for (const inst of instances) {
      const candidates = days
        .map((d, i) => ({ i, remaining: remaining[i] ?? 0 }))
        .filter((c) => c.remaining >= inst.duration)
        .sort((a, b) => b.remaining - a.remaining);
      if (candidates.length === 0) continue; // no day has room left — dropped rather than overbooked
      const fresh = candidates.find((c) => !days[c.i].sessions.some((s) => s.goalId === inst.goal.id));
      const pick = fresh ?? candidates[0];
      days[pick.i].sessions.push({
        goalId: inst.goal.id,
        goalLabel: inst.goal.label,
        goalType: inst.goal.goalType,
        durationHours: inst.duration,
        title: inst.content.title,
        description: inst.content.description,
        sessionType: inst.content.sessionType,
      });
      remaining[pick.i] -= inst.duration;
    }
  } else {
    instances.forEach((inst, i) => {
      const dayIndex = Math.min(6, Math.floor((i * 7) / instances.length));
      days[dayIndex].sessions.push({
        goalId: inst.goal.id,
        goalLabel: inst.goal.label,
        goalType: inst.goal.goalType,
        durationHours: inst.duration,
        title: inst.content.title,
        description: inst.content.description,
        sessionType: inst.content.sessionType,
      });
    });
  }

  return days;
}
