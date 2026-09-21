/**
 * Hybrid Plan Engine — diagnostic and plan persistence.
 *
 * The diagnostic used to be recomputed on every request and discarded. That
 * is enough to prescribe today's session and not enough for the Rev 2
 * addition to WP8: "the diagnostic re-runs every four weeks against
 * accumulating data. If the emphasis vector shifts by more than 0.10 on any
 * dimension, the remaining macrocycle is regenerated and the athlete is shown
 * what changed and why."
 *
 * A comparison needs a previous value. Without this module `compareEmphasis`
 * is correct code that can never fire — an adaptation loop with nothing on
 * the other end of it.
 *
 * Two design points worth stating:
 *
 *  - A profile is written when the diagnosis MEANINGFULLY changes, not on
 *    every page load. Writing per request would fill the table with
 *    duplicates and make drift analysis measure request volume rather than
 *    adaptation.
 *  - Findings are rows, not a JSON blob on the profile, because
 *    `hpe_sessions.finding_id` is a NOT NULL foreign key to them. That is
 *    what makes non-negotiable #7 enforced by the database rather than
 *    honoured by convention.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DIAGNOSTIC_RERUN_WEEKS, EMPHASIS_KEYS, type EmphasisKey } from "./constants";
import { compareEmphasis, type EmphasisDrift } from "./progression";
import type { AthleteProfile, EmphasisVector, Finding, FindingId } from "./types";
import type { PlanWeek } from "./engine";
import type { Goal, Constraints } from "./intake";
import type { ProfileObservation } from "./response";

/** A previously stored diagnostic run, reduced to what the re-run comparison needs. */
export interface StoredProfileSummary {
  id: string;
  generatedAt: string;
  constantsVersion: string;
  tier: number;
  emphasis: EmphasisVector;
}

export async function loadLatestStoredProfile(
  supabase: SupabaseClient,
  userId: string
): Promise<StoredProfileSummary | null> {
  const { data, error } = await supabase
    .from("hpe_athlete_profile")
    .select("id, generated_at, constants_version, tier, emphasis")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const emphasis = data.emphasis as Partial<EmphasisVector> | null;
  if (!emphasis) return null;
  // A stored vector missing a dimension is a vector written under a different
  // constants version. Treat it as absent rather than silently defaulting the
  // gap to zero, which would report "no drift" on exactly the runs where the
  // engine changed underneath the athlete.
  if (EMPHASIS_KEYS.some((k) => typeof emphasis[k] !== "number")) return null;

  return {
    id: data.id as string,
    generatedAt: data.generated_at as string,
    constantsVersion: data.constants_version as string,
    tier: Number(data.tier),
    emphasis: emphasis as EmphasisVector,
  };
}

export interface RerunDecision {
  /** Whether enough time has passed to re-diagnose at all. */
  due: boolean;
  weeksSinceLastRun: number | null;
  /** Null on a first run — there is nothing to compare against, which is not the same as no drift. */
  drift: EmphasisDrift | null;
  /** True when the remaining macrocycle should be regenerated and the change explained. */
  shouldRegenerate: boolean;
  /** What the athlete is told. Empty on a first run. */
  explanations: string[];
}

/**
 * The four-weekly loop. `previous` comes from `loadLatestStoredProfile`;
 * `next` is the diagnosis just computed from current data.
 *
 * A constants-version change forces regeneration regardless of drift: if the
 * numbers governing training logic moved, the athlete's plan was built under
 * rules that no longer apply, and that is exactly the case the version stamp
 * exists to catch.
 */
