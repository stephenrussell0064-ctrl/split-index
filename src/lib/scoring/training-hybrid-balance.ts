/**
 * Hybrid-balance coverage (user feedback): "As this is a hybrid platform
 * the whole purpose is finding a balance between all muscle groups and
 * cardio, and so if the training plan doesn't account for this and only
 * focuses on the users goals, then please amend as well, these goals
 * should just be prioritised."
 *
 * A functionality test confirmed the gap: a plan built purely from e.g. a
 * Bench Press goal + a 5K goal trains ONLY push + running — zero pull,
 * zero legs, zero core, zero cardio cross-training. A gym-only goal set
 * produces zero cardio at all; a cardio-only goal set produces zero
 * strength work at all. That's exactly the kind of imbalance (untrained
 * antagonist patterns is a real injury/posture risk, not just an
 * aesthetic gap) a hybrid-athlete platform exists to prevent.
 *
 * This module computes what's genuinely missing and reserves a small,
 * capped slice of the athlete's OWN stated weekly capacity for baseline
 * coverage of it — taken out of weeklyCapacity BEFORE buildTrainingPlan
 * ranks the real goals, so the reservation comes from the athlete's own
 * time budget (never invented on top of it) and real goals still get the
 * clear majority of the week. That's the literal meaning of "goals should
 * just be prioritised": goals are never displaced by maintenance, they
 * just don't get to be the ONLY thing trained either.
 */

import type { MovementPattern } from "./training-session-content";
import type { TrainingGoalType } from "./training-plan";

const ALL_PATTERNS: MovementPattern[] = ["push", "pull", "legs", "core"];

export interface HybridBalanceGaps {
  /** push/pull/legs/core patterns with zero active gym goal touching them. */
  missingPatterns: MovementPattern[];
  /** True when there isn't a single active cardio goal of any sport. */
  needsCardioMaintenance: boolean;
  /** True when there isn't a single active gym goal at all — missingPatterns will be all four in this case too; this additionally signals "one real full-body session", not just "top up whatever's thin". */
  needsGymMaintenance: boolean;
}

export function computeHybridBalanceGaps(
  goals: { goalType: TrainingGoalType; targetKey: string; achieved?: boolean }[],
  patternForExercise: (name: string) => MovementPattern | null
): HybridBalanceGaps {
  const active = goals.filter((g) => !g.achieved);
  const gymGoals = active.filter((g) => g.goalType === "gym");
  const coveredPatterns = new Set(
    gymGoals.map((g) => patternForExercise(g.targetKey)).filter((p): p is MovementPattern => p != null)
  );
  return {
    missingPatterns: ALL_PATTERNS.filter((p) => !coveredPatterns.has(p)),
    needsCardioMaintenance: !active.some((g) => g.goalType === "cardio"),
    needsGymMaintenance: gymGoals.length === 0,
  };
}

/** At most one combined gym-maintenance session and one cardio-maintenance session — never more, so maintenance can never outgrow the athlete's real goals into the majority of the week. */
export const MAX_HYBRID_BALANCE_SESSIONS = 2;

/**
 * Maintenance never claims more than this share of the week — "leave at
 * least one session per goal" alone still let it eat 40-50% of a small
 * week (e.g. 2 of 5 sessions), which reads as competing with goals rather
 * than staying secondary to them. Only applies once the athlete has real
 * goals; with none yet, there's nothing to protect a share for. User
 * feedback: "increase the goal percentage slightly higher as ultimately
 * they want to work towards this" — was 0.25 (goals guaranteed >= 75%),
 * tightened to 0.2 (goals guaranteed >= 80%) so the athlete's own targets
 * pull an even clearer majority of the week.
 */
const MAX_HYBRID_BALANCE_FRACTION = 0.2;

/**
 * How many weekly sessions to set aside for hybrid-balance coverage,
 * taken out of weeklyCapacity before the real goals are ranked. Never
 * reserves so much that real goals would be crowded below one session
 * each, AND never more than a fifth of the week once there are real
 * goals to prioritize over it — an athlete with barely enough capacity
 * for their own goals gets no maintenance forced on top of them, full
 * stop, and a merely-tight week doesn't get half of it eaten either.
 */
export function reserveHybridBalanceSessions(
  gaps: HybridBalanceGaps,
  weeklyCapacity: number,
  activeGoalCount: number
): number {
  const wanted = (gaps.missingPatterns.length > 0 ? 1 : 0) + (gaps.needsCardioMaintenance ? 1 : 0);
  if (wanted === 0) return 0;
  const capped = Math.min(wanted, MAX_HYBRID_BALANCE_SESSIONS);
  if (activeGoalCount === 0) return Math.max(0, Math.min(capped, weeklyCapacity));
  const fractionCap = Math.floor(weeklyCapacity * MAX_HYBRID_BALANCE_FRACTION);
  const leaveRoomCap = Math.max(0, weeklyCapacity - activeGoalCount);
  return Math.max(0, Math.min(capped, fractionCap, leaveRoomCap));
}

export interface HybridBalanceSchedule {
  gymMaintenance: { missingPatterns: MovementPattern[] } | null;
  cardioMaintenance: boolean;
}

/**
 * Decides WHICH gap(s) actually get one of the reserved slots when
 * reservedSessions is less than what's "wanted" (e.g. capacity was too
 * tight to grant both) — gym-pattern coverage is prioritized over cardio
 * when only one slot is available, since an untrained antagonist muscle
 * group has a more concrete injury-risk case than one missed generic
 * cardio session.
 */
export function resolveHybridBalanceSchedule(gaps: HybridBalanceGaps, reservedSessions: number): HybridBalanceSchedule {
  const wants: ("gym" | "cardio")[] = [];
  if (gaps.missingPatterns.length > 0) wants.push("gym");
  if (gaps.needsCardioMaintenance) wants.push("cardio");
  const granted = new Set(wants.slice(0, Math.max(0, reservedSessions)));
  return {
    gymMaintenance: granted.has("gym") ? { missingPatterns: gaps.missingPatterns } : null,
    cardioMaintenance: granted.has("cardio"),
  };
}
