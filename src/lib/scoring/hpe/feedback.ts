/**
 * Hybrid Plan Engine — the feedback loop's other half.
 *
 * F16 asked for autoregulation from logged session feedback, and
 * `autoregulate` in progression.ts has done the arithmetic since Rev C. What
 * it never had was an input: `hpe_session_feedback` had readers and no writer,
 * and the route never passed `feedbackByWeek`. The loop was library code.
 *
 * Two sources now feed it, and neither requires the athlete to fill in a form
 * they were never shown:
 *
 *  1. THE ACTIVITY LOG. Split Index already records every session the athlete
 *     does — duration, distance, sport, and an RPE where they gave one. A
 *     planned session on a given day is matched to a logged activity of the
 *     same domain on that day (or within a day either side, because athletes
 *     move sessions). Completion, whether the prescribed duration was met,
 *     and the session RPE all come from that row. This is the 4BEAT-style
 *     auto-capture the assurance review said would "remove the compliance
 *     problem entirely", done with the data the app already has.
 *
 *  2. EXPLICIT FEEDBACK. Where the athlete has logged feedback against a
 *     stored session through the feedback endpoint, it wins over the
 *     inference — an athlete saying "I did not do this" beats a matching
 *     activity that might have been something else.
 *
 * The output is keyed by the plan week the feedback is FOR, which is what
 * `generatePlan` reads: week W adjusts on the feedback for week W−1.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlanWeek } from "./engine";
import type { SessionFeedback } from "./progression";
import { DAYS } from "./constants";

export interface LoggedActivity {
  startedAt: string;
  sport: string;
  durationSeconds: number;
  rpe: number | null;
}

export interface ExplicitFeedback {
  week: number;
  dayOfWeek: string | null;
  kind: string;
  completed: boolean;
  sessionRpe: number | null;
  metPrescription: boolean;
  /** F17 — the athlete marked this day a bad one. Swaps the day's hardest session for an easy one. */
  lowCapacity: boolean;
  loggedAt: string;
}

/** A logged activity counts toward a planned session if it is on the same side of the hybrid. */
function domainOf(sport: string): "endurance" | "strength" | null {
  if (sport === "gym") return "strength";
  if (["run", "row", "bike", "swim", "ski", "walk", "hike"].includes(sport)) return "endurance";
  return null;
}

/** Local date key, yyyy-MM-dd. */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  out.setDate(out.getDate() + n);
  return out;
}

/** The prescribed duration counts as met at this share of it or more. */
const MET_DURATION_SHARE = 0.85;

/**
 * Derives per-week feedback for the weeks of a block that are already in the
 * past, by matching planned sessions to what was actually logged.
 *
 * `startsOn` is the Monday of week one (yyyy-MM-dd); only weeks that have
 * fully elapsed by `today` are assessed — a week in progress has sessions
 * that have not happened yet, and counting those as missed would trigger a
 * reduction on a Tuesday for the sessions of Thursday.
 */
