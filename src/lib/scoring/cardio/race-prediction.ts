/**
 * Split Index — two-tier race prediction (CLAUDE-CODE-BRIEF-race-
 * prediction-model.md).
 * -----------------------------------------------------------------
 * Extends the existing memory-prediction system (Riegel, HR-adjusted,
 * asymmetric update, session-type quality weighting, decay — all in
 * cardio-predictions.ts, unchanged) rather than replacing it. That system
 * already IS most of what "based on all activities logged" means — a
 * continuously-updated value built from history, not a single-session
 * snapshot. What this module adds:
 *
 * Tier 1 — a fresh, independent, per-session prediction from just that
 * session's own distance/pace/HR (or power, or a pair of time-trial swims
 * where available). Shown immediately after logging, as a RANGE (never a
 * bare point estimate — Tier 1 carries the widest uncertainty of the two
 * tiers). Feeds INTO Tier 2 the same way it already does today, through
 * the existing asymmetric-update rule — it never overwrites Tier 2
 * directly.
 *
 * Tier 2 — the profile-level number (stored in `predicted_benchmarks`,
 * one row per user per sport). Still driven primarily by the existing
 * sequential asymmetric update, but blended with a fit across the FULL
 * rolling-window history (90 days, matching the personalized-HR system's
 * own window) so it visibly reflects accumulated history, not just the
 * most recent nudge. Running gets a Tanda-inspired weekly-volume + mean-
 * pace adjustment specifically (the best-evidenced no-race-required model
 * the research review found); everything else gets a generic critical-
 * speed-style linear refit across the window's sessions.
 *
 * Below 5 sessions in the window, Tier 2 is reported as "calibrating"
 * rather than a number (`tier2IsCalibrating`).
 */

import type { SessionType } from "@/types";
import {
  BENCHMARK_DISTANCE_METERS,
  type BenchmarkSport,
} from "@/lib/scoring/cardio-benchmarks";
import {
  computeSessionBenchmarkEquivalentSeconds,
  riegelEquivalentSeconds,
  impliedRiegelK,
  personalizedRiegelK,
  type HrPersonalization,
} from "@/lib/scoring/cardio-predictions";

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

// ---------------------------------------------------------------------------
// Tier 1 — per-session prediction
// ---------------------------------------------------------------------------

export type Tier1Confidence = "high" | "medium" | "low";
export type Tier1Method =
  | "row-derived"
  | "power-cubic-scaling"
  | "critical-swim-speed"
  | "hr-anchored";

export interface Tier1Prediction {
  /** Point estimate — internal use (e.g. feeding Tier 2's blend). Never display this alone; use rangeSeconds. */
  predictedSeconds: number;
  /** What actually gets displayed — never a bare point estimate (brief's display requirement). */
  rangeSeconds: [number, number];
  method: Tier1Method;
  confidence: Tier1Confidence;
}

/** Range width by confidence — wider for less-certain methods. */
const TIER1_RANGE_FRACTION: Record<Tier1Confidence, number> = {
  high: 0.03,
  medium: 0.05,
  low: 0.08,
};

function toRange(pointSeconds: number, confidence: Tier1Confidence): [number, number] {
  const frac = TIER1_RANGE_FRACTION[confidence];
  return [
    Math.round(pointSeconds * (1 - frac) * 10) / 10,
    Math.round(pointSeconds * (1 + frac) * 10) / 10,
  ];
}

/**
 * Coggan-style mean-maximal-power profile, simplified to a handful of
 * duration bands (log-linearly interpolated between them) rather than a
 * full curve — this is a widely-used approximation, not athlete-specific
 * lab data. Fraction is power-at-this-duration ÷ FTP; FTP is defined here
 * at 60 minutes (fraction 1.0), matching the standard convention.
 */
const FTP_DURATION_BANDS: Array<[seconds: number, fractionOfFtp: number]> = [
  [5, 2.5],
  [60, 1.5],
  [300, 1.15],
  [1200, 1.053], // 20-min test — matches the common "×0.95 = FTP" shortcut
  [3600, 1.0], // FTP itself, by definition
  [5400, 0.9],
  [7200, 0.85],
];

