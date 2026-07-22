/**
 * Split Index — Cardio scoring engine ("The Engine")
 * ---------------------------------------------------
 * Every activity (run / walk / row / swim / cycle / ski) gets a per-activity
 * score on a 0–1000 scale, plus the underlying physiological estimates
 * (VO2max, predicted race times, training load) that justify it.
 *
 * Primary scoring path (MASTER-BRIEF.md §4–5): every session is projected to
 * its sport's benchmark distance via Riegel, then HR-adjusted so a lower-HR
 * session yields a faster (better) equivalent. That equivalent blends
 * asymmetrically into a per-user, per-sport memory (`storedPredictionSeconds`,
 * maintained by the caller across sessions) — a faster effort pulls the
 * memory down fast, a slower one barely nudges it, so an easy low-HR session
 * scores comparably to a hard one of equal underlying fitness, and effort
 * alone (going slower for no reason) can't tank the score. The blended time
 * is scored on a calibrated anchor table (see cardio-benchmarks.ts) matching
 * the universal tier bands. When no memory is supplied yet (first session),
 * this session's own equivalent is scored directly.
 *
 * FREE tier reads `score` and `vo2max`.
 * PREMIUM tier additionally surfaces `trimp`, `efficiencyFactor`,
 * `decoupling`, `predictions`, and `confidence`.
 *
 * Sources (verify on review):
 *  - VO2max HR-ratio: Uth, Sørensen, Overgaard & Pedersen (2004) — 15.3 × HRmax/HRrest
 *  - HRmax fallback:  Tanaka (2001) — 208 − 0.7 × age
 *  - %HRR ≈ %VO2R:    Swain & Leutholtz (1997) heart-rate-reserve method (ACSM)
 *  - Race prediction: Riegel (1977) — T2 = T1 × (D2/D1)^k
 *  - Training load:   Banister TRIMP (1991), sex-specific weighting
 */

import type { SessionType } from "@/types";
import { timeToScore, type BenchmarkSport } from "@/lib/scoring/cardio-benchmarks";
import {
  computeSessionBenchmarkEquivalentSeconds,
  computeIntervalBenchmarkEquivalentSeconds,
} from "@/lib/scoring/cardio-predictions";
import {
  intervalEquivalentPaceSecPerKm,
  intervalTotalWorkDistanceMeters,
  fartlekEquivalentPaceSecPerKm,
  isValidIntervalWorkPiece,
  isValidFartlekOnPiece,
  type IntervalWorkPiece,
  type FartlekOnPiece,
} from "@/lib/scoring/cardio/interval-scoring";

export type Sex = 'male' | 'female';
export type CardioType = 'run' | 'row' | 'swim';
export type { BenchmarkSport };

export interface CardioInput {
  type: CardioType;
  /** Granular benchmark bucket driving the primary anchor-table score (run/walk/row/swim/cycle/ski). */
  benchmarkSport: BenchmarkSport;
  distanceMeters: number;
  durationSeconds: number;
  sex: Sex;
  age: number;
  restingHR?: number;      // bpm — optional, unlocks VO2max ratio method
  maxHR?: number;          // bpm — measured; else estimated from age
  avgHR?: number;          // bpm — unlocks TRIMP + efficiency factor
  firstHalfAvgHR?: number; // bpm — unlocks decoupling
  secondHalfAvgHR?: number;
  firstHalfPaceSecPerKm?: number;  // unlocks pace-based decoupling
  secondHalfPaceSecPerKm?: number;
  experience?: 'beginner' | 'intermediate' | 'advanced';
  sessionType?: SessionType | null;  // self-reported intent (easy, race, ...)
  /** Structured interval reps — when present, the benchmark equivalent is seeded from work-piece pace (rest-ratio converted) instead of the whole-session average. */
  structuredInterval?: IntervalWorkPiece | null;
  /** Fartlek "on" distance/time — same work-piece treatment once resolved to an equivalent pace. */
  structuredFartlek?: FartlekOnPiece | null;
  rpe?: number | null;                // 1–10 perceived effort
  elevationMeters?: number | null;    // total climb, unlocks a terrain-difficulty bonus
  temperatureCelsius?: number | null; // unlocks a heat/cold-difficulty bonus
  /** Multi-session memory (seconds at the benchmark distance) — see cardio-predictions.ts. Omit for a one-off, session-only score. */
  storedPredictionSeconds?: number | null;
}

