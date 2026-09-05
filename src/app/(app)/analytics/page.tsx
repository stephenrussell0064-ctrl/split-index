import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AnalyticsClient } from "@/components/analytics/analytics-client";
import { isPremiumUser } from "@/lib/retention/trial";
import { canAccessProfile } from "@/lib/premium/features";
import { resolveScoringSex } from "@/lib/scoring/adapters";
import { calculateOverallDotsGl } from "@/lib/scoring/strength/overall-dots-gl";
import { computeRaceRecords } from "@/lib/scoring/race-records";
import type { AnalyticsPayload, PredictedBenchmark, StrengthEstimate } from "@/components/analytics/types";
import { normalizeName } from "@/lib/scoring/split-strength-engine";
import { fetchAllTimeLiftRows, bestOneRmByKey } from "@/lib/activities/all-time-one-rm";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";
import type { PersonalRecord } from "@/types";

const DAY_MS = 86400000;
const HISTORY_DAYS = 365;
const ACTIVITY_DAYS = 365;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

export default async function AnalyticsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "onboarding_completed, subscription_tier, subscription_status, max_hr, timezone, weight_kg, gender, scoring_basis"
    )
    .eq("user_id", user.id)
    .single();

  if (!profile?.onboarding_completed) redirect("/onboarding");

  const premium = isPremiumUser(
    profile.subscription_tier,
    profile.subscription_status
  );
  const showDotsGl = canAccessProfile("strength_dots_gl", profile);
  const historyCutoff = isoDaysAgo(premium ? HISTORY_DAYS : 7);
  const activityCutoff = isoDaysAgo(ACTIVITY_DAYS);

  const [
    { data: indexHistory },
    { data: activities },
    { data: scores },
    { data: personalRecords },
    { data: predictedBenchmarksRaw },
    { data: strengthScoresRaw },
    { data: hrvReadingsRaw },
    { data: raceRecordActivities },
    allTimeExercises,
  ] = await Promise.all([
    supabase
      .from("split_index_history")
      .select("*")
      .eq("user_id", user.id)
      .gte("recorded_at", historyCutoff)
      .order("recorded_at", { ascending: true })
      .limit(400),
    supabase
      .from("activities")
      .select(
        "id, sport, started_at, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, session_type, rpe"
      )
      .eq("user_id", user.id)
      .eq("is_draft", false)
      .gte("started_at", activityCutoff)
      .order("started_at", { ascending: true })
      .limit(1000),
    supabase
      .from("workout_scores")
      .select("activity_id, sport, sport_index, load_score, created_at")
      .eq("user_id", user.id)
      .gte("created_at", activityCutoff)
      .order("created_at", { ascending: true })
      .limit(1000),
    supabase
      .from("personal_records")
      .select("*")
      .eq("user_id", user.id)
      .order("achieved_at", { ascending: false })
      .limit(50),
    // predicted_benchmarks may not exist yet if migration 011 hasn't been
    // run — degrades to an empty array rather than failing the page.
    supabase
      .from("predicted_benchmarks")
      .select("sport, benchmark_seconds, sample_count, updated_at, riegel_k")
      .eq("user_id", user.id),
    // One row per exercise ever logged, not just whatever falls within a
    // row-count-limited recent-history query (see migration 019) — a plain
    // .select().limit() can silently drop lifts not trained recently for
    // anyone with a wide exercise history.
    supabase.rpc("latest_strength_scores", { p_user_id: user.id }),
    supabase
      .from("recovery_snapshots")
      .select("hrv_ms, recorded_at")
      .eq("user_id", user.id)
      .not("hrv_ms", "is", null)
      .gte("recorded_at", isoDaysAgo(15))
      .order("recorded_at", { ascending: false })
      .limit(15),
    // All-time, not cut off at ACTIVITY_DAYS — a race PB set over a year ago
    // is still the record until something beats it (user feedback: "current
    // race records" missing from analytics). See race-records.ts.
    supabase
      .from("activities")
      .select("distance_meters, duration_seconds, started_at, session_type")
      .eq("user_id", user.id)
      .eq("sport", "running")
      .eq("is_draft", false)
      .not("distance_meters", "is", null)
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .limit(2000),
    // Same all-time-best-lift pattern as the Lab page's own DOTS/GL card
    // (gym/page.tsx) — deliberately not the latest-per-lift RPC above, which
    // would understate a lift not touched in the most recent session. Reads
    // strength_scores directly, so it no longer needs the athlete's gym
    // activity ids first.
    fetchAllTimeLiftRows(supabase, user.id),
  ]);

  // Most recent reading is "today"; the rolling baseline averages the rest
  // (MASTER-BRIEF.md §8) — optional, both null when nothing's been logged.
  const hrvReadings = (hrvReadingsRaw ?? []).map((r) => r.hrv_ms as number);
  const hrvToday = hrvReadings[0] ?? null;
  const hrvBaselineReadings = hrvReadings.slice(1);
  const hrvBaseline =
    hrvBaselineReadings.length > 0
      ? hrvBaselineReadings.reduce((sum, v) => sum + v, 0) / hrvBaselineReadings.length
      : null;

  const raceRecords = computeRaceRecords(
    (raceRecordActivities ?? []).map((a) => ({
      distanceMeters: a.distance_meters as number | null,
      durationSeconds: a.duration_seconds as number | null,
      startedAt: a.started_at as string,
      sessionType: a.session_type as string | null,
    }))
  );

  // Same profile-level "best-ever SBD" DOTS/GL as the Lab page (gym/page.tsx)
  // — one shared source of truth so the number an athlete sees in Analytics
  // always matches what they see in the Lab (user feedback flagged the
  // dashboard/per-workout number as "wrong" relative to a reference DOTS/GL
  // calculator before that page-level fix; reusing the same function here
  // avoids reintroducing that mismatch in a second place).
  // allTimeExercises comes from strength_scores, not gym_exercises — see
  // lib/activities/all-time-one-rm.ts for why the two columns are not two
  // estimates of the same number.
  const overallDotsGl =
    profile.weight_kg && profile.weight_kg > 0
      ? calculateOverallDotsGl(allTimeExercises, profile.weight_kg, resolveScoringSex(profile))
      : null;

  // All-time best per lift, mined from every scored lift ever logged rather
  // than read off the latest scoring pass. The engine only ever sees the most
  // recent 200 sessions (fetchExerciseHistory), and a high-water mark that
  // quietly forgets anything older is not a high-water mark. These are the same
  // rows the DOTS/GL card above already needs, so it costs no extra query.
  // Names are normalized because the same lift can have been typed with
  // different casing across sessions.
  const allTime1RmByLift = bestOneRmByKey(allTimeExercises, normalizeName);

  // latest_strength_scores() already returns one row per exercise — this
  // dedup is just a defensive no-op if that ever changes.
  const strengthEstimateByLift = new Map<string, StrengthEstimate>();
  for (const row of strengthScoresRaw ?? []) {
    const name = row.exercise_name as string;
    if (strengthEstimateByLift.has(name)) continue;
    const breakdown = row.score_breakdown as { strength_result?: ScoreStrengthResult } | null;
    const result = breakdown?.strength_result;
    const estimated1RmKg = row.estimated_1rm_kg as number;
    strengthEstimateByLift.set(name, {
      exerciseName: name,
      estimated1RmKg,
      // Highest of every source that could hold the real best — a row scored
      // before the split existed has no allTimeOneRM at all, so falling back
      // to the stored per-session figure keeps the number honest instead of
      // reporting a zero. All three are the engine's own figure now, so this
      // compares like with like; it used to reach across two different rulers,
      // where it could only ever pick the more generous of the two.
      allTime1RmKg: Math.max(
        allTime1RmByLift.get(normalizeName(name)) ?? 0,
        result?.allTimeOneRM ?? 0,
        estimated1RmKg
      ),
      current1RmKg: result?.currentOneRM ?? estimated1RmKg,
      trend: result?.trend ?? undefined,
      confidence: result?.oneRMConfidence,
      bandKg: result?.oneRMBandKg ?? undefined,
      recordedAt: row.recorded_at as string,
    });
  }

  const payload: AnalyticsPayload = {
    isPremium: premium,
    maxHr: profile.max_hr,
    timezone: profile.timezone,
    targetSessionsPerWeek: 4,
    indexHistory: indexHistory ?? [],
    activities: (activities ?? []).map((a) => ({
      id: a.id as string,
      sport: a.sport,
      started_at: a.started_at as string,
      duration_seconds: a.duration_seconds as number,
      distance_meters: a.distance_meters as number | null,
      avg_heart_rate: a.avg_heart_rate as number | null,
      max_heart_rate: a.max_heart_rate as number | null,
      session_type: a.session_type,
      rpe: a.rpe as number | null,
    })),
    scores: (scores ?? []).map((s) => ({
      activity_id: s.activity_id as string,
      sport: s.sport,
      sport_index: s.sport_index as number,
      load_score: s.load_score as number,
      created_at: s.created_at as string,
    })),
    personalRecords: (personalRecords ?? []) as PersonalRecord[],
    predictedBenchmarks: (predictedBenchmarksRaw ?? []).map(
      (p): PredictedBenchmark => ({
        sport: p.sport as PredictedBenchmark["sport"],
        benchmarkSeconds: p.benchmark_seconds as number,
        sampleCount: p.sample_count as number,
        updatedAt: p.updated_at as string,
        riegelK: p.riegel_k as number | null,
      })
    ),
    strengthEstimates: Array.from(strengthEstimateByLift.values()) as StrengthEstimate[],
    hrvToday,
    hrvBaseline,
    raceRecords,
    overallDotsGl,
    showDotsGl,
  };

  return (
    <AnalyticsClient data={payload} />
  );
}