function fractionOfFtpForDuration(durationSeconds: number): number {
  const bands = FTP_DURATION_BANDS;
  if (durationSeconds <= bands[0][0]) return bands[0][1];
  if (durationSeconds >= bands[bands.length - 1][0]) return bands[bands.length - 1][1];
  for (let i = 0; i < bands.length - 1; i++) {
    const [t0, f0] = bands[i];
    const [t1, f1] = bands[i + 1];
    if (durationSeconds >= t0 && durationSeconds <= t1) {
      // Log-linear on time (power duration curves are steep and non-linear on raw time).
      const logT = Math.log(durationSeconds);
      const t = (logT - Math.log(t0)) / (Math.log(t1) - Math.log(t0));
      return f0 + (f1 - f0) * t;
    }
  }
  return 1.0;
}

/** Estimate FTP (watts) from a single session's average power + duration. */
export function estimateFtpWatts(avgPowerWatts: number, durationSeconds: number): number {
  return avgPowerWatts / fractionOfFtpForDuration(durationSeconds);
}

/**
 * Cycling Tier 1 — power removes the HR-nonlinearity problem entirely (the
 * cleanest activity in the brief). Uses the athlete's OWN observed
 * power-speed relationship from this session (power ∝ speed³, the standard
 * aerodynamic-drag-dominated approximation), scaled from their own effort
 * to their estimated threshold power — not a population power-to-speed
 * conversion table.
 */
export function computeCyclingPowerTier1(
  distanceMeters: number,
  durationSeconds: number,
  avgPowerWatts: number
): Tier1Prediction | null {
  if (distanceMeters <= 0 || durationSeconds <= 0 || avgPowerWatts <= 0) return null;
  const observedSpeedMps = distanceMeters / durationSeconds;
  const ftpWatts = estimateFtpWatts(avgPowerWatts, durationSeconds);
  const speedAtFtpMps = observedSpeedMps * Math.pow(ftpWatts / avgPowerWatts, 1 / 3);
  if (!Number.isFinite(speedAtFtpMps) || speedAtFtpMps <= 0) return null;
  const predictedSeconds = BENCHMARK_DISTANCE_METERS.cycle / speedAtFtpMps;
  if (!Number.isFinite(predictedSeconds) || predictedSeconds <= 0) return null;
  return {
    predictedSeconds,
    rangeSeconds: toRange(predictedSeconds, "high"),
    method: "power-cubic-scaling",
    confidence: "high",
  };
}

export interface SwimEffort {
  distanceMeters: number;
  durationSeconds: number;
}

/**
 * Classic 2-point critical speed model: distance = CS × time + D′ (D′ is
 * "anaerobic distance capacity"). Requires two genuinely different-distance
 * time-trial efforts — noisy/unreliable from two very close distances.
 */
export function computeCriticalSwimSpeed(
  shorter: SwimEffort,
  longer: SwimEffort
): { cssMetersPerSecond: number; anaerobicCapacityMeters: number } | null {
  if (shorter.distanceMeters <= 0 || longer.distanceMeters <= 0) return null;
  if (shorter.durationSeconds <= 0 || longer.durationSeconds <= 0) return null;
  if (longer.distanceMeters <= shorter.distanceMeters) return null;
  const dDist = longer.distanceMeters - shorter.distanceMeters;
  const dTime = longer.durationSeconds - shorter.durationSeconds;
  if (dTime <= 0) return null;
  const cssMetersPerSecond = dDist / dTime;
  const anaerobicCapacityMeters = shorter.distanceMeters - cssMetersPerSecond * shorter.durationSeconds;
  return { cssMetersPerSecond, anaerobicCapacityMeters };
}

/**
 * Pick the pair of "time-trial" swim efforts to feed Critical Swim Speed —
 * the shortest and longest distinct distances within the caller-filtered
 * candidate set (e.g. `session_type === "race"` swims in the window), same
 * max-separation approach as `personalizeRiegelKFromWindow` (two very close
 * distances give a noisy, unreliable CS fit).
 */
