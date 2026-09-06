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
  }
): Promise<{ planId: string; storedSessions: number; droppedSessions: number; reused?: boolean } | null> {
  /*
    REUSE THE CURRENT BLOCK RATHER THAN WRITING A NEW ONE.

    `GET /api/hpe/plan` regenerates on every request, and this function used to
    INSERT unconditionally — so simply opening the plan screen wrote a fresh
    `hpe_plans` row plus every one of its sessions. Two costs, and the second is
    the one athletes felt:

      1. Unbounded growth. A row and a few dozen session rows per page view,
         for a screen people check daily.
      2. THE PLAN NEVER ADVANCED. Week 1 is anchored to the plan's
         `generated_at`, so a new row every visit re-anchored week 1 to today,
         for ever. Eight weeks out from a race, the athlete was in base week 1
         — every visit, indefinitely — and the same interval session came round
         again and again.

    A plan is "the same plan" when it was built from the same diagnostic, the
    same constants, and the same goal and constraints. When it is, the existing
    row is returned untouched: its generated_at stays put, and the athlete moves
    through the block instead of restarting it. Anything genuinely different —
    a new diagnostic after the four-weekly re-run, a changed goal, a constants
    bump — does not match, and a new plan is written exactly as before.
  */
  const { data: current } = await supabase
    .from("hpe_plans")
    .select("id, profile_id, constants_version, weeks_out, event_date, goal, constraints")
    .eq("user_id", userId)
    .is("superseded_at", null)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (
    current &&
    current.profile_id === args.profileId &&
    current.constants_version === args.constantsVersion &&
    current.weeks_out === args.goal.weeksOut &&
    (current.event_date ?? null) === (args.eventDate ?? null) &&
    JSON.stringify(current.goal ?? {}) === JSON.stringify(args.goal) &&
    JSON.stringify(current.constraints ?? {}) === JSON.stringify(args.constraints)
  ) {
    const { count } = await supabase
      .from("hpe_sessions")
      .select("id", { count: "exact", head: true })
      .eq("plan_id", current.id as string);
    return {
      planId: current.id as string,
      storedSessions: count ?? 0,
      droppedSessions: 0,
      reused: true,
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
