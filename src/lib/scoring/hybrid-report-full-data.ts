import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnalyticsActivity, PredictedBenchmark } from "@/components/analytics/types";
import type { Gender, PersonalRecord, ScoringBasis } from "@/types";
import { canAccessProfile, type PremiumProfile } from "@/lib/premium/features";
import { fetchRecoveryInputs, toDrinkEntries } from "@/lib/recovery/data";
import { sexForWidmark } from "@/lib/recovery/alcohol";
import { computeRecoveryScore } from "@/lib/recovery/score";
import { computeStreakMetrics } from "@/lib/retention/streak-utils";
import { fetchAllTimeLiftRows, bestOneRmByKey } from "@/lib/activities/all-time-one-rm";
import { resolveScoringSex } from "@/lib/scoring/adapters";
import { computeRaceRecords } from "@/lib/scoring/race-records";
import { computeReadiness } from "@/lib/scoring/readiness";
import { normalizeName } from "@/lib/scoring/split-strength-engine";
import { calculateOverallDotsGl } from "@/lib/scoring/strength/overall-dots-gl";
import { buildStrengthEstimates, type LatestStrengthScoreRow } from "@/lib/scoring/strength/strength-estimates";
import { getCrossDomainTimeline } from "@/lib/scoring/timeline";
import { INTERFERENCE_LOOKBACK_DAYS } from "@/lib/scoring/interference-data";
import { resolveTimezone } from "@/lib/utils/timezone";
import { buildFullHybridReport, type FullHybridReport, type ReportIndexPoint, type ReportScore } from "./hybrid-report-full";

const DAY_MS = 86_400_000;
export const REPORT_PERIOD_DAYS = 30;
/** Enough for "best ever" to mean something and for the interference engine's own lookback. */
const HISTORY_DAYS = 400;
/** The period, plus the four weeks before it that the load average and readiness need. */
const ACTIVITY_DAYS = REPORT_PERIOD_DAYS + 35;

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * DAY_MS).toISOString();
}

/** The profile columns the report reads — the same shapes the premium and scoring helpers already take. */
export interface ReportProfile extends PremiumProfile {
  weight_kg: number | null;
  gender: Gender | null;
  timezone: string | null;
  scoring_basis?: ScoringBasis | null;
}

/**
 * Everything the full report reads, in one round of queries.
 *
 * The same sources the dashboard, analytics, recovery and interference pages
 * each read for their own screen — deliberately the same loaders and the
 * same computations, so the report cannot show a number that disagrees with
 * the page it summarises.
 */