export interface CardioResult {
  score: number;               // 0–1000, the per-activity Engine contribution
  vo2max: number | null;       // ml/kg/min
  vo2maxMethod: 'hr-ratio' | 'pace-hr-adjusted' | 'pace-estimate' | 'none';
  trimp: number | null;
  efficiencyFactor: number | null;
  decouplingPct: number | null;
  predictions: Record<string, number> | null; // distance(m) -> seconds
  confidence: number;          // 0–1, how much HR data backed this score
  flags: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const DEFAULT_RESTING_HR = 60;
// %HRR treated as the "working hard" reference point (roughly tempo/threshold
// effort). Observed pace at a lower %HRR is scaled toward this reference.
// Used only for the supplementary VO2max estimate shown in premium panels —
// the primary score comes from the benchmark anchor tables (see below).
const REFERENCE_EFFORT_FRACTION = 0.85;
const MIN_EFFORT_FRACTION = 0.35;
const MAX_EFFORT_FRACTION = 1.05;
// Cap how far the pace/effort extrapolation is trusted, rather than
// uniformly damping it — the %HRR-pace relationship holds reasonably well
// for realistic easy-to-moderate efforts (where this cap never engages),
// but linear extrapolation breaks down for very low effort fractions
// (a light recovery jog isn't reliable evidence of near-max pace), so the
// ratio is bounded instead of scaled down everywhere.
const MAX_NORMALIZATION_RATIO = 1.6;

// Volume/terrain/environment bonuses — orthogonal to the pace/HR-based base
// score above. A long session, a hilly one, or one done in harsh heat/cold
// demonstrates something a pure pace-per-heartbeat estimate can't: sustained
// aerobic durability. These are deliberately modest relative to `base`
// (0–1000) so they nudge, not dominate, the score.
// Raised from 70/60min after real long sessions (an 18km tempo run, a 40min
// row) showed the old cap under-crediting genuine sustained aerobic
// durability relative to user-reported expectations — review further as
// more real data comes in.
const MAX_VOLUME_BONUS = 110;
const VOLUME_HALF_SATURATION_MINUTES = 45; // minutes at which half of MAX_VOLUME_BONUS is earned
const MAX_ELEVATION_BONUS = 25;
const REFERENCE_GRADIENT_M_PER_KM = 15; // climb rate treated as "hilly"
const MAX_TEMPERATURE_BONUS = 15;
const REFERENCE_COMFORT_TEMP_C = 12;
const TEMPERATURE_SENSITIVITY = 100; // divisor on squared deviation from comfort

/** Rewards sheer time-under-aerobic-load, independent of how fast or easy it was. */
function enduranceVolumeBonus(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const minutes = durationSeconds / 60;
  return MAX_VOLUME_BONUS * (minutes / (minutes + VOLUME_HALF_SATURATION_MINUTES));
}

/** Rewards climbing — the same pace/HR is a harder effort on hillier terrain. */
function elevationDifficultyBonus(elevationMeters?: number | null, distanceMeters?: number | null): number {
  if (!elevationMeters || elevationMeters <= 0 || !distanceMeters || distanceMeters <= 0) return 0;
  const gradientPerKm = elevationMeters / (distanceMeters / 1000);
  const sigmoid = 1 / (1 + Math.exp(-(gradientPerKm - REFERENCE_GRADIENT_M_PER_KM) / 10));
  return sigmoid * MAX_ELEVATION_BONUS;
}

/** Rewards heat/cold — deviation from a comfortable reference temperature in either direction. */
function temperatureDifficultyBonus(temperatureCelsius?: number | null): number {
  if (temperatureCelsius == null) return 0;
  const deviation = temperatureCelsius - REFERENCE_COMFORT_TEMP_C;
  const factor = 1 - Math.exp(-(deviation * deviation) / TEMPERATURE_SENSITIVITY);
  return factor * MAX_TEMPERATURE_BONUS;
}

/** %HRR for this specific session — falls back to a population-average resting HR if none is on file. */
function computeEffortFraction(avgHR?: number, restingHR?: number, maxHR?: number, age?: number): number | null {
  if (!avgHR || avgHR <= 0) return null;
  const hrMax = maxHR && maxHR > 0 ? maxHR : estimateMaxHR(age ?? 30);
  const hrRest = restingHR && restingHR > 0 ? restingHR : DEFAULT_RESTING_HR;
  if (hrMax <= hrRest) return null;
  return clamp((avgHR - hrRest) / (hrMax - hrRest), MIN_EFFORT_FRACTION, MAX_EFFORT_FRACTION);
}

/** Scales pace toward a threshold-equivalent effort — full credit for realistic deviations, capped for extreme ones. */
function effortNormalizedSpeed(rawSpeedMetersPerSec: number, effortFraction: number | null): number {
  if (effortFraction === null || effortFraction <= 0) return rawSpeedMetersPerSec;
  const ratio = clamp(
    REFERENCE_EFFORT_FRACTION / effortFraction,
    1 / MAX_NORMALIZATION_RATIO,
    MAX_NORMALIZATION_RATIO
  );
  return rawSpeedMetersPerSec * ratio;
}

/** Tanaka (2001) age-predicted max HR. */
export function estimateMaxHR(age: number): number {
  return 208 - 0.7 * age;
}

/**
 * VO2max via the heart-rate-ratio method (Uth et al. 2004).
 * Requires a resting HR and a max HR (measured preferred, else age-estimated).
 * Returns null when resting HR is unavailable.
 */
export function vo2maxFromHR(restingHR?: number, maxHR?: number, age?: number): {
  value: number | null;
  method: CardioResult['vo2maxMethod'];
} {
  if (restingHR && restingHR > 0) {
    const hrMax = maxHR && maxHR > 0 ? maxHR : (age ? estimateMaxHR(age) : null);
    if (hrMax) return { value: 15.3 * (hrMax / restingHR), method: 'hr-ratio' };
  }
  return { value: null, method: 'none' };
}

/**
 * Running-only VO2 estimate from velocity (Daniels/ACSM-style running economy).
 * Used as a cross-check for runs when HR data is absent. Not valid for row/swim.
 */
export function vo2FromRunningPace(distanceMeters: number, durationSeconds: number): number | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;
  const vMetersPerMin = distanceMeters / (durationSeconds / 60);
  // ACSM running VO2 (ml/kg/min) for the working rate; approximates sustained VO2.
  const vo2 = 0.2 * vMetersPerMin + 3.5;
  return vo2 > 0 ? vo2 : null;
}

