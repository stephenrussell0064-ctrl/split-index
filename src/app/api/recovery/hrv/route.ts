import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeRecentLoads } from "@/lib/scoring/service";
import { calculateACWR, calculateFatigueScore, calculateRecoveryScore } from "@/lib/scoring/engine";

/**
 * Manual HRV entry (MASTER-BRIEF.md §8) — optional, never required. Upserts
 * today's rMSSD reading (ms) into recovery_snapshots so the Injury Risk
 * panel can layer it onto the load-based index via hrvAdjustedRisk().
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
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await supabase.from("recovery_snapshots").insert({
      user_id: user.id,
      hrv_ms: hrvMs,
      recovery_score: recoveryScore,
      fatigue_score: fatigueScore,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ hrvMs });
}
