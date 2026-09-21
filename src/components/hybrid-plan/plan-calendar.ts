import { addDays, format, startOfDay, startOfWeek } from "date-fns";
import type { FindingId } from "@/lib/scoring/hpe";

/**
 * Turns the engine's week/day-name grid into a real calendar of dated days.
 *
 * The engine deliberately knows nothing about dates. It emits "week 3, Sat,
 * PM" because everything it reasons about — ramp, ACWR, separation between a
 * heavy lower day and a quality endurance day — is relative. Weekday names
 * and week numbers are the right internal representation and this module does
 * not try to change that.
 *
 * But "show each specific day and the training for that day" needs an actual
 * date, and there is exactly one honest way to get one: the plan is generated
 * from `now` (the route computes `weeksOut` as event date minus now), so week
 * 1 is the week the plan was built in. Anchor week 1 to the Monday of that
 * week — Monday because `DAYS` in the engine's constants starts on Monday, so
 * a Sunday-first anchor would silently shift every session by six days.
 *
 * The anchor is passed in rather than assumed to be today, because a plan read
 * back while generation is paused was built at `storedPlan.generatedAt` and
 * anchoring it to today would slide the whole block forward and quietly
 * relabel week 4 as week 1.
 *
 * Everything here is pure and date-only in LOCAL time. An athlete's Tuesday is
 * the Tuesday on the phone in their hand.
 */

export interface PlanSessionView {
  /**
   * The stored `hpe_sessions` id, when the plan has been persisted.
   *
   * The generated plan has no ids of its own — they exist only on the rows
   * `savePlan` writes — so the API matches them back on (week, day, slot, kind)
   * and sends them with the plan. Without it the feedback control has nothing
   * to post against, which is the state the whole loop was in: a table with two
   * readers and no writers.
   */
  sessionId?: string | null;
  kind: string;
  /** What the athlete calls it — "Push", "Legs". Falls back to the engine's kind. */
  label?: string;
  /** Why the session looks the way it does. Never rendered as an exercise. */
  notes?: string[];
  domain: "endurance" | "strength";
  day: string | null;
  slot: string | null;
  minutes: number;
  isQuality: boolean;
  findingId: FindingId;
  prescription: string;
  emphasisKey: string;
  /**
   * The structured half of the prescription, which the engine has always
   * emitted alongside `text` and this screen has always thrown away. The day
   * view puts distance, pace and heart rate where the eye lands first; the
   * sentence underneath is then the detail rather than the only copy.
   * All optional: a lift prescription carries none of them.
   */
  distanceKm?: number;
  paceLoSPerKm?: number;
  paceHiSPerKm?: number;
  hrLo?: number;
  hrHi?: number;
  hrSource?: string;
}

export interface PlanWeekView {
  week: number;
  phase: string;
  deload: boolean;
  enduranceMin: number;
  acwr: number;
  stressCapped: number;
  notes: string[];
  sessions: PlanSessionView[];
}

/** The engine's week starts on Monday (`DAYS` in constants.ts). */
export const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export interface PlanDayView {
  /** Local midnight. */
  date: Date;
  /** yyyy-MM-dd in local time — a stable React key and the widget's day identity. */
  iso: string;
  weekNumber: number;
  phase: string;
  deload: boolean;
  /** "Mon".."Sun", as the engine names it. */
  dayName: string;
  /** AM before PM, then unslotted. */
  sessions: PlanSessionView[];
  totalMinutes: number;
  isRest: boolean;
  /**
   * Why this day is clear, derived only from the week around it and the
   * week's own deload flag. A rest day with a reason is a prescription; a
   * rest day with an invented reason is worse than a blank one, so nothing
   * here claims anything the plan did not already say.
   */
  restReason: string | null;
  /** Whole days from the calendar's anchor. Negative for days already gone. */
  offsetDays: number;
}

const SLOT_ORDER: Record<string, number> = { AM: 0, PM: 1 };

function slotRank(slot: string | null): number {
  if (slot == null) return 2;
  return SLOT_ORDER[slot] ?? 2;
}

