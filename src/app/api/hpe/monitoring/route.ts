import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildMonitoringSnapshot, type FeedbackEvent, type GenerationEvent, type InjuryReport, type ProfileSnapshot } from "@/lib/scoring/hpe/monitoring";
import { EMPHASIS_DRIFT_REGENERATE_THRESHOLD } from "@/lib/scoring/hpe/constants";
import { ROLLOUT_STAGES, nextRolloutStage } from "@/lib/scoring/hpe/rollout";

/**
 * WP10 monitoring endpoint.
 *
 * Scoped to the requesting user's own rows. Row-level security means an
 * ordinary account sees only its own data here, which makes this an athlete's
 * view of their own plan health rather than an operations dashboard. A
 * fleet-wide view needs a service-role query behind an admin gate, and
 * shipping that without an admin role in place would be shipping an
 * information leak — so this route deliberately does not do it, and says so
 * in the response.
 */

const DEFAULT_WINDOW_DAYS = 30;

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const windowDays = Math.min(365, Math.max(7, Number(searchParams.get("days")) || DEFAULT_WINDOW_DAYS));
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();

  const [{ data: eventRows }, { data: feedbackRows }, { data: profileRows }, { data: injuryRows }, { data: flagRow }] =
    await Promise.all([
      supabase
        .from("hpe_generation_events")
        .select("user_id, occurred_at, outcome, reason_code, tier, peak_acwr, hard_violations")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: true }),
      supabase
        .from("hpe_session_feedback")
        .select("user_id, logged_at, completed, met_prescription, session_rpe, low_capacity_flagged")
        .gte("logged_at", since),
      supabase
        .from("hpe_athlete_profile")
        .select("user_id, generated_at, tier, emphasis")
        .gte("generated_at", since)
        .order("generated_at", { ascending: true }),
      supabase.from("hpe_injury_reports").select("user_id, reported_at, severity, attributed_to_plan").gte("reported_at", since),
      supabase.from("hpe_feature_flags").select("key, enabled, rollout_percentage, note, updated_at").eq("key", "hpe_generation").maybeSingle(),
    ]);

  const events: GenerationEvent[] = (eventRows ?? []).map((r) => ({
    userId: r.user_id as string,
    occurredAt: r.occurred_at as string,
    outcome: r.outcome as GenerationEvent["outcome"],
    reasonCode: (r.reason_code as string | null) ?? null,
    tier: r.tier != null ? Number(r.tier) : null,
    peakAcwr: r.peak_acwr != null ? Number(r.peak_acwr) : null,
    hardViolations: r.hard_violations != null ? Number(r.hard_violations) : null,
  }));

  const feedback: FeedbackEvent[] = (feedbackRows ?? []).map((r) => ({
    userId: r.user_id as string,
    loggedAt: r.logged_at as string,
    completed: Boolean(r.completed),
    metPrescription: Boolean(r.met_prescription),
    sessionRpe: r.session_rpe != null ? Number(r.session_rpe) : null,
    lowCapacityFlagged: Boolean(r.low_capacity_flagged),
  }));

  const profiles: ProfileSnapshot[] = (profileRows ?? []).map((r) => ({
    userId: r.user_id as string,
    generatedAt: r.generated_at as string,
    tier: Number(r.tier),
    emphasis: r.emphasis as ProfileSnapshot["emphasis"],
  }));

  const injuries: InjuryReport[] = (injuryRows ?? []).map((r) => ({
    userId: r.user_id as string,
    reportedAt: r.reported_at as string,
    severity: (r.severity as InjuryReport["severity"]) ?? null,
    attributedToPlan: (r.attributed_to_plan as boolean | null) ?? null,
  }));

  const snapshot = buildMonitoringSnapshot({
    windowDays,
    events,
    feedback,
    profiles,
    injuries,
    regenerateThreshold: EMPHASIS_DRIFT_REGENERATE_THRESHOLD,
  });

  const rolloutPercentage = flagRow ? Number(flagRow.rollout_percentage) : 0;

  return NextResponse.json({
    snapshot,
    scope: "own-account",
    scopeNote:
      "These figures cover your own account only. Row-level security keeps one athlete's plan data out of another's, " +
      "and a fleet-wide view needs a service-role query behind an admin role that does not exist yet.",
    rollout: {
      enabled: flagRow ? Boolean(flagRow.enabled) : false,
      percentage: rolloutPercentage,
      note: (flagRow?.note as string | null) ?? null,
      updatedAt: (flagRow?.updated_at as string | null) ?? null,
      stages: ROLLOUT_STAGES,
      nextStage: nextRolloutStage(rolloutPercentage),
    },
  });
}