/** Riegel race-time predictions across the standard ladder. */
export function riegelPredictions(
  distanceMeters: number,
  durationSeconds: number,
  experience: CardioInput['experience'] = 'intermediate'
): Record<string, number> | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;
  const k = experience === 'beginner' ? 1.08 : experience === 'advanced' ? 1.04 : 1.06;
  const ladder = [1500, 5000, 10000, 21097.5, 42195];
  const out: Record<string, number> = {};
  for (const d of ladder) out[String(d)] = durationSeconds * Math.pow(d / distanceMeters, k);
  return out;
}

/** Banister TRIMP — exponentially-weighted training load. */
export function trimp(input: CardioInput): number | null {
  const { avgHR, restingHR, maxHR, age, durationSeconds, sex } = input;
  if (!avgHR || !restingHR) return null;
  const hrMax = maxHR && maxHR > 0 ? maxHR : estimateMaxHR(age);
  const hrr = clamp((avgHR - restingHR) / (hrMax - restingHR), 0, 1);
  const durMin = durationSeconds / 60;
  const [b, c] = sex === 'female' ? [0.86, 1.67] : [0.64, 1.92];
  return durMin * hrr * b * Math.exp(c * hrr);
}

/** Efficiency Factor: speed per heartbeat. Higher = fitter at a given HR. */
export function efficiencyFactor(input: CardioInput): number | null {
  const { avgHR, distanceMeters, durationSeconds } = input;
  if (!avgHR || avgHR <= 0 || distanceMeters <= 0 || durationSeconds <= 0) return null;
  const speedMetersPerMin = distanceMeters / (durationSeconds / 60);
  return speedMetersPerMin / avgHR;
}

