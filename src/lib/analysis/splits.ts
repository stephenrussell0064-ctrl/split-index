import { gainAndLossOver, smoothedAltitudeSeries } from "./elevation";
import {
  indexAtDistance,
  maxOver,
  meanOver,
  timeAtDistance,
  totalDistanceMeters,
  totalSeconds,
  type ActivityStreams,
} from "./streams";

/**
 * Splits — the run cut into equal distances, each with its own time, pace,
 * heart rate, cadence and climb. The table every running app shows first,
 * because it answers "where did the run go wrong" in a way an average never
 * can.
 */
export interface Split {
  /** 1 for the first split. */
  index: number;
  startMeters: number;
  endMeters: number;
  /** The split's real length — equal to the split distance for every split but a shorter final one. */
  distanceMeters: number;
  elapsedSeconds: number;
  /** Moving seconds from the start of the run to the end of this split. */
  cumulativeSeconds: number;
  paceSecondsPerKm: number;
  avgHeartRate: number | null;
  maxHeartRate: number | null;
  avgCadence: number | null;
  elevationGainMeters: number | null;
  elevationLossMeters: number | null;
  /** True for a final split shorter than the split distance. */
  isPartial: boolean;
}

export const METERS_PER_MILE = 1609.344;

export const SPLIT_CONFIG = {
  /** A final partial split shorter than this is not shown: 40m of a kilometre is a rounding artefact, not a split. */
  MIN_PARTIAL_METERS: 100,
} as const;

export interface ComputeSplitsOptions {
  /** The cleaned altitude series, when the caller already has it; computed here otherwise. */
  smoothedAltitude?: number[] | null;
}

/**
 * Cuts the stream at every multiple of `splitMeters`. Boundaries are
 * interpolated along the leg that contains them (timeAtDistance), and each
 * split's sensor averages are taken over the samples that fall inside it.
 */
export function computeSplits(
  streams: ActivityStreams,
  splitMeters: number,
  options: ComputeSplitsOptions = {}
): Split[] {
  const total = totalDistanceMeters(streams);
  if (!(splitMeters > 0) || total <= 0) return [];

  const altitude =
    options.smoothedAltitude === undefined ? smoothedAltitudeSeries(streams) : options.smoothedAltitude;

  const splits: Split[] = [];
  let start = streams.distance[0];
  let startTime = streams.time[0];
  let index = 1;

  while (start < total) {
    const target = Math.min(start + splitMeters, total);
    const isPartial = target - start < splitMeters - 0.5;
    if (isPartial && target - start < SPLIT_CONFIG.MIN_PARTIAL_METERS) break;

    const endTime = timeAtDistance(streams, target);
    if (endTime === null) break;
    const elapsed = endTime - startTime;
    const length = target - start;
    if (elapsed <= 0 || length <= 0) break;

    // Samples strictly inside the split — the boundary sample belongs to the
    // split it closes, not to the one it opens.
    const from = Math.min(streams.distance.length - 1, indexAtDistance(streams, start) + (index === 1 ? 0 : 1));
    const to = indexAtDistance(streams, target);
    const climb = altitude ? gainAndLossOver(altitude, from, to) : null;

    splits.push({
      index,
      startMeters: Math.round(start),
      endMeters: Math.round(target),
      distanceMeters: Math.round(length),
      elapsedSeconds: Math.round(elapsed * 10) / 10,
      cumulativeSeconds: Math.round(endTime * 10) / 10,
      paceSecondsPerKm: Math.round((elapsed / length) * 1000 * 10) / 10,
      avgHeartRate: meanOver(streams.heartRate, from, to),
      maxHeartRate: maxOver(streams.heartRate, from, to),
      avgCadence: meanOver(streams.cadence, from, to),
      elevationGainMeters: climb ? climb.gain : null,
      elevationLossMeters: climb ? climb.loss : null,
      isPartial,
    });

    start = target;
    startTime = endTime;
    index++;
  }

  return splits;
}

// ---------------------------------------------------------------------------
// How the pace was distributed
// ---------------------------------------------------------------------------

export type SplitShape = "negative" | "positive" | "even";

export interface PaceSummary {
  /** Index (1-based) of the fastest complete split, null with fewer than two complete splits. */
  fastestSplitIndex: number | null;
  slowestSplitIndex: number | null;
  /** Moving seconds for the first and second halves of the run, by distance. */
  firstHalfSeconds: number;
  secondHalfSeconds: number;
  /** Positive when the second half was slower. */
  halfDeltaSeconds: number;
  /** "negative" = second half faster by more than the tolerance; "positive" = slower; otherwise even. */
  shape: SplitShape;
  /** Coefficient of variation of complete-split paces, as a percentage. How steady the run was: under ~3% is metronomic, over ~8% is surging. */
  variabilityPercent: number | null;
}

/** Halves within this fraction of each other read as an even split. */
const EVEN_SPLIT_TOLERANCE = 0.01;

export function summarizePace(streams: ActivityStreams, splits: Split[]): PaceSummary | null {
  const total = totalDistanceMeters(streams);
  const duration = totalSeconds(streams);
  if (total <= 0 || duration <= 0) return null;

  const halfTime = timeAtDistance(streams, streams.distance[0] + (total - streams.distance[0]) / 2);
  const firstHalf = halfTime !== null ? halfTime - streams.time[0] : duration / 2;
  const secondHalf = duration - streams.time[0] - firstHalf;
  const delta = secondHalf - firstHalf;
  const tolerance = firstHalf * EVEN_SPLIT_TOLERANCE;
  const shape: SplitShape = delta < -tolerance ? "negative" : delta > tolerance ? "positive" : "even";

  const complete = splits.filter((s) => !s.isPartial);
  let fastest: Split | null = null;
  let slowest: Split | null = null;
  for (const s of complete) {
    if (!fastest || s.paceSecondsPerKm < fastest.paceSecondsPerKm) fastest = s;
    if (!slowest || s.paceSecondsPerKm > slowest.paceSecondsPerKm) slowest = s;
  }

  let variability: number | null = null;
  if (complete.length >= 2) {
    const paces = complete.map((s) => s.paceSecondsPerKm);
    const mean = paces.reduce((a, b) => a + b, 0) / paces.length;
    const variance = paces.reduce((a, b) => a + (b - mean) ** 2, 0) / paces.length;
    variability = mean > 0 ? Math.round((Math.sqrt(variance) / mean) * 1000) / 10 : null;
  }

  return {
    fastestSplitIndex: complete.length >= 2 && fastest ? fastest.index : null,
    slowestSplitIndex: complete.length >= 2 && slowest ? slowest.index : null,
    firstHalfSeconds: Math.round(firstHalf),
    secondHalfSeconds: Math.round(secondHalf),
    halfDeltaSeconds: Math.round(delta),
    shape,
    variabilityPercent: variability,
  };
}
