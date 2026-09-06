import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveAdminRole } from "@/lib/auth/admin-role";
import { recordAdminAccess } from "@/lib/auth/admin-audit";
import {
  buildMonitoringSnapshot,
  type FeedbackEvent,
  type GenerationEvent,
  type InjuryReport,
  type ProfileSnapshot,
} from "@/lib/scoring/hpe/monitoring";
import { EMPHASIS_DRIFT_REGENERATE_THRESHOLD } from "@/lib/scoring/hpe/constants";
import { ROLLOUT_STAGES, evaluateRolloutChange, nextRolloutStage } from "@/lib/scoring/hpe/rollout";

/**
 * Fleet-wide operations view — the view the kill-switch decision is made from.
 *
 * Three things make this safe to exist:
 *
 *  1. **Admin-gated.** `resolveAdminRole` reads `admin_users` through the
 *     service role and fails closed. `admin_users` has no INSERT policy, so
 *     nobody can grant themselves the role through any application path.
 *  2. **Service-role query.** RLS scopes every normal read to one user, which
 *     is exactly why the user-scoped route could not answer fleet questions.
 *     This route bypasses RLS deliberately and is the only place that does.
 *  3. **Aggregate-only output.** No user id, email or per-athlete row leaves
 *     this endpoint. An operator deciding whether to pause a rollout needs
 *     distributions, not a list of who is injured. Everything below is
 *     counted, bucketed or averaged before it is serialised, and
 *     `assertNoIdentifiers` is a runtime backstop on that promise rather than
 *     a comment hoping it stays true.
 *
 * The user-scoped /api/hpe/monitoring route is untouched and still serves
 * normal users their own figures.
 */

const DEFAULT_WINDOW_DAYS = 30;
/** Cap on rows pulled per table. A fleet view that OOMs at scale is a fleet view nobody can use in the incident it exists for. */
const MAX_ROWS = 50_000;

/**
 * Runtime guard: aggregate-only is a security property, so it is checked
 * rather than assumed. Cheap next to the query that produced the payload.
 */
