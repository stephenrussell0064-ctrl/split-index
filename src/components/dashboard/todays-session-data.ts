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
  };
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
export function toPlanWeeks(raw: StoredWeek[]): PlanWeekView[] {
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

  const weeks = toPlanWeeks((stored.weeks ?? []) as StoredWeek[]);
  if (weeks.length === 0) return null;

  return buildDailyTrainingPayload({
    weeks,
    planStart: new Date(stored.generatedAt),
    today,
  });
}