export async function loadFullHybridReport(
  supabase: SupabaseClient,
  userId: string,
  profile: ReportProfile,
  /**
   * Whether the athlete has given Article 9 consent. Read by the PAGE, not
   * here: the consent gate is only allowed on the surfaces that show the
   * injury Risk Index (consent-gate.test.ts keeps the list), and a loader in
   * lib/scoring is not one — the report page is.
   */
  article9Consent: boolean,
  now: Date = new Date()
): Promise<FullHybridReport> {
  const activityCutoff = isoDaysAgo(ACTIVITY_DAYS, now);

  const [
    { data: indexHistory },
    { data: activities },
    { data: scores },
    { data: allActivityDates },
    { data: personalRecords },
    { data: predictedBenchmarksRaw },
    { data: strengthScoresRaw },
    { data: raceRecordActivities },
    allTimeExercises,
    sessions,
    recoveryInputs,
  ] = await Promise.all([
    supabase
      .from("split_index_history")
      .select("split_index, endurance_index, strength_index, recorded_at")
      .eq("user_id", userId)
      .gte("recorded_at", isoDaysAgo(HISTORY_DAYS, now))
      .order("recorded_at", { ascending: true })
      .limit(500),
    supabase
      .from("activities")
      .select(
        "id, sport, started_at, duration_seconds, distance_meters, avg_heart_rate, max_heart_rate, session_type, rpe"
      )
      .eq("user_id", userId)
      .eq("is_draft", false)
      .gte("started_at", activityCutoff)
      .order("started_at", { ascending: true })
      .limit(1000),
    supabase
      .from("workout_scores")
      .select("activity_id, sport, sport_index, load_score, created_at")
      .eq("user_id", userId)
      .gte("created_at", activityCutoff)
      .order("created_at", { ascending: true })
      .limit(1000),
    supabase
      .from("activities")
      .select("started_at")
      .eq("user_id", userId)
      .eq("is_draft", false)
      .order("started_at", { ascending: false })
      .limit(365),
    supabase
      .from("personal_records")
      .select("*")
      .eq("user_id", userId)
      .order("achieved_at", { ascending: false })
      .limit(50),
    supabase
      .from("predicted_benchmarks")
      .select("sport, benchmark_seconds, sample_count, updated_at, riegel_k")
      .eq("user_id", userId),
    supabase.rpc("latest_strength_scores", { p_user_id: userId }),
    supabase
      .from("activities")
      .select("distance_meters, duration_seconds, started_at, session_type")
      .eq("user_id", userId)
      .eq("sport", "running")
      .eq("is_draft", false)
      .not("distance_meters", "is", null)
      .not("duration_seconds", "is", null)
      .order("started_at", { ascending: false })
      .limit(2000),
    fetchAllTimeLiftRows(supabase, userId),
    getCrossDomainTimeline(supabase, userId, { since: isoDaysAgo(INTERFERENCE_LOOKBACK_DAYS, now) }),
    fetchRecoveryInputs(supabase, userId, { profileWeightKg: profile.weight_kg }),
  ]);

  const timeZone = resolveTimezone(profile.timezone);
  const readiness = sessions.length > 0 ? computeReadiness(sessions) : null;
  const recovery = readiness
    ? computeRecoveryScore({
        readiness,
        hrvToday: recoveryInputs.hrvToday,
        hrvBaseline: recoveryInputs.hrvBaseline,
        recentSessionDates: recoveryInputs.recentSessionDates,
        drinks: toDrinkEntries(recoveryInputs.drinks),
        // Same fallback the Recovery page uses when no bodyweight is set.
        bodyweightKg: recoveryInputs.bodyweightKg ?? 75,
        sex: sexForWidmark(profile.gender),
        timeZone,
        now,
      })
    : null;

  const overallDotsGl =
    profile.weight_kg && profile.weight_kg > 0
      ? calculateOverallDotsGl(allTimeExercises, profile.weight_kg, resolveScoringSex(profile))
      : null;
  const strengthEstimates = buildStrengthEstimates(
    (strengthScoresRaw ?? []) as LatestStrengthScoreRow[],
    bestOneRmByKey(allTimeExercises, normalizeName)
  );

  const streak = computeStreakMetrics(
    (allActivityDates ?? []).map((a) => a.started_at as string),
    now,
    profile.timezone
  ).streak;

  return buildFullHybridReport({
    now,
    periodDays: REPORT_PERIOD_DAYS,
    indexHistory: (indexHistory ?? []) as ReportIndexPoint[],
    activities: (activities ?? []) as AnalyticsActivity[],
    scores: (scores ?? []) as ReportScore[],
    sessions,
    readiness,
    recovery,
    hrvToday: recoveryInputs.hrvToday,
    hrvBaseline: recoveryInputs.hrvBaseline,
    predictedBenchmarks: (predictedBenchmarksRaw ?? []).map(
      (p): PredictedBenchmark => ({
        sport: p.sport as PredictedBenchmark["sport"],
        benchmarkSeconds: p.benchmark_seconds as number,
        sampleCount: p.sample_count as number,
        updatedAt: p.updated_at as string,
        riegelK: p.riegel_k as number | null,
      })
    ),
    strengthEstimates,
    overallDotsGl,
    showDotsGl: canAccessProfile("strength_dots_gl", profile),
    raceRecords: computeRaceRecords(
      (raceRecordActivities ?? []).map((a) => ({
        distanceMeters: a.distance_meters as number | null,
        durationSeconds: a.duration_seconds as number | null,
        startedAt: a.started_at as string,
        sessionType: a.session_type as string | null,
      }))
    ),
    personalRecords: (personalRecords ?? []) as PersonalRecord[],
    article9Consent,
    targetSessionsPerWeek: 4,
    streak,
  });
}
