/**
 * Hybrid Plan Engine — what a rebuilt plan owes the plan it replaces.
 *
 * The engine regenerates the whole block from scratch on every request, and
 * savePlan writes a new block whenever the inputs changed. Logging a session
 * is itself an input change — the new run moves the diagnostic — so the
 * ordinary act of doing a prescribed session rebuilt the plan on the next
 * visit, and the rebuild rewrote the very week the athlete was in the middle
 * of. Observed live: a long run prescribed as 5.5km in 33min, logged as
 * written, and re-prescribed two minutes later as 6.2km in 37min with the
 * logged run attached to it.
 *
 * Two rules, both pure so they can be tested without a database:
 *
 *  1. A week the athlete has already logged a session from is FROZEN. The
 *     stored sessions for that week replace the regenerated ones, matched by
 *     calendar week rather than by week number, because a rebuild in a later
 *     calendar week re-anchors week one. The rebuild still applies from the
 *     next unlogged week on.
 *  2. A regenerated block whose sessions are the same rows as the stored one
 *     is the same block, whatever the diagnostic's row id says — see
 *     `weeksMatchStoredRows`, which savePlan uses to reuse instead of writing.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { startOfDay, startOfWeek } from "date-fns";
import type { EmphasisKey, Phase } from "./constants";
import type { PlanWeek } from "./engine";
import type { Placement } from "./scheduler";
import { stressFor, type PlannedSession, type SessionKind } from "./session-set";
import type { Finding, FindingId } from "./types";

const WEEK_MS = 7 * 86_400_000;

/** The Monday a plan generated at `date` calls week one. Same rule as the calendar's `weekOneStart`. */
export function mondayOf(date: Date): Date {
  return startOfWeek(startOfDay(date), { weekStartsOn: 1 });
}

/** Whole calendar weeks between two plans' week-one Mondays. Positive when `later` starts later. */
export function weekOffset(earlier: Date, later: Date): number {
  return Math.round((mondayOf(later).getTime() - mondayOf(earlier).getTime()) / WEEK_MS);
}

export interface StoredPlanSession {
  id: string;
  week: number;
  phase: Phase;
  isDeload: boolean;
  day: string | null;
  slot: string | null;
  kind: SessionKind;
  label: string | null;
  /** Written since migration 076's columns were put to use; null on older rows, where they are inferred from the kind. */
  lift: string | null;
  intensity: number | null;
  isHeavyLower: boolean | null;
  isDeadlift: boolean | null;
  stress: number | null;
  domain: "endurance" | "strength";
  emphasisKey: EmphasisKey;
  isQuality: boolean;
  minutes: number;
  distanceKm: number | null;
  paceLoSPerKm: number | null;
  paceHiSPerKm: number | null;
  hrLo: number | null;
  hrHi: number | null;
  hrSource: string | null;
  prescription: string;
  findingId: FindingId;
}

export interface PlanContinuity {
  planId: string;
  generatedAt: string;
  sessions: StoredPlanSession[];
  /** Sessions with an activity logged against them or a feedback answer. */
  loggedSessionIds: ReadonlySet<string>;
  /** The findings the stored sessions cite, by slug, so a frozen week can still say why. */
  findings: Finding[];
}

const COMPETITION_LIFTS = new Set(["squat", "bench", "deadlift"]);

/** A stored row back into the shape the engine builds. Stress is recomputed from the same table the engine used. */
export function sessionFromStored(r: StoredPlanSession): PlannedSession {
  const liftPrefix = r.kind.split("_")[0];
  const inferredLift = r.domain === "strength" && COMPETITION_LIFTS.has(liftPrefix) ? liftPrefix : undefined;
  const lift = r.lift ?? inferredLift;
  return {
    kind: r.kind,
    domain: r.domain,
    intensity: r.intensity ?? (r.isQuality ? 0.85 : 0.65),
    isQuality: r.isQuality,
    minutes: r.minutes,
    isHeavyLower: r.isHeavyLower ?? (r.kind === "squat_heavy" || r.kind === "deadlift_heavy"),
    isDeadlift: r.isDeadlift ?? r.kind.startsWith("deadlift"),
    ...(lift ? { lift } : {}),
    ...(r.label ? { label: r.label } : {}),
    prescription: {
      text: r.prescription,
      findingId: r.findingId,
      minutes: r.minutes,
      ...(r.distanceKm != null ? { distanceKm: r.distanceKm } : {}),
      ...(r.paceLoSPerKm != null ? { paceLoSPerKm: r.paceLoSPerKm } : {}),
      ...(r.paceHiSPerKm != null ? { paceHiSPerKm: r.paceHiSPerKm } : {}),
      ...(r.hrLo != null ? { hrLo: r.hrLo } : {}),
      ...(r.hrHi != null ? { hrHi: r.hrHi } : {}),
      ...(r.hrSource != null ? { hrSource: r.hrSource } : {}),
    },
    emphasisKey: r.emphasisKey,
    findingId: r.findingId,
    stress: r.stress ?? stressFor(r.kind, r.minutes, r.domain),
  };
}

