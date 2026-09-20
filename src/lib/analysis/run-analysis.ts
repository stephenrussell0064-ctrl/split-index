import type { SportType } from "@/types";
import { bestEffortDistancesFor, computeBestEfforts, type BestEffort } from "./best-efforts";
import { analyzeElevation, smoothedAltitudeSeries, type ElevationAnalysis } from "./elevation";
import { analyzeHeartRate, type HeartRateAnalysis, type HrProfileInput } from "./heart-rate";
import { computeSplits, METERS_PER_MILE, summarizePace, type PaceSummary, type Split } from "./splits";
import { totalDistanceMeters, totalSeconds, type ActivityStreams } from "./streams";
import { paceBandFor } from "./vocabulary";

/**
 * Everything the activity page's run-analysis panel renders, computed once
 * from the stored streams. Plain data — serialisable straight from a server
 * component into the client chart components.
 */
export interface RunAnalysisChartPoint {
  distanceKm: number;
  timeSeconds: number;
  /** Rolling pace over the last ~100m, so the line reads as pace rather than GPS jitter. Null over the first stretch. */
  paceSecondsPerKm: number | null;
  heartRate: number | null;
  altitude: number | null;
}

export interface RunAnalysis {
  sport: SportType;
  totalDistanceMeters: number;
  totalSeconds: number;
  sampleCount: number;
  /** Per-kilometre splits. */
  splitsKm: Split[];
  /** The same session cut per mile — athletes on either convention get their own table. */
  splitsMile: Split[];
  pace: PaceSummary | null;
  bestEfforts: BestEffort[];
  heartRate: HeartRateAnalysis | null;
  elevation: ElevationAnalysis | null;
  chart: RunAnalysisChartPoint[];
}

export interface RunAnalysisOptions {
  sport: SportType;
  profile: HrProfileInput;
}

export const CHART_CONFIG = {
  /** Points handed to the charts. A phone-width chart cannot show more, and every extra point is bytes in the page payload. */
  MAX_POINTS: 240,
  /** Window the rolling pace is measured over. Shorter than this and a 10m leg's timing jitter dominates; longer and a surge disappears. */
  PACE_WINDOW_METERS: 100,
} as const;

/**
 * Pace at each sample over the preceding PACE_WINDOW_METERS.
 *
 * The plausibility band is per sport (see paceBandFor). It used to be one
 * pair of constants tuned for running, whose fast end sat at 36 km/h — which
 * meant every descent on a ride was judged impossible and blanked, and the
 * fastest part of the ride was the part missing from the chart.
 */
function rollingPace(streams: ActivityStreams, sport: SportType): (number | null)[] {
  const band = paceBandFor(sport);
  const { distance, time } = streams;
  const out: (number | null)[] = new Array(distance.length).fill(null);
  let j = 0;
  for (let i = 0; i < distance.length; i++) {
    while (j < i && distance[i] - distance[j] > CHART_CONFIG.PACE_WINDOW_METERS) j++;
    // Back up one so the window is at least the target length, not just under it.
    const from = j > 0 && distance[i] - distance[j] < CHART_CONFIG.PACE_WINDOW_METERS ? j - 1 : j;
    const meters = distance[i] - distance[from];
    const seconds = time[i] - time[from];
    if (meters < CHART_CONFIG.PACE_WINDOW_METERS * 0.5 || seconds <= 0) continue;
    const pace = (seconds / meters) * 1000;
    if (pace < band.minSecondsPerKm || pace > band.maxSecondsPerKm) continue;
    out[i] = Math.round(pace);
  }
  return out;
}

function chartPoints(
  streams: ActivityStreams,
  altitude: number[] | null,
  sport: SportType
): RunAnalysisChartPoint[] {
  const pace = rollingPace(streams, sport);
  const n = streams.distance.length;
  const count = Math.min(n, CHART_CONFIG.MAX_POINTS);
  const step = count > 1 ? (n - 1) / (count - 1) : 0;
  const points: RunAnalysisChartPoint[] = [];
  for (let k = 0; k < count; k++) {
    const i = Math.round(k * step);
    points.push({
      distanceKm: Math.round(streams.distance[i] / 10) / 100,
      timeSeconds: Math.round(streams.time[i]),
      paceSecondsPerKm: pace[i],
      heartRate: streams.heartRate ? streams.heartRate[i] : null,
      altitude: altitude ? Math.round(altitude[i] * 10) / 10 : null,
    });
  }
  return points;
}

export function analyzeRun(streams: ActivityStreams, options: RunAnalysisOptions): RunAnalysis {
  const smoothedAltitude = smoothedAltitudeSeries(streams);
  const splitsKm = computeSplits(streams, 1000, { smoothedAltitude });
  const splitsMile = computeSplits(streams, METERS_PER_MILE, { smoothedAltitude });

  return {
    sport: options.sport,
    totalDistanceMeters: Math.round(totalDistanceMeters(streams)),
    totalSeconds: Math.round(totalSeconds(streams)),
    sampleCount: streams.time.length,
    splitsKm,
    splitsMile,
    pace: summarizePace(streams, splitsKm),
    bestEfforts: computeBestEfforts(streams, bestEffortDistancesFor(options.sport)),
    heartRate: analyzeHeartRate(streams, options.profile),
    elevation: analyzeElevation(streams, smoothedAltitude),
    chart: chartPoints(streams, smoothedAltitude, options.sport),
  };
}