export function evaluateRerun(
  previous: StoredProfileSummary | null,
  next: AthleteProfile,
  now: Date = new Date()
): RerunDecision {
  if (!previous) {
    return { due: true, weeksSinceLastRun: null, drift: null, shouldRegenerate: false, explanations: [] };
  }

  const weeksSinceLastRun = (now.getTime() - new Date(previous.generatedAt).getTime()) / (7 * 86_400_000);
  const due = weeksSinceLastRun >= DIAGNOSTIC_RERUN_WEEKS;
  const drift = compareEmphasis(previous.emphasis, next.emphasis);

  const constantsChanged = previous.constantsVersion !== next.constantsVersion;
  const explanations = [...drift.explanations];
  if (constantsChanged) {
    explanations.push(
      `The training-logic constants moved from ${previous.constantsVersion} to ${next.constantsVersion} since your ` +
        `plan was built, so it has been regenerated under the current rules rather than left on the old ones.`
    );
  }
  // A tier change is worth telling the athlete about even when the vector
  // barely moved: it means their diagnosis just got more (or less) confident,
  // and the prescribed bands narrow or widen accordingly.
  if (next.tier > previous.tier) {
    explanations.push(
      `Your data-sufficiency tier rose from ${previous.tier} to ${next.tier}. The prescribed bands narrow because ` +
        `there is more of your own history behind them now.`
    );
  }

  return {
    due,
    weeksSinceLastRun,
    drift,
    shouldRegenerate: due && (drift.shouldRegenerate || constantsChanged || next.tier !== previous.tier),
    explanations,
  };
}

/**
 * Writes a diagnostic run and its findings. Returns the new profile id and a
 * map from finding slug to row id, which is what plan persistence needs to
 * satisfy the NOT NULL foreign key on `hpe_sessions.finding_id`.
 */
export async function saveProfile(
  supabase: SupabaseClient,
  userId: string,
  profile: AthleteProfile
): Promise<{ profileId: string; findingIds: Map<FindingId, string> } | null> {
  const { data: inserted, error } = await supabase
    .from("hpe_athlete_profile")
    .insert({
      user_id: userId,
      constants_version: profile.constantsVersion,
      tier: profile.tier,
      confidence: profile.confidence,
      limiter: profile.limiter,
      emphasis: profile.emphasis,
      weekly_volume_km: profile.weeklyVolumeKm,
      weekly_volume_min: profile.weeklyVolumeMin,
      longest_run_km: profile.longestRunKm,
      riegel_k: profile.riegelK,
      riegel_verdict: profile.riegelVerdict,
      decoupling: profile.decoupling,
      decoupling_verdict: profile.decouplingVerdict,
      easy_fraction: profile.easyFraction,
      easy_fraction_source: profile.easyFractionSource,
      intensity_verdict: profile.intensityVerdict,
      volume_adequacy: profile.volumeAdequacy,
      speed_reserve_ms: profile.speedReserveMs,
      maximal_sprint_speed_ms: profile.maximalSprintSpeedMs,
      maximal_aerobic_speed_ms: profile.maximalAerobicSpeedMs,
      predicted_5k_s: profile.predicted5kS,
      predicted_5k_from_effort: profile.predicted5kFromEffort,
      threshold_pace_s_per_km: profile.thresholdPaceSPerKm,
      vo2max_pace_s_per_km: profile.vo2maxPaceSPerKm,
      hr_max: profile.hrMax,
      hr_rest: profile.hrRest,
      hr_max_source: profile.hrMaxSource,
      runs_inside_easy_band: profile.runsInsideEasyBand,
      quality_session_count: profile.qualitySessionCount,
      easy_band: profile.easyBand,
      hr_pace_model: profile.hrPaceModel,
      one_rms: profile.oneRms,
      rep_profile_gap: profile.repProfileGap,
      rep_profile_verdict: profile.repProfileVerdict,
      weak_lift: profile.weakLift,
      lift_ratios: profile.liftRatios,
      stalled_lifts: profile.stalledLifts,
      data_gaps: profile.dataGaps,
    })
    .select("id")
    .single();

  if (error || !inserted) return null;
  const profileId = inserted.id as string;

  const findingIds = new Map<FindingId, string>();
  if (profile.findings.length > 0) {
    const { data: findingRows } = await supabase
      .from("hpe_findings")
      .insert(
        profile.findings.map((f: Finding, i: number) => ({
          profile_id: profileId,
          finding_key: f.id,
          body: f.text,
          ordinal: i,
        }))
      )
      .select("id, finding_key");
    for (const row of findingRows ?? []) {
      findingIds.set(row.finding_key as FindingId, row.id as string);
    }
  }

  // Sessions that exist to keep the hybrid balanced rather than to answer a
  // specific finding still need something to point at, or they cannot be
  // stored at all. This is a real, readable rationale, not a null in disguise.
  if (!findingIds.has("hybrid-baseline")) {
    const { data: baseline } = await supabase
      .from("hpe_findings")
      .insert({
        profile_id: profileId,
        finding_key: "hybrid-baseline",
        body:
          "Baseline hybrid coverage. This session is not answering a specific finding about you — it is here so " +
          "that no movement pattern and neither side of the hybrid goes untrained while your priorities get the " +
          "rest of the week.",
        ordinal: profile.findings.length,
      })
      .select("id, finding_key")
      .single();
    if (baseline) findingIds.set("hybrid-baseline", baseline.id as string);
  }

  return { profileId, findingIds };
}