/** Aerobic decoupling: HR drift vs pace drift between halves. Lower = more durable. */
export function decoupling(input: CardioInput): number | null {
  const { firstHalfAvgHR, secondHalfAvgHR, firstHalfPaceSecPerKm, secondHalfPaceSecPerKm } = input;
  if (firstHalfAvgHR && secondHalfAvgHR && firstHalfPaceSecPerKm && secondHalfPaceSecPerKm) {
    const ef1 = (1 / firstHalfPaceSecPerKm) / firstHalfAvgHR;
    const ef2 = (1 / secondHalfPaceSecPerKm) / secondHalfAvgHR;
    return ((ef1 - ef2) / ef1) * 100; // % drop in efficiency, +ve = faded
  }
  return null;
}

/**
 * Per-activity cardio score (0–1000).
 *
 * Primary path: this session is projected to its benchmark distance via
 * Riegel and HR-adjusted, then blended into the caller-supplied multi-session
 * memory (`storedPredictionSeconds`) — or, if there's no memory yet (first
 * session), scored directly off this session's own equivalent. Either way
 * the result is looked up on a calibrated anchor table, so an easy low-HR
 * session and a hard one of equal underlying fitness land close together.
 *
 * VO2max is still estimated (resting-HR ratio preferred, effort-normalized
 * pace as a fallback) purely as a supplementary premium metric — it no
 * longer drives the score. On top of the anchor-table base: a volume bonus
 * (sheer duration), a terrain bonus (climbing), an environment bonus
 * (heat/cold), and pacing quality (negative-split reward / fade penalty).
 */