export const FROZEN_WEEK_NOTE =
  "Kept exactly as it was when you logged a session from it. The plan has been rebuilt since, and a week you " +
  "are already in does not change underneath you — the rebuild applies from next week.";

/**
 * Replaces each regenerated week the athlete has already logged into with the
 * stored week it corresponds to. Returns the weeks to use, which weeks were
 * frozen, and the findings those weeks cite.
 */
export function freezeLoggedWeeks(
  weeks: PlanWeek[],
  continuity: PlanContinuity,
  now: Date
): { weeks: PlanWeek[]; frozenWeeks: number[]; findings: Finding[] } {
  if (continuity.loggedSessionIds.size === 0) return { weeks, frozenWeeks: [], findings: [] };
  const offset = weekOffset(new Date(continuity.generatedAt), now);

  const loggedWeeks = new Set<number>();
  for (const s of continuity.sessions) if (continuity.loggedSessionIds.has(s.id)) loggedWeeks.add(s.week);

  const frozenWeeks: number[] = [];
  const cited = new Set<FindingId>();
  const out = weeks.map((week) => {
    const storedWeek = week.week + offset;
    if (!loggedWeeks.has(storedWeek)) return week;
    const rows = continuity.sessions.filter((s) => s.week === storedWeek);
    if (rows.length === 0) return week;
    const placements: Placement[] = rows.map((r) => ({
      session: sessionFromStored(r),
      day: r.day ?? "",
      slot: (r.slot === "PM" ? "PM" : "AM") as Placement["slot"],
    }));
    for (const r of rows) cited.add(r.findingId);
    frozenWeeks.push(week.week);
    const sessions = placements.map((p) => p.session);
    const stress = sessions.reduce((s, x) => s + x.stress, 0);
    return {
      ...week,
      phase: rows[0].phase,
      deload: rows[0].isDeload,
      enduranceMin: sessions.filter((s) => s.domain === "endurance").reduce((s, x) => s + x.minutes, 0),
      sessions,
      placements,
      stress,
      stressCapped: stress,
      droppedSessions: [],
      notes: [FROZEN_WEEK_NOTE, ...week.notes.filter((n) => n !== FROZEN_WEEK_NOTE)],
    };
  });

  return {
    weeks: out,
    frozenWeeks,
    findings: continuity.findings.filter((f) => cited.has(f.id)),
  };
}

export interface StoredSessionKeyRow {
  week: number;
  day_of_week: string | null;
  slot: string | null;
  kind: string;
  minutes: unknown;
  distance_km: unknown;
  prescription: string | null;
}

function contentKey(
  week: number,
  day: string | null | undefined,
  slot: string | null | undefined,
  kind: string,
  minutes: unknown,
  distanceKm: unknown,
  prescription: string | null | undefined
): string {
  const m = minutes == null ? "" : Number(minutes).toFixed(1);
  const d = distanceKm == null ? "" : Number(distanceKm).toFixed(2);
  return `${week}|${day ?? ""}|${slot ?? ""}|${kind}|${m}|${d}|${prescription ?? ""}`;
}

/**
 * Whether a regenerated block would be stored as exactly the rows the current
 * block already holds. The stored diagnostic's row id changes whenever the
 * diagnostic is re-run, which happens whenever new training is logged — and
 * two plans with identical sessions were being written sixteen seconds apart
 * on that basis alone. Same rows, same block.
 */