export function pickSwimTimeTrialEfforts(candidateEfforts: SwimEffort[]): [SwimEffort, SwimEffort] | null {
  const valid = candidateEfforts.filter((s) => s.distanceMeters > 0 && s.durationSeconds > 0);
  if (valid.length < 2) return null;
  const sorted = [...valid].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const shortest = sorted[0];
  const longest = sorted[sorted.length - 1];
  if (longest.distanceMeters < shortest.distanceMeters * (1 + MIN_DISTANCE_SEPARATION_FRACTION)) {
    return null;
  }
  return [shortest, longest];
}

/** Swim Tier 1 via Critical Swim Speed — preferred over HR when two time-trial efforts exist (brief). */
export function computeSwimCssTier1(shorter: SwimEffort, longer: SwimEffort): Tier1Prediction | null {
  const css = computeCriticalSwimSpeed(shorter, longer);
  if (!css || css.cssMetersPerSecond <= 0) return null;
  const predictedSeconds =
    (BENCHMARK_DISTANCE_METERS.swim - css.anaerobicCapacityMeters) / css.cssMetersPerSecond;
  if (!Number.isFinite(predictedSeconds) || predictedSeconds <= 0) return null;
  return {
    predictedSeconds,
    rangeSeconds: toRange(predictedSeconds, "high"),
    method: "critical-swim-speed",
    confidence: "high",
  };
}

export interface Tier1Input {
  benchmarkSport: BenchmarkSport;
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  avgPowerWatts?: number | null;
  personalization?: HrPersonalization;
  riegelK?: number;
  /** Two most recent distinct-distance "time-trial" swim efforts within the window (shorter first) — enables Critical Swim Speed. Swim only; omit/null to always use the HR fallback. */
  swimTimeTrialEfforts?: [SwimEffort, SwimEffort] | null;
}

function fallbackMethodAndConfidence(
  sport: BenchmarkSport,
  hasHR: boolean
): { method: Tier1Method; confidence: Tier1Confidence } {
  if (sport === "row") return { method: "row-derived", confidence: "high" };
  if (sport === "ski") return { method: "row-derived", confidence: "medium" };
  // Running: explicitly flagged in the brief as the weakest-supported
  // activity for single-session HR extrapolation (cardiac drift, HR/pace
  // nonlinearity below threshold) — always low confidence here, even with HR.
  if (sport === "run") return { method: "hr-anchored", confidence: "low" };
  // Swim without time-trial data: explicitly instructed to label the HR
  // fallback lower-confidence.
  if (sport === "swim") return { method: "hr-anchored", confidence: "low" };
  return { method: "hr-anchored", confidence: hasHR ? "medium" : "low" };
}

/**
 * Compute this session's own Tier 1 prediction — activity-aware per the
 * brief's model-choice table. Falls through: cycling power (if power data
 * present) -> swim CSS (if two time-trial efforts present) -> generic
 * HR-anchored pace-scaling (row/ski/run/walk, and cycle/swim without their
 * preferred data).
 */
export function computeTier1Prediction(input: Tier1Input): Tier1Prediction | null {
  const { benchmarkSport } = input;

  if (benchmarkSport === "cycle" && input.avgPowerWatts && input.avgPowerWatts > 0) {
    const result = computeCyclingPowerTier1(
      input.distanceMeters,
      input.durationSeconds,
      input.avgPowerWatts
    );
    if (result) return result;
  }

  if (benchmarkSport === "swim" && input.swimTimeTrialEfforts) {
    const [shorter, longer] = input.swimTimeTrialEfforts;
    const result = computeSwimCssTier1(shorter, longer);
    if (result) return result;
  }

  const equivalentSeconds = computeSessionBenchmarkEquivalentSeconds(
    benchmarkSport,
    input.distanceMeters,
    input.durationSeconds,
    input.avgHR,
    input.riegelK,
    input.personalization
  );
  if (equivalentSeconds === null) return null;

  const { method, confidence } = fallbackMethodAndConfidence(benchmarkSport, !!input.avgHR);
  return { predictedSeconds: equivalentSeconds, rangeSeconds: toRange(equivalentSeconds, confidence), method, confidence };
}

