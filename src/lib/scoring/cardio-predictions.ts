/**
 * Split Index — memory-based cardio predictions (MASTER-BRIEF.md §5).
 *
 * Each cardio activity keeps a stored predicted benchmark time per user,
 * updated by every session asymmetrically: a faster-predicting session
 * pulls the stored prediction down ~55% of the gap (proven fitness,
 * trusted); a slower-predicting session nudges it only ~4% (easy days
 * hold, never crater it). Every session projects to the benchmark distance
 * via Riegel, then HR-adjusts the result so a lower-HR session yields a
 * faster (better) equivalent — every session can contribute, even easy
 * ones, if HR improved.
 */

import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Riegel exponent — same value used for the free-tier race-ladder predictions. */
export const RIEGEL_K = 1.06;

/** Reference avg HR per sport for the HR-adjustment below — mid-tempo effort at that activity. */
const HR_ADJUST_REF_HR: Record<BenchmarkSport, number> = {
  run: 175,
  walk: 140,
  row: 175,
  swim: 160,
  cycle: 165,
  ski: 175,
};

const HR_ADJUST_SENSITIVITY = 450;
const HR_ADJUST_MAX = 0.1;

/** A faster-predicting session pulls the stored prediction down this fraction of the gap. */
export const FASTER_PULL_FACTOR = 0.55;
/** A slower-predicting session only nudges the stored prediction by this fraction of the gap. */
export const SLOWER_NUDGE_FACTOR = 0.04;

/** Riegel equivalent: predicted = time × (toDistance/fromDistance)^k. */
export function riegelEquivalentSeconds(
  time: number,
  fromDistanceMeters: number,
  toDistanceMeters: number,
  k: number = RIEGEL_K
): number {
  if (fromDistanceMeters <= 0 || toDistanceMeters <= 0 || time <= 0) return time;
  return time * Math.pow(toDistanceMeters / fromDistanceMeters, k);
}

/** Lower avg HR than the sport's reference yields a faster (better) equivalent time, clamped to ±10%. */
export function hrAdjustedEquivalentSeconds(
  time: number,
  avgHR: number | null | undefined,
  refHR: number
): number {
  if (!avgHR || avgHR <= 0) return time;
  const adjustment = clamp((refHR - avgHR) / HR_ADJUST_SENSITIVITY, -HR_ADJUST_MAX, HR_ADJUST_MAX);
  return time * (1 - adjustment);
}

/**
 * Project a single session to its sport's benchmark distance (or, for
 * walking, its per-km pace) and HR-adjust the result. Returns null when
 * there's no distance/duration to project from.
 */
export function computeSessionBenchmarkEquivalentSeconds(
  sport: BenchmarkSport,
  distanceMeters: number,
  durationSeconds: number,
  avgHR?: number | null,
  riegelK: number = RIEGEL_K
): number | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;

  if (sport === "walk") {
    // Walking pace is close to distance-invariant (steady-state effort, not
    // a race distance) — score the session's own per-km pace directly
    // rather than Riegel-projecting it to a fixed distance.
    const pacePerKm = durationSeconds / (distanceMeters / 1000);
    return hrAdjustedEquivalentSeconds(pacePerKm, avgHR, HR_ADJUST_REF_HR.walk);
  }

  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[sport];
  const projected = riegelEquivalentSeconds(durationSeconds, distanceMeters, benchmarkDistance, riegelK);
  return hrAdjustedEquivalentSeconds(projected, avgHR, HR_ADJUST_REF_HR[sport]);
}

/**
 * Asymmetric memory update: blend this session's benchmark-equivalent into
 * the previously stored prediction. Seeds the prediction on the first
 * session (no previous value).
 */
export function blendPredictedBenchmark(previousSeconds: number | null, sessionSeconds: number): number {
  if (previousSeconds == null || !Number.isFinite(previousSeconds)) return sessionSeconds;
  const gap = sessionSeconds - previousSeconds; // negative = session is faster than the stored prediction
  const pull = gap < 0 ? FASTER_PULL_FACTOR : SLOWER_NUDGE_FACTOR;
  return previousSeconds + gap * pull;
}
