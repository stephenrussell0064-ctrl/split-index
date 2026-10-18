import type { SupabaseClient } from "@supabase/supabase-js";
import { loadLatestStoredPlan } from "@/lib/scoring/hpe/persistence";
import { buildDailyTrainingPayload } from "@/components/hybrid-plan/daily-widget-payload";
import type { PlanSessionView, PlanWeekView } from "@/components/hybrid-plan/plan-calendar";
import type { DailyTrainingPayload } from "@/lib/native/daily-training";

/**
 * What the dashboard shows for "today's session".
 *
 * WHY THE STORED PLAN AND NOT `/api/hpe/plan`: that endpoint GENERATES a plan.
 * Calling it to draw one card would run the whole engine, write a telemetry
 * row and persist a new plan on every dashboard load — a read that has side
 * effects. `loadLatestStoredPlan` is two selects against the plan the engine
 * already committed, which is also the plan the athlete is actually training.
 *
 * The consequence is worth stating plainly: this card shows the LAST STORED
 * plan. If the engine would build a different one right now, the dashboard
 * will not know until the athlete opens /hybrid-plan and it regenerates. That
 * is the honest trade — a stale-but-real plan beats a fabricated fresh one,
 * and the card links straight through to the screen that refreshes it.
 *
 * Anchoring: week 1 belongs to the week the plan was GENERATED in, never to
 * today. Anchoring a stored block to today would slide it forward and tell an
 * athlete in week 4 they were in week 1.
 */

export interface StoredPlacement {
  /** The `hpe_sessions` row, when the stored plan carries it. */
  sessionId?: string;
  day: string | null;
  slot: string | null;
  session: {
    kind: string;
    domain: "endurance" | "strength";
    minutes: number;
    isQuality: boolean;
    findingId: string;
    emphasisKey: string;
    prescription: { text: string };
    label?: string;
    distanceKm?: number | null;
    paceLoSPerKm?: number | null;
    paceHiSPerKm?: number | null;
    hrLo?: number | null;
    hrHi?: number | null;
  };
}

/** What has been logged against which session: the activity, and the three-button answer. */
export interface LoggedState {
  activityBySession: Record<string, string>;
  feedbackBySession: Record<string, "hit" | "short" | "missed">;
}

export interface StoredWeek {
  week: number;
  phase: string;
  deload: boolean;
  enduranceMin: number;
  acwr: number;
  stressCapped: number;
  notes: string[];
  placements: StoredPlacement[];
}

/**
 * The same mapping the plan screen performs on a live response, over the rows
 * `loadLatestStoredPlan` regroups into that identical shape.
 *
 * Note what is absent: the stored rows carry the prescription SENTENCE but not
 * its structured half (distance, pace band, heart-rate band), because
 * `loadLatestStoredPlan` does not map those columns back onto `prescription`.
 * Nothing is invented to fill the gap — `widgetDetail` falls back to the
 * engine's own sentence, which is a real prescription rather than a summary of
 * one.
 */
export function toPlanWeeks(raw: StoredWeek[], logged?: LoggedState): PlanWeekView[] {
  return raw.map((w) => ({
    week: w.week,
    phase: w.phase,
    deload: w.deload,
    enduranceMin: w.enduranceMin,
    acwr: w.acwr,
    stressCapped: w.stressCapped,
    notes: w.notes,
    sessions: w.placements.map(
      (p): PlanSessionView => ({
        sessionId: p.sessionId ?? null,
        activityId: p.sessionId ? logged?.activityBySession[p.sessionId] ?? null : null,
        feedback: p.sessionId ? logged?.feedbackBySession[p.sessionId] ?? null : null,
        kind: p.session.kind,
        domain: p.session.domain,
        day: p.day,
        slot: p.slot,
        minutes: p.session.minutes,
        isQuality: p.session.isQuality,
        findingId: p.session.findingId as PlanSessionView["findingId"],
        emphasisKey: p.session.emphasisKey,
        prescription: p.session.prescription.text,
        label: p.session.label,
        // Present since the stored plan started carrying them; absent — not
        // null — on rows that do not, so the widget's detail line falls back
        // to the prescription's first sentence exactly as before.
        ...(p.session.distanceKm != null ? { distanceKm: p.session.distanceKm } : {}),
        ...(p.session.paceLoSPerKm != null ? { paceLoSPerKm: p.session.paceLoSPerKm } : {}),
        ...(p.session.paceHiSPerKm != null ? { paceHiSPerKm: p.session.paceHiSPerKm } : {}),
        ...(p.session.hrLo != null ? { hrLo: p.session.hrLo } : {}),
        ...(p.session.hrHi != null ? { hrHi: p.session.hrHi } : {}),
      })
    ),
  }));
}

/** Null when the engine has never stored a plan for this athlete — the one state where "set one up" is the answer. */
export async function loadTodaysSessionPayload(
  supabase: SupabaseClient,
  userId: string,
  today: Date = new Date()
): Promise<DailyTrainingPayload | null> {
  // Never allowed to take the dashboard down. A plan card that cannot load is
  // a missing card; a dashboard that 500s because of it is a broken app.
  const stored = await loadLatestStoredPlan(supabase, userId).catch(() => null);
  if (!stored) return null;

  const rawWeeks = (stored.weeks ?? []) as StoredWeek[];
  /*
    What has been logged against today's sessions. The card used to be built
    from the stored prescriptions alone, so a long run logged from the plan
    — "Logged" on the plan screen itself — still read on the dashboard as a
    session to go and do. Same two reads the plan route makes.
  */
  const logged = await loadLoggedState(supabase, userId, rawWeeks).catch(
    (): LoggedState => ({ activityBySession: {}, feedbackBySession: {} })
  );
  const weeks = toPlanWeeks(rawWeeks, logged);
  if (weeks.length === 0) return null;

  return buildDailyTrainingPayload({
    weeks,
    planStart: new Date(stored.generatedAt),
    today,
  });
}

export async function loadLoggedState(
  supabase: SupabaseClient,
  userId: string,
  weeks: StoredWeek[]
): Promise<LoggedState> {
  const ids = weeks.flatMap((w) => w.placements.map((p) => p.sessionId)).filter((id): id is string => !!id);
  const out: LoggedState = { activityBySession: {}, feedbackBySession: {} };
  if (ids.length === 0) return out;
  const [{ data: activities }, { data: feedback }] = await Promise.all([
    supabase
      .from("activities")
      .select("id, hpe_session_id")
      .eq("user_id", userId)
      .eq("is_draft", false)
      .in("hpe_session_id", ids),
    supabase
      .from("hpe_session_feedback")
      .select("session_id, completed, met_prescription")
      .eq("user_id", userId)
      .in("session_id", ids),
  ]);
  for (const a of activities ?? []) {
    if (typeof a.hpe_session_id === "string" && typeof a.id === "string") {
      out.activityBySession[a.hpe_session_id] ??= a.id;
    }
  }
  for (const f of feedback ?? []) {
    if (typeof f.session_id !== "string") continue;
    // The same reading the plan route gives the three-button answer.
    out.feedbackBySession[f.session_id] = !f.completed ? "missed" : f.met_prescription ? "hit" : "short";
  }
  return out;
}
