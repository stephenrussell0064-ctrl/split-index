/**
 * Training-plan progress tracking (user feedback): "Also allow the
 * training plan to be saved and tracked for the user to monitor progress,
 * and each activity the user logs, say in the training plan tab what
 * percentage of the day or session they have met and how on track they
 * are to meeting their goal and provide a timeline estimate."
 *
 * Two independent, pure, DB-free pieces (see /api/training-goals/route.ts
 * for where the real activity/snapshot data gets fetched and fed in):
 *
 *  - computeWeekProgress: "3 of 4 sessions done this week" per goal, from
 *    whatever activities the athlete has actually logged since Monday.
 *    Deliberately doesn't require the weekly schedule itself to be
 *    persisted — a qualifying activity (right sport for cardio, right
 *    exercise name for gym) counts toward that goal's weekly target
 *    regardless of which day it landed on, which is both simpler and more
 *    forgiving of an athlete training on a different day than planned.
 *
 *  - computeProgressTrend: a genuine rate-of-improvement timeline
 *    estimate derived from the athlete's own historical gapFraction
 *    snapshots, not a generic assumed rate — complements rather than
 *    replaces estimateFeasibility's static sanity check in
 *    training-session-content.ts (that one asks "is the stated deadline
 *    realistic at all"; this one asks "at the rate you're actually
 *    going, when will you get there").
 */

export interface LoggedSessionMatch {
  goalType: "cardio" | "gym";
  /** Gym: the logged exercise's name. Cardio: the activity's plain sport. Matched case-insensitively against the goal's own targetKey/sport. */
  key: string;
  loggedAt: string;
}

export interface WeekProgress {
  sessionsLogged: number;
  sessionsTarget: number;
  /** 0-100, capped at 100 even if the athlete has logged more than planned. */
  percentComplete: number;
}

const MS_PER_DAY = 86400000;

/** Monday 00:00 UTC of the week containing `now` — matches WEEKDAY_LABELS' Mon-first convention in training-plan.ts. */
export function startOfWeek(now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sunday, 1 = Monday, ...
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - diffToMonday);
  return d;
}

export function computeWeekProgress(
  goal: { goalType: "cardio" | "gym"; targetKey: string; sport?: string | null; weeklySessions: number },
  loggedThisWeek: LoggedSessionMatch[]
): WeekProgress {
  const matchKey = (goal.goalType === "gym" ? goal.targetKey : (goal.sport ?? goal.targetKey)).toLowerCase();
  const sessionsLogged = loggedThisWeek.filter(
    (a) => a.goalType === goal.goalType && a.key.toLowerCase() === matchKey
  ).length;
  const sessionsTarget = goal.weeklySessions;
  const percentComplete = sessionsTarget > 0 ? Math.min(100, Math.round((sessionsLogged / sessionsTarget) * 100)) : 0;
  return { sessionsLogged, sessionsTarget, percentComplete };
}

export interface ProgressSnapshot {
  /** YYYY-MM-DD */
  date: string;
  gapFraction: number;
}

export interface ProgressTrend {
  onTrack: boolean;
  message: string;
  /** YYYY-MM-DD — only set when a genuine improving trend exists to project from. */
  projectedDate: string | null;
}

/** Below this many days of history, a "rate" is too noisy to project a timeline from — one good or bad session can swing it wildly. */
const MIN_TREND_WINDOW_DAYS = 7;

/**
 * Derives an actual timeline estimate from how much this goal's gap has
 * closed between the oldest and newest available snapshot, projected
 * forward at that same rate. Returns null (not "not on track") when there
 * simply isn't enough history yet to say anything — the caller should show
 * the existing static feasibility message in that gap, not a bogus trend.
 */
export function computeProgressTrend(
  snapshots: ProgressSnapshot[],
  currentGapFraction: number,
  today: Date = new Date()
): ProgressTrend | null {
  if (currentGapFraction <= 0) return null; // already met — nothing to project
  if (snapshots.length < 2) return null;

  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const daysBetween = (new Date(`${newest.date}T00:00:00Z`).getTime() - new Date(`${oldest.date}T00:00:00Z`).getTime()) / MS_PER_DAY;
  if (daysBetween < MIN_TREND_WINDOW_DAYS) return null;

  const gapClosed = oldest.gapFraction - newest.gapFraction;
  const ratePerDay = gapClosed / daysBetween;

  if (ratePerDay <= 0) {
    return {
      onTrack: false,
      message: "No measurable progress toward this goal over your recent history — the gap hasn't closed.",
      projectedDate: null,
    };
  }

  const daysRemaining = currentGapFraction / ratePerDay;
  const projected = new Date(today.getTime() + daysRemaining * MS_PER_DAY);
  const weeksRemaining = Math.round(daysRemaining / 7);
  return {
    onTrack: true,
    message:
      weeksRemaining <= 1
        ? "On pace to hit this goal within about a week at your current rate."
        : `On pace to hit this goal in about ${weeksRemaining} weeks at your current rate.`,
    projectedDate: projected.toISOString().slice(0, 10),
  };
}