// ---------------------------------------------------------------------------
// Riegel exponent personalization (feeds Tier 2's cross-distance conversion)
// ---------------------------------------------------------------------------

export interface HistorySession {
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  sessionType?: SessionType | null;
  startedAt: string | Date;
}

/** Distances must differ by at least this fraction to count as genuinely different (not noise around the same route). */
const MIN_DISTANCE_SEPARATION_FRACTION = 0.15;

/**
 * Derive this user's personal Riegel k from their own cross-distance
 * history within the window — the shortest and longest logged distances
 * give the most stable implied exponent (two very close distances are
 * dominated by pacing noise, not the real speed/endurance trade-off).
 * Returns the unchanged stored value when there isn't enough distance
 * separation to trust a new implied k.
 */
export function personalizeRiegelKFromWindow(
  sessions: HistorySession[],
  storedK: number | null
): number | null {
  const valid = sessions.filter((s) => s.distanceMeters > 0 && s.durationSeconds > 0);
  if (valid.length < 2) return storedK;

  const sorted = [...valid].sort((a, b) => a.distanceMeters - b.distanceMeters);
  const shortest = sorted[0];
  const longest = sorted[sorted.length - 1];
  if (longest.distanceMeters < shortest.distanceMeters * (1 + MIN_DISTANCE_SEPARATION_FRACTION)) {
    return storedK;
  }

  const implied = impliedRiegelK(
    shortest.distanceMeters,
    shortest.durationSeconds,
    longest.distanceMeters,
    longest.durationSeconds
  );
  if (implied === null) return storedK;
  return personalizedRiegelK(storedK, implied);
}

// ---------------------------------------------------------------------------
// Tier 2 — windowed profile-level enhancement
// ---------------------------------------------------------------------------

/** Below this many samples in the window, Tier 2 reports "calibrating" instead of a number (brief's acceptance criterion). */
export const TIER2_MIN_SAMPLES_TO_DISPLAY = 5;

export function tier2IsCalibrating(sampleCount: number): boolean {
  return sampleCount < TIER2_MIN_SAMPLES_TO_DISPLAY;
}

function spanDays(sessions: HistorySession[]): number {
  if (sessions.length === 0) return 0;
  const times = sessions.map((s) => new Date(s.startedAt).getTime()).filter(Number.isFinite);
  if (times.length === 0) return 0;
  const spanMs = Math.max(...times) - Math.min(...times);
  return Math.max(1, spanMs / 86_400_000);
}

/** Quality weighting for the running volume+pace estimate — a hard tempo/threshold/race effort says more about fitness than an easy recovery jog of the same pace. */
const SESSION_TYPE_QUALITY_WEIGHT: Partial<Record<SessionType, number>> = {
  race: 1.5,
  tempo: 1.2,
  threshold: 1.2,
  interval: 1.1,
  fartlek: 1.1,
  long: 1.0,
  other: 1.0,
  easy: 0.7,
  recovery: 0.5,
};

const REFERENCE_WEEKLY_VOLUME_KM = 40; // rough "solid recreational base" reference point
const MAX_VOLUME_ADJUSTMENT_FRACTION = 0.05; // deliberately modest — nudges, doesn't dominate

/**
 * Tanda-inspired running estimate: quality-weighted mean pace (each
 * session's own pace projected to the benchmark distance via the
 * personalized Riegel k, then averaged) adjusted by weekly training
 * volume relative to a reference band. This is a documented proxy for
 * Tanda's finding (weekly volume + mean pace explain ~77% of marathon-time
 * variance) — not a literal reproduction of his fitted coefficients, which
 * aren't precisely known here; the volume adjustment is deliberately
 * capped small so it nudges rather than dominates, same philosophy as the
 * existing scoring bonuses.
 */
