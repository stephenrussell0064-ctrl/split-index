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

import {
  sessionContentForInstance,
  estimateFeasibility,
  strengthPhaseFromGapAndUrgency,
  cardioEmphasisFromGapAndUrgency,
  isTaperWindow,
  movementPatternForExercise,
  PEAK_WINDOW_DAYS,
  type SessionContent,
  type FeasibilityResult,
  type MovementPattern,
} from "./training-session-content";
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
  /** Days from "today" to an optional deadline the athlete set for this goal — null when no deadline was given. Stage 2: drives tapering (see training-session-content.ts) and the feasibility check below. */
  daysUntilTarget?: number | null;
  /** Cardio only — the goal's target distance in meters. Lets the session-content engine turn a session's duration into an actual "run 5.2km at 5:11/km" prescription instead of a vague effort description (see training-session-content.ts's cardioPaceAndDistance). Null/omitted for gym goals, or a cardio goal with no known distance. */
  distanceMeters?: number | null;
  /** Cardio only — the plain benchmark sport ("run"/"cycle"/"swim"/etc), used purely to decide whether a session's guidance should be phrased as a pace (min/km) or a speed (km/h). Not the same as targetKey, which for a custom distance is an encoded key ("run_10000"). */
  sport?: string | null;
}

export interface RankedGoal extends TrainingGoalInput {
  /** 0 = goal met or beaten; otherwise how far off target as a fraction of the target itself (0.1 = 10% off) — comparable across completely different units (seconds vs kg) because it's normalized to each goal's own target. */
  gapFraction: number;
  achieved: boolean;
  /** Share of weekly training focus this goal should get (0-1), summing to 1 across all non-achieved goals. */
  weight: number;
  /** Integer session count out of the weekly capacity, summing exactly to weeklyCapacity across all goals (0 once achieved). */
  weeklySessions: number;
  /** Stage 2: a plain-language heads-up when the deadline looks unrealistic for the current gap at this session frequency — see estimateFeasibility's own doc comment for why this is a caveat, not a hard rule. */
  feasibility: FeasibilityResult;
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
 * How much extra weekly-focus weight a goal earns purely from time
 * pressure (Stage 3, user feedback: "make this training plan as
 * sophisticated as possible") — a goal with a nearing deadline and a real
 * gap left should pull more weekly sessions toward it than the identical
 * gap with months to spare, the same way a real coach would reallocate
 * volume as a competition date approaches. 1x outside PEAK_WINDOW_DAYS
 * (unchanged behavior for a goal with no deadline, or a distant one) —
 * ramps up to 2.5x right at the deadline.
 */
function urgencyMultiplier(daysUntilTarget: number | null | undefined): number {
  if (daysUntilTarget == null || daysUntilTarget < 0 || daysUntilTarget >= PEAK_WINDOW_DAYS) return 1;
  const ramp = 1 - daysUntilTarget / PEAK_WINDOW_DAYS;
  return 1 + ramp * 1.5;
}

/**
 * Ranks goals furthest-behind-first and allocates a weekly session count
 * per goal that biases toward the biggest gaps while guaranteeing every
 * active goal keeps a real share (MIN_WEIGHT_FLOOR) — never a plan that's
 * 100% one goal at the total expense of the others. Goals with a nearing
 * deadline (see urgencyMultiplier) pull extra weight on top of their raw
 * gap — displayed gapFraction itself is never altered, only how much of
 * the week's focus it earns.
 */
export function buildTrainingPlan(goals: TrainingGoalInput[], weeklyCapacity: number): RankedGoal[] {
  const withGap = goals.map((g) => {
    const gapFraction = computeGapFraction(g);
    return { ...g, gapFraction, achieved: gapFraction <= 0 };
  });

  const activeCount = withGap.filter((g) => !g.achieved).length;
  if (activeCount === 0) {
    return withGap
      .map((g) => ({ ...g, weight: 0, weeklySessions: 0, feasibility: { feasible: true, message: null } }))
      .sort((a, b) => b.gapFraction - a.gapFraction);
  }

  const floor = Math.min(MIN_WEIGHT_FLOOR, 1 / activeCount);
  const effectiveGap = (g: (typeof withGap)[number]) => g.gapFraction * urgencyMultiplier(g.daysUntilTarget);
  const totalGap = withGap.reduce((sum, g) => sum + (g.achieved ? 0 : effectiveGap(g)), 0);
  const remainingBudget = 1 - floor * activeCount;

  const weighted = withGap.map((g) => {
    if (g.achieved) return { ...g, weight: 0 };
    const proportional = totalGap > 0 ? (effectiveGap(g) / totalGap) * remainingBudget : remainingBudget / activeCount;
    return { ...g, weight: floor + proportional };
  });

  const sessions = allocateSessions(
    weighted.map((g) => g.weight),
    Math.max(0, Math.round(weeklyCapacity))
  );

  const preliminary = weighted.map((g, i) => ({ ...g, weeklySessions: sessions[i] }));
  const adjustedCounts = consolidateOverlappingGymGoals(preliminary);

  return preliminary
    .map((g) => {
      const weeklySessions = adjustedCounts.get(g.id) ?? g.weeklySessions;
      return {
        ...g,
        weeklySessions,
        feasibility: estimateFeasibility(g.gapFraction, weeklySessions, g.daysUntilTarget ?? null),
      };
    })
    .sort((a, b) => b.gapFraction - a.gapFraction);
}

/**
 * Movement-pattern overlap consolidation (user feedback: "if two of my
 * goals involve bench press and dumbbell bench press for example, there is
 * no point training two lots of each as training bench press will also
 * train dumbbell press and vice versa, so factor this in that you don't
 * need to do double sessions for these"). Two active gym goals that share
 * a push/pull/legs/core movement pattern don't need their own session
 * counts to simply add up — a session built around one already trains the
 * synergist muscles the other needs too. This caps a same-pattern group's
 * combined session count at whichever single goal in it needed the most on
 * its own (never less than that — the neediest goal still gets its full
 * due), splits that reduced total between the group's goals in the same
 * proportion they'd have gotten independently, and hands the sessions that
 * frees up to every OTHER active goal instead, proportional to its own
 * weight — no training time is lost, it just stops being spent on
 * redundant volume. Returns only the goal ids whose count actually
 * changed, so callers can leave everything else untouched.
 */
function consolidateOverlappingGymGoals(
  entries: {
    id: string;
    goalType: TrainingGoalType;
    targetKey: string;
    achieved: boolean;
    weight: number;
    weeklySessions: number;
  }[]
): Map<string, number> {
  const active = entries.filter((g) => g.goalType === "gym" && !g.achieved);
  const groups = new Map<MovementPattern, typeof active>();
  for (const g of active) {
    const pattern = movementPatternForExercise(g.targetKey);
    if (!pattern) continue;
    const bucket = groups.get(pattern) ?? [];
    bucket.push(g);
    groups.set(pattern, bucket);
  }

  const adjusted = new Map<string, number>();
  let freedTotal = 0;

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    const groupTotal = group.reduce((sum, g) => sum + g.weeklySessions, 0);
    const groupCap = Math.max(...group.map((g) => g.weeklySessions));
    if (groupTotal <= groupCap) continue; // nothing redundant to consolidate
    freedTotal += groupTotal - groupCap;
    const shares = group.map((g) => (groupTotal > 0 ? g.weeklySessions / groupTotal : 1 / group.length));
    const newCounts = allocateSessions(shares, groupCap);
    group.forEach((g, i) => adjusted.set(g.id, newCounts[i]));
  }

  if (freedTotal > 0) {
    const untouched = entries.filter((g) => !g.achieved && !adjusted.has(g.id));
    if (untouched.length > 0) {
      const totalWeight = untouched.reduce((sum, g) => sum + g.weight, 0);
      const shares = untouched.map((g) => (totalWeight > 0 ? g.weight / totalWeight : 1 / untouched.length));
      const bonus = allocateSessions(shares, freedTotal);
      untouched.forEach((g, i) => adjusted.set(g.id, g.weeklySessions + bonus[i]));
    }
  }

  return adjusted;
}

export interface MacrocycleWeekGoal {
  goalId: string;
  label: string;
  goalType: TrainingGoalType;
  /** Human phase label, e.g. "Build", "Strength", "Peak (Taper)", "Base", "Sharpen (Taper)". */
  phaseLabel: string;
  weeklySessions: number;
  isTaper: boolean;
}

export interface MacrocycleWeek {
  /** 0 = this week. */
  weekOffset: number;
  weekLabel: string;
  goals: MacrocycleWeekGoal[];
}

const STRENGTH_PHASE_LABEL: Record<string, string> = { build: "Build", strength: "Strength", peak: "Peak" };
const CARDIO_EMPHASIS_LABEL: Record<string, string> = { "aerobic-base": "Base", specificity: "Sharpen" };

/**
 * Opt-in multi-week preview (Stage 3, user feedback: "make additional
 * options for the user to pick if they want to include... as sophisticated
 * as possible"): shows how each goal's training PHASE and weekly session
 * count would evolve over the next `weeksToShow` weeks, purely from time
 * passing and deadlines getting closer — this is NOT a prediction of
 * actual progress (today's gapFraction is held fixed in every week; only
 * urgency/phase shifts with the calendar). Read-only and fully derived —
 * nothing is persisted per future week, each one is just buildTrainingPlan
 * recomputed with daysUntilTarget shifted back by that many weeks, the
 * same way the real week-of view already works.
 */
export function buildMacrocyclePreview(
  goals: TrainingGoalInput[],
  weeklyCapacity: number,
  weeksToShow = 6
): MacrocycleWeek[] {
  const weeks: MacrocycleWeek[] = [];
  for (let w = 0; w < weeksToShow; w++) {
    const shifted = goals.map((g) => ({
      ...g,
      daysUntilTarget: g.daysUntilTarget != null ? g.daysUntilTarget - w * 7 : g.daysUntilTarget,
    }));
    const ranked = buildTrainingPlan(shifted, weeklyCapacity);
    const weekGoals: MacrocycleWeekGoal[] = ranked
      .filter((g) => !g.achieved && g.weeklySessions > 0)
      .map((g) => {
        const daysUntil = g.daysUntilTarget ?? null;
        const taper = isTaperWindow(daysUntil);
        const phaseLabel =
          g.goalType === "gym"
            ? STRENGTH_PHASE_LABEL[strengthPhaseFromGapAndUrgency(g.gapFraction, daysUntil)]
            : CARDIO_EMPHASIS_LABEL[cardioEmphasisFromGapAndUrgency(g.gapFraction, daysUntil)];
        return {
          goalId: g.id,
          label: g.label,
          goalType: g.goalType,
          phaseLabel: taper ? `${phaseLabel} (Taper)` : phaseLabel,
          weeklySessions: g.weeklySessions,
          isTaper: taper,
        };
      });
    weeks.push({ weekOffset: w, weekLabel: w === 0 ? "This week" : `Week ${w + 1}`, goals: weekGoals });
  }
  return weeks;
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
  movementPattern?: "push" | "pull" | "legs" | "core";
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
        const duration = sessionHours[q.goal.goalType];
        const content = sessionContentForInstance(
          q.goal,
          q.seen,
          q.totalInstances,
          activeGymGoalNames,
          q.goal.daysUntilTarget ?? null,
          duration
        );
        instances.push({ goal: q.goal, duration, content });
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
        .map((c) => ({
          ...c,
          fresh: !days[c.i].sessions.some((s) => s.goalId === inst.goal.id),
          // Interference-aware placement: a heavy leg session and a hard
          // cardio session (tempo/threshold/interval/long) on adjacent
          // days is exactly the pairing lib/scoring/interference.ts's own
          // decay window models as a real cost (leg-day fatigue measurably
          // compromises the next day or two of running). Soft preference
          // only — never drops a session for it, just prefers a cleaner
          // day when one's available.
          interferencePenalty: adjacentInterferencePenalty(days, c.i, inst.content),
        }))
        .sort((a, b) => {
          if (a.interferencePenalty !== b.interferencePenalty) return a.interferencePenalty - b.interferencePenalty;
          if (a.fresh !== b.fresh) return a.fresh ? -1 : 1;
          return b.remaining - a.remaining;
        });
      if (candidates.length === 0) continue; // no day has room left — dropped rather than overbooked
      const pick = candidates[0];
      days[pick.i].sessions.push({
        goalId: inst.goal.id,
        goalLabel: inst.goal.label,
        goalType: inst.goal.goalType,
        durationHours: inst.duration,
        title: inst.content.title,
        description: inst.content.description,
        sessionType: inst.content.sessionType,
        movementPattern: inst.content.movementPattern,
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
        movementPattern: inst.content.movementPattern,
      });
    });
  }

  return enforceMaxOneGymSessionPerDay(days);
}

