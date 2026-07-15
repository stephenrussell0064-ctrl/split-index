/**
 * Split Index — memory-based cardio predictions (MASTER-BRIEF.md §5).
 *
 * Each cardio activity keeps a stored predicted benchmark time per user,
 * updated by every session asymmetrically: a faster-predicting session
 * pulls the stored prediction down ~55% of the gap (proven fitness,
 * trusted); a slower-predicting session only nudges it when the session
 * was a genuine quality effort near known capability. Easy runs never
 * move the prediction slower (Part E1). Decay is time-based, not
 * session-based (Part E2). HR reward on equivalents stays intact (E3).
 */

import { BENCHMARK_DISTANCE_METERS, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Riegel exponent for session→benchmark projection. Nudged up slightly from
 * the textbook 1.06 (still used by the free-tier race-ladder predictions,
 * `riegelPredictions` in cardio-activity.ts) after real logged sessions
 * showed the standard exponent under-crediting long, controlled efforts when
 * projected down to a much shorter benchmark distance (e.g. an 18km tempo
 * run projected to 5k) — review further as more real data comes in.
 */
export const RIEGEL_K = 1.08;

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

/** A faster-predicting session pulls the stored prediction down this fraction of the gap (Part E1). */
export const IMPROVE_RATE = 0.55;
/** Alias for callers still using the old name. */
export const FASTER_PULL_FACTOR = IMPROVE_RATE;

/** Hard effort that regressed: gentle pull (Part E1). */
export const REGRESS_RATE = 0.15;

/** Session counts as quality if its equivalent is within this fraction of stored prediction (Part E1). */
export const QUALITY_PROXIMITY = 1.1;

/** Legacy export — replaced by REGRESS_RATE + quality gate; kept for reference only. */
export const SLOWER_NUDGE_FACTOR = 0.04;

/** Time-based prediction decay (Part E2). */
export const PREDICTION_DECAY = {
  graceDays: 14,
  ratePerWeekInactive: 0.004,
  qualityGraceDays: 60,
  ratePerWeekNoQuality: 0.001,
  maxDecay: 0.15,
} as const;

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

/**
 * Lower avg HR than the sport's reference yields a faster (better) equivalent
 * time, capped at a 10% bonus. Deliberately bonus-only (never a penalty
 * above reference): a near-max HR is the expected, correct signature of a
 * genuinely hard short effort (e.g. an all-out 5k), not an efficiency
 * deficiency — penalizing it above reference was inflating equivalent times,
 * and therefore lowering scores, for exactly the hardest, most legitimate
 * efforts.
 */
export function hrAdjustedEquivalentSeconds(
  time: number,
  avgHR: number | null | undefined,
  refHR: number
): number {
  if (!avgHR || avgHR <= 0) return time;
  const adjustment = clamp((refHR - avgHR) / HR_ADJUST_SENSITIVITY, 0, HR_ADJUST_MAX);
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
    const pacePerKm = durationSeconds / (distanceMeters / 1000);
    return hrAdjustedEquivalentSeconds(pacePerKm, avgHR, HR_ADJUST_REF_HR.walk);
  }

  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[sport];
  const projected = riegelEquivalentSeconds(durationSeconds, distanceMeters, benchmarkDistance, riegelK);
  return hrAdjustedEquivalentSeconds(projected, avgHR, HR_ADJUST_REF_HR[sport]);
}

/** True when a session's equivalent is close enough to stored capability to count as quality (Part E1). */
export function isQualityEffort(storedSeconds: number, equivSeconds: number): boolean {
  if (storedSeconds <= 0 || equivSeconds <= 0) return false;
  return equivSeconds <= storedSeconds * QUALITY_PROXIMITY;
}

/**
 * Asymmetric memory update (Part E1): easy runs never move prediction slower.
 */
export function updatePrediction(storedSec: number, equivSec: number): number {
  if (equivSec < storedSec) {
    return storedSec + (equivSec - storedSec) * IMPROVE_RATE;
  }
  if (isQualityEffort(storedSec, equivSec)) {
    return storedSec + (equivSec - storedSec) * REGRESS_RATE;
  }
  return storedSec;
}

/**
 * Time-based decay on stored prediction (Part E2).
 * `daysSinceAnyRun` — days since last session of any intensity.
 * `daysSinceQuality` — days since last quality effort.
 */
export function applyDecay(
  storedSec: number,
  daysSinceAnyRun: number,
  daysSinceQuality: number
): number {
  let d = 0;
  if (daysSinceAnyRun > PREDICTION_DECAY.graceDays) {
    d =
      PREDICTION_DECAY.ratePerWeekInactive *
      ((daysSinceAnyRun - PREDICTION_DECAY.graceDays) / 7);
  } else if (daysSinceQuality > PREDICTION_DECAY.qualityGraceDays) {
    d =
      PREDICTION_DECAY.ratePerWeekNoQuality *
      ((daysSinceQuality - PREDICTION_DECAY.qualityGraceDays) / 7);
  }
  return storedSec * (1 + Math.min(d, PREDICTION_DECAY.maxDecay));
}

/** Apply decay to a stored benchmark before using it for scoring. */
export function effectiveStoredPrediction(
  storedSeconds: number,
  lastRunAt: Date | string | null | undefined,
  lastQualityAt: Date | string | null | undefined,
  now: Date = new Date()
): number {
  const nowMs = now.getTime();
  const daysSince = (at: Date | string | null | undefined) => {
    if (!at) return Infinity;
    const ms = typeof at === "string" ? new Date(at).getTime() : at.getTime();
    if (!Number.isFinite(ms)) return Infinity;
    return Math.max(0, (nowMs - ms) / 86_400_000);
  };
  return applyDecay(
    storedSeconds,
    daysSince(lastRunAt),
    daysSince(lastQualityAt)
  );
}

/**
 * Asymmetric memory update: blend this session's benchmark-equivalent into
 * the previously stored prediction. Seeds the prediction on the first
 * session (no previous value).
 */
export function blendPredictedBenchmark(previousSeconds: number | null, sessionSeconds: number): number {
  if (previousSeconds == null || !Number.isFinite(previousSeconds)) return sessionSeconds;
  return updatePrediction(previousSeconds, sessionSeconds);
}

/** Whether this session should refresh the last-quality timestamp. */
export function sessionCountsAsQuality(
  previousSeconds: number | null,
  sessionSeconds: number
): boolean {
  if (previousSeconds == null) return true;
  return sessionSeconds <= previousSeconds || isQualityEffort(previousSeconds, sessionSeconds);
}