function tandaStyleRunningEstimate(sessions: HistorySession[], riegelK: number): number | null {
  const windowDays = spanDays(sessions);
  if (windowDays <= 0) return null;

  let weightedSum = 0;
  let weightTotal = 0;
  let totalDistanceMeters = 0;

  for (const s of sessions) {
    const weight = SESSION_TYPE_QUALITY_WEIGHT[s.sessionType ?? "other"] ?? 1.0;
    const equivalentSeconds = riegelEquivalentSeconds(
      s.durationSeconds,
      s.distanceMeters,
      BENCHMARK_DISTANCE_METERS.run,
      riegelK
    );
    weightedSum += equivalentSeconds * weight;
    weightTotal += weight;
    totalDistanceMeters += s.distanceMeters;
  }
  if (weightTotal <= 0) return null;
  const meanPaceEquivalentSeconds = weightedSum / weightTotal;

  const weeklyVolumeKm = totalDistanceMeters / 1000 / (windowDays / 7);
  const volumeRatio = clamp(weeklyVolumeKm / REFERENCE_WEEKLY_VOLUME_KM, 0.5, 2);
  const volumeAdjustment = clamp(
    (1 - volumeRatio) * 0.1,
    -MAX_VOLUME_ADJUSTMENT_FRACTION,
    MAX_VOLUME_ADJUSTMENT_FRACTION
  );

  return meanPaceEquivalentSeconds * (1 + volumeAdjustment);
}

/**
 * Generic critical-speed-style linear refit (distance = CS × time + D′)
 * across the window's sessions — "a personalized critical-speed/power fit
 * across a user's best recent efforts" per the brief, for row/cycle/swim/
 * ski/walk's Tier 2 (running gets the Tanda-style treatment instead).
 * Ordinary least squares over each session's own (duration, distance) pair.
 */
function criticalSpeedRefit(sport: BenchmarkSport, sessions: HistorySession[]): number | null {
  const n = sessions.length;
  if (n < TIER2_MIN_SAMPLES_TO_DISPLAY) return null;

  let sumT = 0;
  let sumD = 0;
  let sumTT = 0;
  let sumTD = 0;
  for (const s of sessions) {
    sumT += s.durationSeconds;
    sumD += s.distanceMeters;
    sumTT += s.durationSeconds * s.durationSeconds;
    sumTD += s.durationSeconds * s.distanceMeters;
  }
  const denom = n * sumTT - sumT * sumT;
  if (denom === 0) return null;

  const criticalSpeed = (n * sumTD - sumT * sumD) / denom; // meters/second
  const dPrime = (sumD - criticalSpeed * sumT) / n;
  if (criticalSpeed <= 0) return null;

  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[sport];
  const predictedSeconds = (benchmarkDistance - dPrime) / criticalSpeed;
  if (!Number.isFinite(predictedSeconds) || predictedSeconds <= 0) return null;
  return predictedSeconds;
}

/**
 * Blend the existing sequential asymmetric-update value (still the primary
 * mechanism — unchanged) with a fit across the full rolling-window
 * history, so Tier 2 visibly incorporates accumulated history rather than
 * only the most recent nudge. Weight ramps up with more window history,
 * capped at 50% so the asymmetric-update mechanism (which already protects
 * against one noisy session skewing things) always stays the dominant
 * driver — this extends the existing system, it doesn't replace it.
 */
export function computeWindowedTier2Seconds(
  sport: BenchmarkSport,
  sequentialSeconds: number,
  windowSessions: HistorySession[],
  riegelK: number
): number {
  const valid = windowSessions.filter((s) => s.distanceMeters > 0 && s.durationSeconds > 0);
  if (valid.length < TIER2_MIN_SAMPLES_TO_DISPLAY) return sequentialSeconds;

  const windowedSeconds =
    sport === "run" ? tandaStyleRunningEstimate(valid, riegelK) : criticalSpeedRefit(sport, valid);
  if (windowedSeconds === null) return sequentialSeconds;

  const windowWeight = Math.min(0.5, valid.length / 20);
  return sequentialSeconds * (1 - windowWeight) + windowedSeconds * windowWeight;
}
