import type {
  DailyTrainingDayPayload,
  DailyTrainingPayload,
  DailyTrainingSessionPayload,
} from "@/lib/native/daily-training";
import {
  buildPlanCalendar,
  exerciseLines,
  mmss,
  PHASE_LABEL,
  sessionTitle,
  type PlanDayView,
  type PlanSessionView,
  type PlanWeekView,
} from "./plan-calendar";

/**
 * Turns the plan the screen is already rendering into the payload the
 * home-screen widget reads.
 *
 * Everything here is a RESTATEMENT of what the engine produced. Nothing is
 * derived, rounded into a new claim, or filled in. That constraint is the
 * whole reason this is a separate, tested module rather than an inline object
 * literal in the screen: the widget is the one surface with no room for a
 * caveat, and this codebase has already shipped a placeholder to a home screen
 * that an athlete read as real for a week.
 *
 * The three statuses are genuinely different situations with different
 * answers, and collapsing any two of them would put the wrong sentence in
 * front of someone:
 *
 *   ready         — a plan exists and covers today (a REST day included)
 *   betweenBlocks — a plan exists, today is outside its dates: build a new one
 *   noPlan        — the engine has not built one: finish the intake
 */

/** How many days to publish. Enough for the widget's timeline to roll over for a working week without the app. */
export const WIDGET_HORIZON_DAYS = 7;

/**
 * The one line the widget shows under a session's name.
 *
 * Endurance: the numbers, because that is what the athlete needs at 7am.
 * Strength: the lift that leads the session, and an honest count of the rest —
 * a gym session summarised to its first exercise alone would understate the
 * work, so the remainder is named rather than dropped.
 */
export function widgetDetail(session: PlanSessionView): string {
  if (session.domain === "strength") {
    const lines = exerciseLines(session);
    if (lines.length === 0) return firstSentence(session.prescription);
    const [lead, ...rest] = lines;
    return rest.length > 0 ? `${lead!} · +${rest.length} more` : lead!;
  }

  const parts: string[] = [];
  if (session.distanceKm != null && session.distanceKm > 0) {
    parts.push(`${session.distanceKm.toFixed(1)} km`);
  }
  if (session.paceLoSPerKm != null && session.paceHiSPerKm != null) {
    parts.push(`${mmss(session.paceLoSPerKm)}–${mmss(session.paceHiSPerKm)}/km`);
  }
  if (session.hrLo != null && session.hrHi != null) {
    parts.push(`HR ${session.hrLo}–${session.hrHi}`);
  }
  // No structured numbers at all — an interval session's shape lives in its
  // sentence. Take the sentence rather than inventing a summary of it.
  return parts.length > 0 ? parts.join(" · ") : firstSentence(session.prescription);
}

/** First sentence, capped. Cuts on a boundary the engine wrote; never mid-number. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const stop = trimmed.indexOf(". ");
  const sentence = stop > 0 ? trimmed.slice(0, stop + 1) : trimmed;
  if (sentence.length <= 90) return sentence;
  const cut = sentence.lastIndexOf(" ", 88);
  return `${sentence.slice(0, cut > 0 ? cut : 88)}…`;
}

export function widgetWeekLabel(day: PlanDayView): string {
  const phase = PHASE_LABEL[day.phase] ?? day.phase;
  return day.deload ? `Week ${day.weekNumber} · ${phase} · deload` : `Week ${day.weekNumber} · ${phase}`;
}

function toSessionPayload(session: PlanSessionView): DailyTrainingSessionPayload {
  return {
    title: sessionTitle(session),
    detail: widgetDetail(session),
    // Omitted rather than sent empty: the Swift side treats an absent slot as
    // "not slotted", which is the truth for an unslotted session.
    ...(session.slot ? { slot: session.slot } : {}),
    domain: session.domain,
    minutes: Math.round(session.minutes),
    isQuality: session.isQuality,
  };
}

function toDayPayload(day: PlanDayView): DailyTrainingDayPayload {
  return {
    date: day.iso,
    isRest: day.isRest,
    // A rest day always carries its reason — that is what makes it a
    // prescription on the home screen rather than a blank.
    ...(day.isRest && day.restReason ? { restReason: day.restReason } : {}),
    weekLabel: widgetWeekLabel(day),
    totalMinutes: Math.round(day.totalMinutes),
    sessions: day.isRest ? [] : day.sessions.map(toSessionPayload),
  };
}

export interface DailyWidgetInput {
  /** The plan as the screen holds it. Empty when the engine refused. */
  weeks: PlanWeekView[];
  /** What week 1 is anchored to — when the plan was generated. */
  planStart: Date;
  /** The athlete's current local date. Injected so this is testable. */
  today?: Date;
  /**
   * The engine's own words for why there is no plan, when there is none.
   * Passed through rather than reworded here: the refusal text is the
   * product, and a widget paraphrasing it would be a second source of truth.
   */
  refusalReason?: string | null;
  /** True when the athlete's next step is the intake form. */
  needsIntake?: boolean;
}

export function buildDailyTrainingPayload({
  weeks,
  planStart,
  today = new Date(),
  refusalReason,
  needsIntake,
}: DailyWidgetInput): DailyTrainingPayload {
  if (weeks.length === 0) {
    // Order matters: a concrete action beats a description of the problem.
    // "Finish your intake" is something the athlete can do from the home
    // screen; the refusal sentence is only worth showing when there is no
    // action to name.
    return {
      status: "noPlan",
      headline: "No plan yet",
      message: needsIntake
        ? "Finish your intake"
        : refusalReason
          ? shorten(refusalReason)
          : "Open Split Index",
    };
  }

  const calendar = buildPlanCalendar(weeks, planStart, today);

  if (calendar.todayIndex < 0) {
    // A plan exists; today is not in it. Saying "no plan" here would send the
    // athlete to an intake form they have already filled in.
    const started = (calendar.days[0]?.offsetDays ?? 0) > 0;
    return {
      status: "betweenBlocks",
      headline: started ? "Block not started" : "Block finished",
      message: started ? "Your plan starts later" : "Build your next block",
    };
  }

  const days = calendar.days
    .slice(calendar.todayIndex, calendar.todayIndex + WIDGET_HORIZON_DAYS)
    .map(toDayPayload);

  // Defensive, and deliberately not silent: `todayIndex >= 0` should guarantee
  // a day here. If the slice ever came back empty the widget must fall back to
  // a message rather than publish a "ready" with nothing in it.
  if (days.length === 0) {
    return { status: "noPlan", headline: "No plan yet", message: "Open Split Index" };
  }

  return { status: "ready", days };
}

function shorten(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 70) return trimmed;
  const cut = trimmed.lastIndexOf(" ", 68);
  return `${trimmed.slice(0, cut > 0 ? cut : 68)}…`;
}