/**
 * Post-placement fixup (user feedback: "it is unreasonable to have two gym
 * sessions a day"). The placement above optimizes for per-day capacity and
 * leg/cardio interference, not this — two DIFFERENT gym goals' instances
 * (or, in even-spacing mode, two instances the index formula happened to
 * line up) can still land on the same day. This pass keeps the first gym
 * session on any day that has more than one and relocates every session
 * after it to whichever OTHER day has room and doesn't already carry a gym
 * session of its own, preferring the least-loaded such day. A session with
 * genuinely nowhere better to go is left doubled up rather than dropped —
 * the same "never lose a session, just place it less ideally" philosophy
 * as the interference-avoidance placement above.
 */
function enforceMaxOneGymSessionPerDay(days: DaySchedule[]): DaySchedule[] {
  const capacityKnown = days.some((d) => d.capacityHours != null);
  const hoursUsed = (d: DaySchedule) => d.sessions.reduce((sum, s) => sum + s.durationHours, 0);

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const gymSessions = days[dayIndex].sessions.filter((s) => s.goalType === "gym");
    if (gymSessions.length <= 1) continue;

    for (const extra of gymSessions.slice(1)) {
      const targets = days
        .map((d, i) => i)
        .filter((i) => i !== dayIndex)
        .filter((i) => !days[i].sessions.some((s) => s.goalType === "gym"))
        .filter((i) => {
          if (!capacityKnown) return true;
          const cap = days[i].capacityHours ?? 0;
          return cap - hoursUsed(days[i]) >= extra.durationHours;
        })
        .sort((a, b) => hoursUsed(days[a]) - hoursUsed(days[b]));

      if (targets.length === 0) continue; // nowhere better — leave it doubled up rather than dropping it
      days[dayIndex].sessions = days[dayIndex].sessions.filter((s) => s !== extra);
      days[targets[0]].sessions.push(extra);
    }
  }

  return days;
}