export function deriveFeedbackFromActivities(
  weeks: PlanWeek[],
  activities: LoggedActivity[],
  startsOn: string,
  today: Date = new Date(),
  explicit: ExplicitFeedback[] = []
): Record<number, SessionFeedback[]> {
  const [y, m, d] = startsOn.split("-").map(Number);
  const weekOne = new Date(y, m - 1, d);
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const byDay = new Map<string, LoggedActivity[]>();
  for (const a of activities) {
    const when = new Date(a.startedAt);
    if (Number.isNaN(when.getTime())) continue;
    const key = dayKey(when);
    byDay.set(key, [...(byDay.get(key) ?? []), a]);
  }
  const used = new Set<LoggedActivity>();

  const explicitFor = (week: number, day: string | null, kind: string) =>
    explicit.find((e) => e.week === week && e.kind === kind && (e.dayOfWeek == null || e.dayOfWeek === day));

  const out: Record<number, SessionFeedback[]> = {};
  for (const w of weeks) {
    const weekStart = addDays(weekOne, (w.week - 1) * 7);
    const weekEnd = addDays(weekStart, 7);
    if (weekEnd.getTime() > anchor.getTime()) continue; // still in progress or future

    const feedback: SessionFeedback[] = [];
    for (const p of w.placements) {
      const dayIdx = DAYS.indexOf(p.day as (typeof DAYS)[number]);
      if (dayIdx < 0) continue;
      const plannedDay = addDays(weekStart, dayIdx);

      const stated = explicitFor(w.week, p.day, p.session.kind);
      if (stated) {
        feedback.push({
          kind: p.session.kind,
          completed: stated.completed,
          sessionRpe: stated.sessionRpe,
          metPrescription: stated.metPrescription,
          loggedAt: stated.loggedAt,
        });
        continue;
      }

      const wantDomain = p.session.domain;
      let match: LoggedActivity | null = null;
      for (const offset of [0, 1, -1]) {
        const candidates = (byDay.get(dayKey(addDays(plannedDay, offset))) ?? []).filter(
          (a) => !used.has(a) && domainOf(a.sport) === wantDomain
        );
        if (candidates.length > 0) {
          // Closest in duration to the prescription.
          match = candidates.sort(
            (a, b) =>
              Math.abs(a.durationSeconds / 60 - p.session.minutes) - Math.abs(b.durationSeconds / 60 - p.session.minutes)
          )[0];
          break;
        }
      }
      if (match) used.add(match);
      const minutesDone = match ? match.durationSeconds / 60 : 0;
      feedback.push({
        kind: p.session.kind,
        completed: match != null,
        sessionRpe: match?.rpe ?? null,
        metPrescription: match != null && minutesDone >= p.session.minutes * MET_DURATION_SHARE,
        loggedAt: match ? match.startedAt : addDays(plannedDay, 1).toISOString(),
      });
    }
    out[w.week] = feedback;
  }
  return out;
}

/**
 * The athlete's actual running volume over the last `weeks` weeks, the anchor
 * the continued ramp restarts from. Null when nothing is logged in the window.
 */
export function recentRunMinutesPerWeek(activities: LoggedActivity[], weeks = 2, today: Date = new Date()): number | null {
  const cutoff = today.getTime() - weeks * 7 * 86_400_000;
  const recent = activities.filter((a) => a.sport === "run" && new Date(a.startedAt).getTime() >= cutoff);
  if (recent.length === 0) return null;
  return recent.reduce((s, a) => s + a.durationSeconds, 0) / 60 / weeks;
}

/** Reads the two feedback sources for a plan. Never throws — an unreadable log means no autoregulation, not no plan. */
export async function loadFeedbackSources(
  supabase: SupabaseClient,
  userId: string,
  planId: string | null,
  sinceIso: string
): Promise<{ activities: LoggedActivity[]; explicit: ExplicitFeedback[] }> {
  try {
    const [{ data: activityRows }, feedbackRes] = await Promise.all([
      supabase
        .from("activities")
        .select("started_at, sport, duration_seconds, rpe")
        .eq("user_id", userId)
        .eq("is_draft", false)
        .gte("started_at", sinceIso),
      planId
        ? supabase
            .from("hpe_session_feedback")
            .select(
              "logged_at, completed, met_prescription, session_rpe, low_capacity_flagged, " +
                "hpe_sessions!inner(plan_id, week, day_of_week, kind)"
            )
            .eq("user_id", userId)
            .eq("hpe_sessions.plan_id", planId)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    ]);
    const activities: LoggedActivity[] = (activityRows ?? []).map((r) => ({
      startedAt: r.started_at as string,
      sport: r.sport as string,
      durationSeconds: Number(r.duration_seconds ?? 0),
      rpe: r.rpe != null ? Number(r.rpe) : null,
    }));
    const explicit: ExplicitFeedback[] = ((feedbackRes.data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const s = (Array.isArray(r.hpe_sessions) ? r.hpe_sessions[0] : r.hpe_sessions) as Record<string, unknown>;
      return {
        week: Number(s?.week ?? 0),
        dayOfWeek: (s?.day_of_week as string | null) ?? null,
        kind: (s?.kind as string) ?? "",
        completed: Boolean(r.completed),
        sessionRpe: r.session_rpe != null ? Number(r.session_rpe) : null,
        metPrescription: Boolean(r.met_prescription),
        lowCapacity: Boolean(r.low_capacity_flagged),
        loggedAt: r.logged_at as string,
      };
    });
    return { activities, explicit };
  } catch {
    return { activities: [], explicit: [] };
  }
}