/**
 * Persists a generated plan and every session in it. Any session whose
 * finding has no stored row is DROPPED rather than stored with a placeholder
 * — the foreign key is the enforcement point for non-negotiable #7, and
 * working around it here would defeat the reason it is NOT NULL.
 */
/**
 * A stable fingerprint of what a plan was built FOR. When it changes, the
 * block is a different block and is rebuilt from week one; when it holds, a
 * new generation continues the existing block from its current week.
 */
export function goalHash(goal: Goal, constraints: Constraints, constantsVersion: string): string {
  const stable = JSON.stringify({ goal, constraints, constantsVersion }, Object.keys({ ...goal, ...constraints, constantsVersion }).sort());
  // FNV-1a, 32-bit — a fingerprint, not a secret.
  let hash = 0x811c9dc5;
  for (let i = 0; i < stable.length; i++) {
    hash ^= stable.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** The Monday of the local week containing `date`, as yyyy-MM-dd. */
export function mondayOf(date: Date): string {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - day);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/** Which plan week (1-based) `today` falls in for a block whose week one began on `startsOn` (yyyy-MM-dd, a Monday). */
export function planWeekFor(startsOn: string, today: Date = new Date()): number {
  const [y, m, d] = startsOn.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  const anchor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((anchor.getTime() - start.getTime()) / 86_400_000);
  return Math.floor(days / 7) + 1;
}

export async function savePlan(
  supabase: SupabaseClient,
  userId: string,
  args: {
    profileId: string;
    findingIds: Map<FindingId, string>;
    constantsVersion: string;
    goal: Goal;
    constraints: Constraints;
    weeks: PlanWeek[];
    eventDate?: string | null;
    /** Monday of week one, yyyy-MM-dd. Defaults to this week's Monday. */
    startsOn?: string;
    /** The week this generation started from — 1 for a fresh block. */
    generatedForWeek?: number;
  }
): Promise<{ planId: string; storedSessions: number; droppedSessions: number } | null> {
  const weekMeta: Record<string, unknown> = {};
  for (const w of args.weeks) {
    weekMeta[String(w.week)] = {
      notes: w.notes,
      allocation: w.allocation,
      stress: w.stress,
      stressCapped: w.stressCapped,
      acwr: w.acwr,
      penalty: w.penalty,
      hardPenalty: w.hardPenalty,
      phaseProgress: w.phaseProgress,
      enduranceMin: w.enduranceMin,
      travel: w.travel ?? false,
      delivered: w.delivered ?? null,
    };
  }
  const { data: plan, error } = await supabase
    .from("hpe_plans")
    .insert({
      user_id: userId,
      profile_id: args.profileId,
      constants_version: args.constantsVersion,
      weeks_out: args.goal.weeksOut,
      event_date: args.eventDate ?? null,
      goal: args.goal,
      constraints: args.constraints,
      starts_on: args.startsOn ?? mondayOf(new Date()),
      goal_hash: goalHash(args.goal, args.constraints, args.constantsVersion),
      generated_for_week: args.generatedForWeek ?? 1,
      week_meta: weekMeta,
    })
    .select("id")
    .single();

  if (error || !plan) return null;
  const planId = plan.id as string;

  const rows: Record<string, unknown>[] = [];
  let dropped = 0;
  for (const week of args.weeks) {
    for (const placement of week.placements) {
      const session = placement.session;
      const findingId = args.findingIds.get(session.findingId);
      if (!findingId) {
        dropped++;
        continue;
      }
      rows.push({
        plan_id: planId,
        finding_id: findingId,
        week: week.week,
        phase: week.phase,
        is_deload: week.deload,
        day_of_week: placement.day,
        slot: placement.slot,
        kind: session.kind,
        domain: session.domain,
        emphasis_key: session.emphasisKey satisfies EmphasisKey,
        is_quality: session.isQuality,
        minutes: session.minutes,
        distance_km: session.prescription.distanceKm ?? null,
        pace_lo_s_per_km: session.prescription.paceLoSPerKm ?? null,
        pace_hi_s_per_km: session.prescription.paceHiSPerKm ?? null,
        hr_lo: session.prescription.hrLo ?? null,
        hr_hi: session.prescription.hrHi ?? null,
        hr_source: session.prescription.hrSource ?? null,
        prescription: session.prescription.text,
        label: session.label ?? null,
        lift: session.lift ?? null,
        intensity: session.intensity,
        is_heavy_lower: session.isHeavyLower,
        is_deadlift: session.isDeadlift,
        stress: session.stress,
        lift_sets: session.liftSets ?? null,
        prescription_notes: session.prescription.notes ?? null,
      });
    }
  }

  if (rows.length > 0) {
    const { error: sessionError } = await supabase.from("hpe_sessions").insert(rows);
    if (sessionError) {
      console.error("hpe_sessions insert failed:", sessionError.message);
      return { planId, storedSessions: 0, droppedSessions: rows.length + dropped };
    }
  }

  return { planId, storedSessions: rows.length, droppedSessions: dropped };
}

/** Marks the plans a regenerated diagnosis has superseded, with the reason the athlete was shown. */
export async function supersedePlans(
  supabase: SupabaseClient,
  userId: string,
  reason: string
): Promise<void> {
  await supabase
    .from("hpe_plans")
    .update({ superseded_at: new Date().toISOString(), superseded_reason: reason })
    .eq("user_id", userId)
    .is("superseded_at", null);
}

/**
 * The most recent stored plan, reconstructed for display.
 *
 * The kill switch's defining promise is that pausing generation leaves
 * existing plans readable — that is the difference between a pause and a
 * recall, and it is the property the whole rollback rehearsal tests. It was
 * only ever half-built: the flag check returned "your existing plan is still
 * available and unchanged" and then nothing loaded it, so the athlete saw a
 * refusal screen asserting the existence of a plan it declined to show them.
 *
 * Reads from the persisted rows rather than regenerating, which is the point:
 * generation is what has been paused, and a plan that had to be regenerated to
 * be read would not have survived the pause at all.
 */
export async function loadLatestStoredPlan(
  supabase: SupabaseClient,
  userId: string
): Promise<{
  generatedAt: string;
  constantsVersion: string;
  weeks: unknown[];
  /**
   * Enough of an AthleteProfile for the plan view to render the trace.
   *
   * Returning the weeks alone was not enough and the screen still showed
   * nothing: the paused branch requires a profile, the paused response set
   * `diagnostic: null` and sent no profile, so the condition could never be
   * true. The sessions cite findings by id and the view resolves those ids
   * against `profile.findings` — without them every session loses the reason
   * it exists, which is the one thing this engine promises about every session
   * it prescribes.
   */
  profile: { constantsVersion: string; tier: number; emphasis: EmphasisVector; findings: Finding[] } | null;
} | null> {
  const { data: plan } = await supabase
    .from("hpe_plans")
    .select("id, generated_at, constants_version, weeks_out")
    .eq("user_id", userId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan) return null;

  const { data: sessionRows } = await supabase
    .from("hpe_sessions")
    .select(
      "week, phase, is_deload, day_of_week, slot, kind, domain, emphasis_key, is_quality, minutes, distance_km, hr_lo, hr_hi, hr_source, prescription, finding_id"
    )
    .eq("plan_id", plan.id as string)
    .order("week", { ascending: true });

  // Regrouped into the same week shape the live path produces, so the plan
  // view renders a stored plan and a fresh one through one code path.
  const byWeek = new Map<number, Record<string, unknown>>();
  for (const r of sessionRows ?? []) {
    const week = Number(r.week);
    if (!byWeek.has(week)) {
      byWeek.set(week, {
        week,
        phase: r.phase,
        deload: Boolean(r.is_deload),
        enduranceMin: 0,
        acwr: 0,
        stressCapped: 0,
        notes: [],
        placements: [],
      });
    }
    const w = byWeek.get(week)!;
    (w.placements as unknown[]).push({
      day: r.day_of_week,
      slot: r.slot,
      session: {
        kind: r.kind,
        domain: r.domain,
        minutes: Number(r.minutes ?? 0),
        isQuality: Boolean(r.is_quality),
        findingId: r.finding_id,
        emphasisKey: r.emphasis_key,
        prescription: { text: r.prescription },
      },
    });
    if (r.domain === "endurance") w.enduranceMin = Number(w.enduranceMin) + Number(r.minutes ?? 0);
  }

  // The stored profile and its findings, so a paused plan still says why each
  // session is there rather than rendering an unexplained calendar.
  const storedProfile = await loadLatestStoredProfile(supabase, userId);
  let profile: {
    constantsVersion: string;
    tier: number;
    emphasis: EmphasisVector;
    findings: Finding[];
  } | null = null;
  if (storedProfile) {
    const { data: findingRows } = await supabase
      .from("hpe_findings")
      .select("finding_key, body, ordinal")
      .eq("profile_id", storedProfile.id)
      .order("ordinal", { ascending: true });
    profile = {
      constantsVersion: storedProfile.constantsVersion,
      tier: storedProfile.tier,
      emphasis: storedProfile.emphasis,
      findings: (findingRows ?? []).map((r) => ({
        id: r.finding_key as FindingId,
        text: r.body as string,
      })) as Finding[],
    };
  }

  return {
    generatedAt: plan.generated_at as string,
    constantsVersion: plan.constants_version as string,
    weeks: [...byWeek.values()].sort((a, b) => Number(a.week) - Number(b.week)),
    profile,
  };
}

// ---------------------------------------------------------------------------
// Block continuity — the current plan, reconstructed for continuation
// ---------------------------------------------------------------------------

export interface CurrentPlan {
  planId: string;
  profileId: string;
  generatedAt: string;
  /** Monday of week one, yyyy-MM-dd. */
  startsOn: string;
  goalHash: string;
  constantsVersion: string;
  weeksOut: number;
  generatedForWeek: number;
  /** Every stored week, rebuilt into the engine's own shape so it can be carried over. */
  weeks: PlanWeek[];
}

/**
 * The plan the athlete is currently living through — the latest one not
 * superseded — with its weeks rebuilt into `PlanWeek` so the engine can carry
 * the lived weeks through a continuation and the spike rule can read the
 * long runs already done.
 */
export async function loadCurrentPlan(supabase: SupabaseClient, userId: string): Promise<CurrentPlan | null> {
  const { data: plan } = await supabase
    .from("hpe_plans")
    .select("id, profile_id, generated_at, constants_version, weeks_out, starts_on, goal_hash, generated_for_week, week_meta")
    .eq("user_id", userId)
    .is("superseded_at", null)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!plan || !plan.starts_on) return null;

  const [{ data: sessionRows }, { data: findingRows }] = await Promise.all([
    supabase
      .from("hpe_sessions")
      .select(
        "week, phase, is_deload, day_of_week, slot, kind, domain, emphasis_key, is_quality, minutes, distance_km, " +
          "pace_lo_s_per_km, pace_hi_s_per_km, hr_lo, hr_hi, hr_source, prescription, finding_id, label, lift, " +
          "intensity, is_heavy_lower, is_deadlift, stress, lift_sets, prescription_notes"
      )
      .eq("plan_id", plan.id as string)
      .order("week", { ascending: true }),
    supabase.from("hpe_findings").select("id, finding_key").eq("profile_id", plan.profile_id as string),
  ]);
  const findingKeyById = new Map((findingRows ?? []).map((r) => [r.id as string, r.finding_key as FindingId]));
  const meta = (plan.week_meta ?? {}) as Record<string, Record<string, unknown>>;

  const byWeek = new Map<number, PlanWeek>();
  for (const r of (sessionRows ?? []) as unknown as Record<string, unknown>[]) {
    const week = Number(r.week);
    if (!byWeek.has(week)) {
      const m = meta[String(week)] ?? {};
      byWeek.set(week, {
        week,
        phase: r.phase as PlanWeek["phase"],
        deload: Boolean(r.is_deload),
        travel: Boolean(m.travel) || undefined,
        enduranceMin: Number(m.enduranceMin ?? 0),
        phaseProgress: Number(m.phaseProgress ?? 0),
        sessions: [],
        placements: [],
        allocation: (m.allocation as PlanWeek["allocation"]) ?? ({} as PlanWeek["allocation"]),
        notes: (m.notes as string[]) ?? [],
        penalty: Number(m.penalty ?? 0),
        hardPenalty: Number(m.hardPenalty ?? 0),
        stress: Number(m.stress ?? 0),
        stressCapped: Number(m.stressCapped ?? 0),
        acwr: Number(m.acwr ?? 0),
        droppedSessions: [],
        delivered: (m.delivered as PlanWeek["delivered"]) ?? undefined,
      });
    }
    const w = byWeek.get(week)!;
    const session: PlanWeek["sessions"][number] = {
      kind: r.kind as PlanWeek["sessions"][number]["kind"],
      domain: r.domain as "endurance" | "strength",
      intensity: Number(r.intensity ?? 0.5),
      isQuality: Boolean(r.is_quality),
      minutes: Number(r.minutes ?? 0),
      isHeavyLower: Boolean(r.is_heavy_lower),
      isDeadlift: Boolean(r.is_deadlift),
      lift: (r.lift as string | null) ?? undefined,
      label: (r.label as string | null) ?? undefined,
      prescription: {
        text: r.prescription as string,
        notes: (r.prescription_notes as string[] | null) ?? undefined,
        findingId: findingKeyById.get(r.finding_id as string) ?? "hybrid-baseline",
        minutes: Number(r.minutes ?? 0),
        distanceKm: r.distance_km != null ? Number(r.distance_km) : undefined,
        paceLoSPerKm: r.pace_lo_s_per_km != null ? Number(r.pace_lo_s_per_km) : undefined,
        paceHiSPerKm: r.pace_hi_s_per_km != null ? Number(r.pace_hi_s_per_km) : undefined,
        hrLo: r.hr_lo != null ? Number(r.hr_lo) : undefined,
        hrHi: r.hr_hi != null ? Number(r.hr_hi) : undefined,
        hrSource: (r.hr_source as string | null) ?? undefined,
      },
      emphasisKey: r.emphasis_key as EmphasisKey,
      findingId: findingKeyById.get(r.finding_id as string) ?? "hybrid-baseline",
      stress: Number(r.stress ?? 0),
      liftSets: (r.lift_sets as Record<string, number> | null) ?? undefined,
    };
    w.sessions.push(session);
    if (r.day_of_week) {
      w.placements.push({ session, day: r.day_of_week as string, slot: (r.slot as "AM" | "PM") ?? "AM" });
    }
  }

  return {
    planId: plan.id as string,
    profileId: plan.profile_id as string,
    generatedAt: plan.generated_at as string,
    startsOn: plan.starts_on as string,
    goalHash: (plan.goal_hash as string | null) ?? "",
    constantsVersion: plan.constants_version as string,
    weeksOut: Number(plan.weeks_out),
    generatedForWeek: Number(plan.generated_for_week ?? 1),
    weeks: [...byWeek.values()].sort((a, b) => a.week - b.week),
  };
}

/**
 * The athlete's stored diagnostic runs, for measuring their OWN rate of
 * improvement rather than assuming the population's.
 *
 * Only the two numbers `estimateObservedResponse` reads are selected. A
 * diagnostic row carries health-derived metrics and there is no reason for a
 * rate estimate to load them.
 */
export async function loadProfileHistory(
  supabase: SupabaseClient,
  userId: string,
  sinceIso: string
): Promise<ProfileObservation[]> {
  const { data } = await supabase
    .from("hpe_athlete_profile")
    .select("generated_at, predicted_5k_s, one_rms")
    .eq("user_id", userId)
    .gte("generated_at", sinceIso)
    .order("generated_at", { ascending: true });
  return (data ?? []).map((r) => ({
    generatedAt: r.generated_at as string,
    predicted5kS: Number(r.predicted_5k_s ?? 0),
    oneRms: (r.one_rms as Record<string, number> | null) ?? {},
  }));
}