export function weeksMatchStoredRows(weeks: PlanWeek[], rows: StoredSessionKeyRow[]): boolean {
  const generated = weeks
    .flatMap((w) =>
      w.placements.map((p) =>
        contentKey(
          w.week,
          p.day,
          p.slot,
          p.session.kind,
          p.session.minutes,
          p.session.prescription.distanceKm ?? null,
          p.session.prescription.text
        )
      )
    )
    .sort();
  const stored = rows
    .map((r) => contentKey(r.week, r.day_of_week, r.slot, r.kind, r.minutes, r.distance_km, r.prescription))
    .sort();
  if (generated.length !== stored.length) return false;
  return generated.every((k, i) => k === stored[i]);
}

/** The current block, its sessions, and which of them the athlete has logged into. Null when there is no block. */
export async function loadPlanContinuity(supabase: SupabaseClient, userId: string): Promise<PlanContinuity | null> {
  const { data: plan } = await supabase
    .from("hpe_plans")
    .select("id, profile_id, generated_at")
    .eq("user_id", userId)
    .is("superseded_at", null)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan) return null;

  const [{ data: sessionRows }, { data: findingRows }] = await Promise.all([
    supabase
      .from("hpe_sessions")
      .select(
        "id, week, phase, is_deload, day_of_week, slot, kind, label, lift, intensity, is_heavy_lower, is_deadlift, stress, domain, emphasis_key, is_quality, minutes, distance_km, pace_lo_s_per_km, pace_hi_s_per_km, hr_lo, hr_hi, hr_source, prescription, finding_id"
      )
      .eq("plan_id", plan.id as string),
    supabase.from("hpe_findings").select("id, finding_key, body").eq("profile_id", plan.profile_id as string),
  ]);

  const slugByRowId = new Map<string, FindingId>();
  const findings: Finding[] = [];
  for (const f of findingRows ?? []) {
    slugByRowId.set(f.id as string, f.finding_key as FindingId);
    findings.push({ id: f.finding_key as FindingId, text: f.body as string });
  }
  const num = (v: unknown): number | null => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

  const sessions: StoredPlanSession[] = (sessionRows ?? []).map((r) => ({
    id: r.id as string,
    week: Number(r.week),
    phase: r.phase as Phase,
    isDeload: Boolean(r.is_deload),
    day: (r.day_of_week as string | null) ?? null,
    slot: (r.slot as string | null) ?? null,
    kind: r.kind as SessionKind,
    label: (r.label as string | null) ?? null,
    lift: (r.lift as string | null) ?? null,
    intensity: num(r.intensity),
    isHeavyLower: r.is_heavy_lower == null ? null : Boolean(r.is_heavy_lower),
    isDeadlift: r.is_deadlift == null ? null : Boolean(r.is_deadlift),
    stress: num(r.stress),
    domain: r.domain === "strength" ? "strength" : "endurance",
    emphasisKey: r.emphasis_key as EmphasisKey,
    isQuality: Boolean(r.is_quality),
    minutes: num(r.minutes) ?? 0,
    distanceKm: num(r.distance_km),
    paceLoSPerKm: num(r.pace_lo_s_per_km),
    paceHiSPerKm: num(r.pace_hi_s_per_km),
    hrLo: num(r.hr_lo),
    hrHi: num(r.hr_hi),
    hrSource: (r.hr_source as string | null) ?? null,
    prescription: (r.prescription as string | null) ?? "",
    findingId: slugByRowId.get(r.finding_id as string) ?? ("hybrid-baseline" as FindingId),
  }));
  const ids = sessions.map((s) => s.id);
  const logged = new Set<string>();
  if (ids.length > 0) {
    const [{ data: activities }, { data: feedback }] = await Promise.all([
      supabase.from("activities").select("hpe_session_id").eq("user_id", userId).in("hpe_session_id", ids),
      supabase.from("hpe_session_feedback").select("session_id").eq("user_id", userId).in("session_id", ids),
    ]);
    for (const a of activities ?? []) if (a.hpe_session_id) logged.add(a.hpe_session_id as string);
    for (const f of feedback ?? []) if (f.session_id) logged.add(f.session_id as string);
  }

  return {
    planId: plan.id as string,
    generatedAt: plan.generated_at as string,
    sessions,
    loggedSessionIds: logged,
    findings,
  };
}