export function scoreCardioActivity(input: CardioInput): CardioResult {
  const flags: string[] = [];
  const rawSpeed = input.distanceMeters > 0 && input.durationSeconds > 0
    ? input.distanceMeters / input.durationSeconds // m/s
    : 0;

  let { value: vo2max, method } = vo2maxFromHR(input.restingHR, input.maxHR, input.age);

  if (vo2max === null) {
    const effortFraction = computeEffortFraction(input.avgHR, input.restingHR, input.maxHR, input.age);
    if (effortFraction !== null && rawSpeed > 0) {
      const normalizedSpeed = effortNormalizedSpeed(rawSpeed, effortFraction);
      vo2max = 0.2 * (normalizedSpeed * 60) + 3.5; // ACSM running-economy curve, reused as a directional proxy for row/swim too
      method = 'pace-hr-adjusted';
    } else if (input.type === 'run') {
      const est = vo2FromRunningPace(input.distanceMeters, input.durationSeconds);
      if (est !== null) {
        vo2max = est;
        method = 'pace-estimate';
      }
    }
  }

  if (!input.avgHR) flags.push('no-hr-data');

  // Personalize the HR-adjustment reference to this athlete's own resting/max
  // HR when known, instead of the fixed population bpm value — falls back to
  // the original unpersonalized behaviour otherwise (see resolveReferenceHR).
  const hrMaxForPersonalization =
    input.maxHR && input.maxHR > 0 ? input.maxHR : estimateMaxHR(input.age);
  if (input.restingHR && input.restingHR > 0) flags.push('hr-personalized');

  const personalization = { restingHR: input.restingHR, maxHR: hrMaxForPersonalization };
  let sessionEquivalentSeconds: number | null;
  if (isValidIntervalWorkPiece(input.structuredInterval)) {
    sessionEquivalentSeconds = computeIntervalBenchmarkEquivalentSeconds(
      input.benchmarkSport,
      intervalTotalWorkDistanceMeters(input.structuredInterval),
      intervalEquivalentPaceSecPerKm(input.structuredInterval),
      input.structuredInterval.workAvgHeartRate,
      undefined,
      personalization
    );
    flags.push('interval-work-piece-scored');
  } else if (isValidFartlekOnPiece(input.structuredFartlek)) {
    sessionEquivalentSeconds = computeIntervalBenchmarkEquivalentSeconds(
      input.benchmarkSport,
      input.structuredFartlek.onDistanceMeters,
      fartlekEquivalentPaceSecPerKm(input.structuredFartlek),
      input.structuredFartlek.onAvgHeartRate,
      undefined,
      personalization
    );
    flags.push('fartlek-work-piece-scored');
  } else {
    sessionEquivalentSeconds = computeSessionBenchmarkEquivalentSeconds(
      input.benchmarkSport,
      input.distanceMeters,
      input.durationSeconds,
      input.avgHR,
      undefined,
      personalization
    );
  }
  const anchorSeconds = input.storedPredictionSeconds ?? sessionEquivalentSeconds;

  let base: number;
  let confidence: number;

  if (anchorSeconds !== null) {
    base = timeToScore(input.benchmarkSport, anchorSeconds, input.sex);
    if (input.storedPredictionSeconds != null) {
      flags.push('memory-backed');
      confidence = input.avgHR ? 1 : 0.9;
    } else {
      confidence = input.avgHR ? 0.85 : 0.7;
    }
  } else {
    // No distance/duration to project from — shouldn't happen for a real
    // cardio session, but keep a safe, clearly-low-confidence fallback.
    base = 0;
    confidence = 0.3;
  }

  // Volume/terrain/environment — orthogonal to pace/HR. A long session, a
  // hilly one, or one done in harsh heat/cold demonstrates real aerobic
  // durability that a pace-per-heartbeat estimate alone won't capture.
  const volumeBonus = enduranceVolumeBonus(input.durationSeconds);
  base += volumeBonus;
  if (volumeBonus > MAX_VOLUME_BONUS * 0.5) flags.push('long-session-credit');

  const elevationBonus = elevationDifficultyBonus(input.elevationMeters, input.distanceMeters);
  base += elevationBonus;
  if (elevationBonus > MAX_ELEVATION_BONUS * 0.5) flags.push('hilly-terrain-credit');

  const temperatureBonus = temperatureDifficultyBonus(input.temperatureCelsius);
  base += temperatureBonus;
  if (temperatureBonus > MAX_TEMPERATURE_BONUS * 0.5) flags.push('harsh-conditions-credit');

  // Pacing quality — reward negative splits (2nd half >= 1st half).
  const dec = decoupling(input);
  if (dec !== null) {
    // dec < 0 means got faster relative to HR: bonus. dec > 5% means faded: penalty.
    base += clamp(-dec * 3, -40, 40);
    if (dec > 6) flags.push('positive-split-fade');
    if (dec < -2) flags.push('negative-split-strong');
  }

  const ef = efficiencyFactor(input);
  const tr = trimp(input);

  return {
    score: Math.round(clamp(base, 0, 1000)),
    vo2max: vo2max === null ? null : Math.round(vo2max * 10) / 10,
    vo2maxMethod: method,
    trimp: tr === null ? null : Math.round(tr * 10) / 10,
    efficiencyFactor: ef === null ? null : Math.round(ef * 1000) / 1000,
    decouplingPct: dec === null ? null : Math.round(dec * 10) / 10,
    predictions: input.type === 'run'
      ? riegelPredictions(input.distanceMeters, input.durationSeconds, input.experience)
      : null,
    confidence: Math.round(confidence * 100) / 100,
    flags,
  };
}
