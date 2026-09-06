import { NextResponse } from "next/server";
import { databaseError } from "@/lib/api/errors";
import { createClient } from "@/lib/supabase/server";
import { computeRecentLoads } from "@/lib/scoring/service";
import { calculateACWR, calculateFatigueScore, calculateRecoveryScore } from "@/lib/scoring/engine";

/**
 * Manual HRV entry (MASTER-BRIEF.md §8) — optional, never required. Upserts
 * today's rMSSD reading (ms) into recovery_snapshots so the Injury Risk
 * panel can layer it onto the load-based index via hrvAdjustedRisk().
 *
 * User feedback (Slice 3): "What difference does adding in hrv value in
 * analytics make... make sure this has an instant impact on whatever scores
 * it impacts or remove." Diagnosis: `recovery_score`/`fatigue_score` are
 * written here purely to satisfy the columns' NOT NULL constraint
 * (migration 001 — no default, can't be omitted from the insert); nothing
 * in the app ever reads them back (only `hrv_ms` is ever selected from this
 * table — see analytics/page.tsx). They're computed, not hardcoded
 * placeholders, but they have no reader and are not the fix this feedback
 * is about — the real fix is in injury-risk-panel.tsx, which used to show
 * the exact same "add HRV for precision" prompt whether you'd logged
 * nothing at all or had just logged your first-ever reading. A single
 * isolated reading has no baseline to compute a ratio against yet (that's
 * inherent to any baseline-relative metric, not a bug to compute around),
 * so it now says the reading was saved and is building a baseline instead
 * of looking like the submission did nothing.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const hrvMs = Number(body.hrvMs);
  if (!Number.isFinite(hrvMs) || hrvMs <= 0 || hrvMs > 500) {
    return NextResponse.json({ error: "hrvMs must be a plausible rMSSD value in ms" }, { status: 400 });
  }

  const { data: recentScores } = await supabase
    .from("workout_scores")
    .select("load_score, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const { acute, chronic } = computeRecentLoads(recentScores ?? []);
  const acwr = calculateACWR(acute, chronic);
  const fatigueScore = calculateFatigueScore(acwr, acute);
  const recoveryScore = calculateRecoveryScore(fatigueScore, acwr, 1);

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);

  const { data: existing } = await supabase
    .from("recovery_snapshots")
    .select("id")
    .eq("user_id", user.id)
    .gte("recorded_at", todayStart.toISOString())
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("recovery_snapshots")
      .update({ hrv_ms: hrvMs, recovery_score: recoveryScore, fatigue_score: fatigueScore })
      .eq("id", existing.id);
    if (error) return databaseError(error, { operation: "POST /api/recovery/hrv" });
  } else {
    const { error } = await supabase.from("recovery_snapshots").insert({
      user_id: user.id,
      hrv_ms: hrvMs,
      recovery_score: recoveryScore,
      fatigue_score: fatigueScore,
    });
    if (error) return databaseError(error, { operation: "POST /api/recovery/hrv" });
  }

  return NextResponse.json({ hrvMs });
}