function assertNoIdentifiers(payload: unknown): void {
  const serialised = JSON.stringify(payload);
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  if (uuid.test(serialised)) {
    throw new Error("Fleet payload contained a UUID — aggregate-only was violated.");
  }
  if (/@[a-z0-9.-]+\.[a-z]{2,}/i.test(serialised)) {
    throw new Error("Fleet payload contained an email address — aggregate-only was violated.");
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const identity = await resolveAdminRole(user.id);
  if (!identity) {
    /*
     * The denial is recorded, not just returned. A non-admin reaching this
     * route once is noise; the same account reaching it repeatedly is somebody
     * probing, and a log of successes only cannot show an attempt that failed.
     */
    await recordAdminAccess({
      userId: user.id,
      role: null,
      route: "/api/hpe/admin/fleet",
      action: "read",
      granted: false,
    });
    // 404 rather than 403: an endpoint that answers "forbidden" confirms it
    // exists and is worth attacking. Nothing here needs to tell a
    // non-administrator that an administrator view is available.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { searchParams } = new URL(request.url);
  const windowDays = Math.min(365, Math.max(7, Number(searchParams.get("days")) || DEFAULT_WINDOW_DAYS));

  /*
   * WP6.4 — one row per access to the fleet view.
   *
   * This is the only route in the app that runs a service-role query across
   * every athlete's rows. "Who looked, and when" is the first question an
   * incident asks, and migration 041 audits rollout CHANGES, which is a
   * different event entirely. Only the window parameter is recorded; see
   * admin-audit.ts for what must never be.
   */
  await recordAdminAccess({
    userId: user.id,
    role: identity.role,
    route: "/api/hpe/admin/fleet",
    action: "read",
    granted: true,
    detail: { windowDays },
  });
  const since = new Date(Date.now() - windowDays * 86_400_000).toISOString();
  // Loading the view IS the review — a separate "I have reviewed this" button
  // would be a button people press without reading. Suppressible for polling
  // so a background refresh cannot silently keep a stale gate open.
  const recordReview = searchParams.get("review") !== "false";

  const admin = createAdminClient();

  const [{ data: eventRows }, { data: feedbackRows }, { data: profileRows }, { data: injuryRows }, { data: flagRow }] =
    await Promise.all([
      admin
        .from("hpe_generation_events")
        .select("user_id, occurred_at, outcome, reason_code, tier, peak_acwr, hard_violations")
        .gte("occurred_at", since)
        .order("occurred_at", { ascending: true })
        .limit(MAX_ROWS),
      admin
        .from("hpe_session_feedback")
        .select("user_id, logged_at, completed, met_prescription, session_rpe, low_capacity_flagged")
        .gte("logged_at", since)
        .limit(MAX_ROWS),
      admin
        .from("hpe_athlete_profile")
        .select("user_id, generated_at, tier, emphasis")
        .gte("generated_at", since)
        .order("generated_at", { ascending: true })
        .limit(MAX_ROWS),
      admin
        .from("hpe_injury_reports")
        .select("user_id, reported_at, severity, attributed_to_plan")
        .gte("reported_at", since)
        .limit(MAX_ROWS),
      admin
        .from("hpe_feature_flags")
        .select(
          "key, enabled, rollout_percentage, note, updated_at, last_fleet_review_at, last_fleet_review_by, last_fleet_review_alarm_count"
        )
        .eq("key", "hpe_generation")
        .maybeSingle(),
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

  // The same pure aggregators the user-scoped route uses. They already group
  // by userId internally, so they are fleet-capable unchanged — one definition
  // of every metric, so the operator's number and the athlete's number can
  // never quietly disagree.
  const snapshot = buildMonitoringSnapshot({
    windowDays,
    events,
    feedback,
    profiles,
    injuries,
    regenerateThreshold: EMPHASIS_DRIFT_REGENERATE_THRESHOLD,
  });

  const distinctUsers = new Set([
    ...events.map((e) => e.userId),
    ...feedback.map((f) => f.userId),
    ...profiles.map((p) => p.userId),
  ]).size;

  // Recording the review is what lets the rollout endpoint refuse a raise
  // nobody looked at first. Stored with the alarm count, because a review
  // taken while the dashboard was alarming must not clear the gate.
  if (recordReview && flagRow) {
    await admin
      .from("hpe_feature_flags")
      .update({
        last_fleet_review_at: new Date().toISOString(),
        last_fleet_review_by: user.id,
        last_fleet_review_alarm_count: snapshot.alarms.length,
      })
      .eq("key", "hpe_generation");
  }

  const currentEnabled = flagRow ? Boolean(flagRow.enabled) : false;
  const currentPercentage = flagRow ? Number(flagRow.rollout_percentage) : 0;
  const next = nextRolloutStage(currentPercentage);

  // What the gate would say right now if the operator tried to advance —
  // shown before they try, so the dashboard explains the refusal rather than
  // the button doing it after the fact.
  // What the gate would say for the change the operator is most likely to
  // make next. When generation is paused that is RESUMING, not advancing —
  // `nextRolloutStage` is null at 100%, so previewing only the advance left a
  // paused-at-full rollout with no gate feedback at all.
  const previewTarget = !currentEnabled && currentPercentage > 0 ? currentPercentage : next?.percentage;

  const gatePreview = previewTarget != null
    ? evaluateRolloutChange(
        {
          currentEnabled,
          currentPercentage,
          nextEnabled: true,
          nextPercentage: previewTarget,
        },
        {
          reviewedAt: recordReview ? new Date().toISOString() : ((flagRow?.last_fleet_review_at as string | null) ?? null),
          reviewedBy: null,
          alarmCount: recordReview
            ? snapshot.alarms.length
            : ((flagRow?.last_fleet_review_alarm_count as number | null) ?? null),
        }
      )
    : null;

  const payload = {
    scope: "fleet",
    windowDays,
    // Denominator for every rate above. An adherence figure over four athletes
    // is not a finding, and the operator should be able to see that at a
    // glance rather than infer it.
    populationSize: distinctUsers,
    truncated: events.length >= MAX_ROWS || feedback.length >= MAX_ROWS,
    snapshot,
    rollout: {
      enabled: currentEnabled,
      percentage: currentPercentage,
      note: (flagRow?.note as string | null) ?? null,
      updatedAt: (flagRow?.updated_at as string | null) ?? null,
      stages: ROLLOUT_STAGES,
      nextStage: next,
      gate: gatePreview,
      canChange: identity.role === "operator",
    },
    reviewRecorded: recordReview && Boolean(flagRow),
  };

  assertNoIdentifiers(payload);
  return NextResponse.json(payload);
}