/** Local-time yyyy-MM-dd. Deliberately not `toISOString`, which is UTC and slips a day. */
export function localIso(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * The Monday that week 1 begins on.
 *
 * `planStart` is when the plan was generated. Anything in week 1 dated before
 * it is genuinely in the past — the athlete generated a plan on a Thursday and
 * that week's Monday session was never theirs to do. The calendar shows those
 * days as past rather than pretending the block started on a Monday it did not.
 */
export function weekOneStart(planStart: Date): Date {
  return startOfWeek(startOfDay(planStart), { weekStartsOn: 1 });
}

export interface PlanCalendar {
  days: PlanDayView[];
  /** Index into `days` of the anchor date, or -1 when the anchor falls outside the block. */
  todayIndex: number;
  /** The anchor the calendar was built against, at local midnight. */
  today: Date;
  /** First and last dated day of the block. */
  firstDay: Date | null;
  lastDay: Date | null;
}

/**
 * Every day of the block, dated.
 *
 * @param weeks   The plan as the screen already holds it.
 * @param planStart When the plan was generated — the thing week 1 is anchored to.
 * @param today   The athlete's current local date. Injected so this is testable
 *                and so a paused plan can still be asked "where am I now".
 */
export function buildPlanCalendar(
  weeks: PlanWeekView[],
  planStart: Date,
  today: Date = new Date()
): PlanCalendar {
  const anchorDay = startOfDay(today);
  if (weeks.length === 0) {
    return { days: [], todayIndex: -1, today: anchorDay, firstDay: null, lastDay: null };
  }

  const monday = weekOneStart(planStart);
  const ordered = [...weeks].sort((a, b) => a.week - b.week);
  const firstWeekNumber = ordered[0]!.week;

  const days: PlanDayView[] = [];

  for (const week of ordered) {
    // Offset from the FIRST week in the array rather than from `week.week`
    // itself, so a plan whose weeks are numbered from something other than 1
    // still lands on consecutive calendar weeks.
    const weekOffset = week.week - firstWeekNumber;
    const byDay = new Map<string, PlanSessionView[]>();
    for (const session of week.sessions) {
      if (!session.day) continue; // unscheduled — surfaced separately, never silently dated
      const bucket = byDay.get(session.day);
      if (bucket) bucket.push(session);
      else byDay.set(session.day, [session]);
    }

    DAY_ORDER.forEach((dayName, i) => {
      const date = addDays(monday, weekOffset * 7 + i);
      const sessions = (byDay.get(dayName) ?? []).sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
      days.push({
        date,
        iso: localIso(date),
        weekNumber: week.week,
        phase: week.phase,
        deload: week.deload,
        dayName,
        sessions,
        totalMinutes: sessions.reduce((sum, s) => sum + s.minutes, 0),
        isRest: sessions.length === 0,
        restReason: null, // second pass — it needs the neighbours
        offsetDays: Math.round((date.getTime() - anchorDay.getTime()) / 86_400_000),
      });
    });
  }

  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    if (day.isRest) day.restReason = restReasonFor(days, i);
  }

  return {
    days,
    todayIndex: days.findIndex((d) => d.offsetDays === 0),
    today: anchorDay,
    firstDay: days[0]?.date ?? null,
    lastDay: days[days.length - 1]?.date ?? null,
  };
}

/** Sessions the scheduler could not place on a day. Shown, never hidden — a dropped session is a fact about the week. */
export function unscheduledSessions(week: PlanWeekView): PlanSessionView[] {
  return week.sessions.filter((s) => !s.day);
}

function sessionName(session: PlanSessionView): string {
  return session.label ?? KIND_LABEL[session.kind] ?? session.kind;
}

/**
 * What to say on a clear day.
 *
 * Every branch below is a restatement of something the plan already contains —
 * the week's deload flag, the sessions either side, how many days this week are
 * clear. Nothing here reaches for a reason the engine did not give, because a
 * plausible invented reason on a rest day is exactly the failure mode this
 * codebase has been burned by before.
 */
