/**
 * Hybrid Athlete Report (interference-engine brief, Part 5) — a periodic
 * synthesis of score trend + Part 1 interference findings + Part 2 readiness
 * trend + the existing race prediction, into one document good enough that
 * a HYROX athlete or their coach would actually want it. Pure function: the
 * caller (hybrid-report-data.ts) supplies the raw rows.
 */
import { computeInterferenceReport, pickInterferenceHeadline } from "./interference";
import { computeReadiness } from "./readiness";
import { buildTargetPaceLabel } from "./today-plan";
import type { TimelineSession } from "./timeline";
import type { StoredPredictedBenchmark } from "./predicted-benchmark";

export type ReportPeriod = "monthly" | "quarterly";

export interface ScoreTrend {
  startIndex: number | null;
  endIndex: number | null;
  deltaPct: number | null;
}

export interface ReadinessTrend {
  start: number;
  end: number;
  delta: number;
}

export interface HybridAthleteReport {
  period: ReportPeriod;
  periodStart: string;
  generatedAt: string;
  scoreTrend: ScoreTrend;
  readinessTrend: ReadinessTrend;
  interferenceHeadline: string;
  targetPaceLabel: string | null;
}

function computeScoreTrend(
  scoreHistory: { splitIndex: number; recordedAt: string }[],
  periodStartIso: string
): ScoreTrend {
  if (scoreHistory.length === 0) {
    return { startIndex: null, endIndex: null, deltaPct: null };
  }

  const inPeriod = scoreHistory.filter((s) => s.recordedAt >= periodStartIso);
  const startIndex = inPeriod[0]?.splitIndex ?? scoreHistory[0].splitIndex;
  const endIndex = scoreHistory[scoreHistory.length - 1].splitIndex;
  const deltaPct = startIndex > 0 ? Math.round(((endIndex - startIndex) / startIndex) * 1000) / 10 : null;

  return { startIndex, endIndex, deltaPct };
}

export function buildHybridReport(params: {
  period: ReportPeriod;
  periodStart: string;
  generatedAt?: string;
  scoreHistory: { splitIndex: number; recordedAt: string }[];
  sessions: TimelineSession[];
  predictedBenchmark: StoredPredictedBenchmark | null;
}): HybridAthleteReport {
  const generatedAt = params.generatedAt ?? new Date().toISOString();
  const periodStartMs = new Date(params.periodStart).getTime();

  const startReadiness = computeReadiness(params.sessions, periodStartMs).readiness;
  const endReadiness = computeReadiness(params.sessions, new Date(generatedAt).getTime()).readiness;

  return {
    period: params.period,
    periodStart: params.periodStart,
    generatedAt,
    scoreTrend: computeScoreTrend(params.scoreHistory, params.periodStart),
    readinessTrend: {
      start: startReadiness,
      end: endReadiness,
      delta: endReadiness - startReadiness,
    },
    interferenceHeadline: pickInterferenceHeadline(computeInterferenceReport(params.sessions)),
    targetPaceLabel: buildTargetPaceLabel(params.predictedBenchmark),
  };
}
