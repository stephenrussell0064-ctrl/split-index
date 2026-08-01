import type { SupabaseClient } from "@supabase/supabase-js";
import { buildHybridReport, type HybridAthleteReport, type ReportPeriod } from "./hybrid-report";
import { getCrossDomainTimeline } from "./timeline";
import { getPredictedBenchmark } from "./predicted-benchmark";

/** First day of the current calendar month/quarter, as YYYY-MM-DD (UTC). */
export function currentPeriodStart(period: ReportPeriod): string {
  const now = new Date();
  const month = period === "quarterly" ? Math.floor(now.getUTCMonth() / 3) * 3 : now.getUTCMonth();
  return new Date(Date.UTC(now.getUTCFullYear(), month, 1)).toISOString().slice(0, 10);
}

const TIMELINE_LOOKBACK_DAYS = 400;

function mapRow(row: {
  id: string;
  period: ReportPeriod;
  period_start: string;
  generated_at: string;
  score_trend: HybridAthleteReport["scoreTrend"];
  readiness_trend: HybridAthleteReport["readinessTrend"];
  interference_headline: string;
  target_pace_label: string | null;
}): HybridAthleteReport {
  return {
    period: row.period,
    periodStart: row.period_start,
    generatedAt: row.generated_at,
    scoreTrend: row.score_trend,
    readinessTrend: row.readiness_trend,
    interferenceHeadline: row.interference_headline,
    targetPaceLabel: row.target_pace_label,
  };
}

export async function fetchLatestHybridReport(
  supabase: SupabaseClient,
  userId: string,
  period: ReportPeriod = "monthly"
): Promise<HybridAthleteReport | null> {
  const { data } = await supabase
    .from("hybrid_athlete_reports")
    .select("*")
    .eq("user_id", userId)
    .eq("period", period)
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data ? mapRow(data) : null;
}

/** Computes and upserts one user's report for the given period — called from the cron route (admin client) for every premium user. */
export async function generateHybridReport(
  supabase: SupabaseClient,
  userId: string,
  period: ReportPeriod
): Promise<HybridAthleteReport> {
  const periodStart = currentPeriodStart(period);
  const since = new Date(Date.now() - TIMELINE_LOOKBACK_DAYS * 86400000).toISOString();

  const [sessions, { data: scoreHistoryRaw }, predictedBenchmark] = await Promise.all([
    getCrossDomainTimeline(supabase, userId, { since }),
    supabase
      .from("split_index_history")
      .select("split_index, recorded_at")
      .eq("user_id", userId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(500),
    getPredictedBenchmark(supabase, userId, "run"),
  ]);

  const scoreHistory = (scoreHistoryRaw ?? []).map((r) => ({
    splitIndex: r.split_index as number,
    recordedAt: r.recorded_at as string,
  }));

  const report = buildHybridReport({
    period,
    periodStart: `${periodStart}T00:00:00.000Z`,
    scoreHistory,
    sessions,
    predictedBenchmark,
  });

  await supabase.from("hybrid_athlete_reports").upsert(
    {
      user_id: userId,
      period,
      period_start: periodStart,
      generated_at: report.generatedAt,
      score_trend: report.scoreTrend,
      readiness_trend: report.readinessTrend,
      interference_headline: report.interferenceHeadline,
      target_pace_label: report.targetPaceLabel,
    },
    { onConflict: "user_id,period,period_start" }
  );

  return report;
}