function restReasonFor(days: PlanDayView[], index: number): string {
  const day = days[index]!;
  const before = days[index - 1];
  const after = days[index + 1];

  const restDaysThisWeek = days.filter((d) => d.weekNumber === day.weekNumber && d.isRest).length;

  if (day.deload) {
    return `Deload week. This day is clear on purpose — the step back is the training, not a pause in it.`;
  }

  const hardBefore = before && !before.isRest && before.sessions.some((s) => s.isQuality);
  const hardAfter = after && !after.isRest && after.sessions.some((s) => s.isQuality);

  if (hardBefore && hardAfter) {
    return `Rest, between ${sessionName(before!.sessions[0]!)} yesterday and ${sessionName(after!.sessions[0]!)} tomorrow. The scheduler put a clear day here to keep those two apart.`;
  }
  if (hardBefore) {
    return `Rest after ${sessionName(before!.sessions[0]!)}. The session yesterday is what this day is for.`;
  }
  if (hardAfter) {
    return `Rest before ${sessionName(after!.sessions[0]!)} tomorrow.`;
  }
  if (before && !before.isRest && after && !after.isRest) {
    return `Rest, between ${sessionName(before.sessions[0]!)} yesterday and ${sessionName(after.sessions[0]!)} tomorrow.`;
  }

  return restDaysThisWeek === 1
    ? "Rest. This is the one clear day in your week."
    : `Rest. ${restDaysThisWeek} of the seven days this week are clear — that is the plan, not a gap in it.`;
}

export const PHASE_LABEL: Record<string, string> = {
  base: "Base",
  build: "Build",
  specific: "Specific",
  peak: "Peak",
  taper: "Taper",
};

export const KIND_LABEL: Record<string, string> = {
  easy_run: "Easy run",
  recovery_run: "Recovery run",
  long_run: "Long run",
  threshold_run: "Threshold",
  interval_run: "Intervals",
  rep_run: "Reps",
  squat_heavy: "Squat (heavy)",
  squat_volume: "Squat (volume)",
  bench_heavy: "Bench (heavy)",
  bench_volume: "Bench (volume)",
  deadlift_heavy: "Deadlift (heavy)",
  deadlift_volume: "Deadlift (volume)",
  strength_maintenance: "Strength maintenance",
  weak_lift_exposure: "Weak-lift exposure",
};

/** The athlete's own word for the session, falling back to the engine's. */
export function sessionTitle(session: PlanSessionView): string {
  return sessionName(session);
}

/** The engine's classification, only when it differs from what the athlete calls it. */
export function sessionSubtitle(session: PlanSessionView): string | null {
  if (!session.label) return null;
  const engine = KIND_LABEL[session.kind];
  return engine && engine !== session.label ? engine : null;
}

/** mm:ss from seconds — the same form the engine's own `mmss` prints. */
export function mmss(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * The two or three facts an athlete wants before they have read a word:
 * how far, how fast, how hard. Empty for a lift, which says everything it has
 * to say in its exercise lines.
 */
export interface SessionMetric {
  key: string;
  label: string;
  value: string;
  /**
   * How far and how long are single short figures and carry the session —
   * they get display size. Pace and heart rate are BANDS, twelve characters
   * wide, and setting them at the same size on a 375px screen breaks them
   * across two lines each and makes the whole block read as ragged. They are
   * qualifiers on the headline, and they are sized as qualifiers.
   */
  tier: "primary" | "secondary";
}

export function sessionMetrics(session: PlanSessionView): SessionMetric[] {
  const metrics: SessionMetric[] = [];
  if (session.distanceKm != null && session.distanceKm > 0) {
    metrics.push({
      key: "distance",
      label: "Distance",
      value: `${session.distanceKm.toFixed(1)} km`,
      tier: "primary",
    });
  }
  if (session.minutes > 0) {
    metrics.push({ key: "time", label: "Time", value: formatMinutes(session.minutes), tier: "primary" });
  }
  if (session.paceLoSPerKm != null && session.paceHiSPerKm != null) {
    metrics.push({
      key: "pace",
      label: "Pace",
      value: `${mmss(session.paceLoSPerKm)}–${mmss(session.paceHiSPerKm)}/km`,
      tier: "secondary",
    });
  }
  if (session.hrLo != null && session.hrHi != null) {
    metrics.push({
      key: "hr",
      label: "Heart rate",
      value: `${session.hrLo}–${session.hrHi} bpm`,
      tier: "secondary",
    });
  }
  return metrics;
}

export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

/**
 * A strength prescription is exercises joined with " · " (see
 * `prescribeLift`). One per line is how anyone actually reads a gym session,
 * and splitting a string the engine built is presentation, not invention —
 * nothing is added, reordered or dropped.
 */
export function exerciseLines(session: PlanSessionView): string[] {
  if (session.domain !== "strength") return [];
  return session.prescription
    .split(" · ")
    .map((line) => line.trim())
    .filter(Boolean);
}