const HIGH_DEMAND_CARDIO = new Set<SessionType>(["tempo", "threshold", "interval", "long", "race"]);

/**
 * Counts how many sessions on `dayIndex` itself or the days immediately
 * before/after it would conflict with placing `content` there — currently
 * just the one pairing with real evidence behind it in this app (leg-day
 * vs hard cardio; see interference.ts's
 * LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO). Same-day is checked too, not
 * just adjacency — a heavy squat session and a hard interval run stacked
 * on the identical day is at least as bad as back-to-back days. Only
 * applies when real per-day capacity is known — the flat/even-spacing
 * mode has no genuine day-choice to prefer between, so it's left alone
 * rather than bolting a false sense of precision onto a guess.
 */
function adjacentInterferencePenalty(days: DaySchedule[], dayIndex: number, content: SessionContent): number {
  const isLegSession = content.movementPattern === "legs";
  const isHardCardio = content.sessionType !== undefined && HIGH_DEMAND_CARDIO.has(content.sessionType);
  if (!isLegSession && !isHardCardio) return 0;

  const nearbyDays = [dayIndex - 1, dayIndex, dayIndex + 1].filter((i) => i >= 0 && i <= 6);
  let penalty = 0;
  for (const n of nearbyDays) {
    for (const s of days[n].sessions) {
      if (isLegSession && s.goalType === "cardio" && s.sessionType && HIGH_DEMAND_CARDIO.has(s.sessionType)) penalty += 1;
      if (isHardCardio && s.goalType === "gym" && s.movementPattern === "legs") penalty += 1;
    }
  }
  return penalty;
}
