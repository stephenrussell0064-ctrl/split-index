/**
 * Split Index — Cardio scoring engine ("The Engine")
 * ---------------------------------------------------
 * Pure functions (only a type-only import for the session-type union).
 * Every activity (run / row / swim) gets a per-activity score on a 0–1000
 * scale, plus the underlying physiological estimates (VO2max, predicted
 * race times, training load) that justify it.
 *
 * Effort-aware by design: two sessions with the same underlying fitness but
 * different intensities (an easy recovery jog vs. a hard tempo run) should
 * land close to the same score. Where a resting HR is on file, VO2max comes
 * from the HR ratio method, which is effort-independent already. Where it
 * isn't, but the session still has an avg HR, the observed pace is scaled
 * toward a threshold-equivalent effort using %HRR so a deliberately slow,
 * low-HR session isn't graded down for being unhurried. Where there's no HR
 * at all, a self-reported "easy" session type or a low RPE softens the pure
 * pace-based estimate instead.
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

export type Sex = 'male' | 'female';
export type CardioType = 'run' | 'row' | 'swim';

export interface CardioInput {
  type: CardioType;
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
  rpe?: number | null;                // 1–10 perceived effort
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

const NEUTRAL_ANCHOR = 500;
const DEFAULT_RESTING_HR = 60;
// %HRR treated as the "working hard" reference point (roughly tempo/threshold
// effort). Observed pace at a lower %HRR is scaled toward this reference.
const REFERENCE_EFFORT_FRACTION = 0.85;
const MIN_EFFORT_FRACTION = 0.35;
const MAX_EFFORT_FRACTION = 1.05;
// Damp the effort-normalization instead of applying it in full — the %HRR-
// pace relationship is roughly linear but not precisely so, and this is a
// deliberately conservative approximation, not a lab-calibrated model.
const EFFORT_BLEND_FACTOR = 0.5;
const EASY_SESSION_DAMPING = 0.35;
const LOW_RPE_THRESHOLD = 4; // UI hint: "1 = very easy · 10 = max effort"
const EASY_SESSION_TYPES = new Set<SessionType>(['easy', 'recovery', 'long']);

/** %HRR for this specific session — falls back to a population-average resting HR if none is on file. */
function computeEffortFraction(avgHR?: number, restingHR?: number, maxHR?: number, age?: number): number | null {
  if (!avgHR || avgHR <= 0) return null;
  const hrMax = maxHR && maxHR > 0 ? maxHR : estimateMaxHR(age ?? 30);
  const hrRest = restingHR && restingHR > 0 ? restingHR : DEFAULT_RESTING_HR;
  if (hrMax <= hrRest) return null;
  return clamp((avgHR - hrRest) / (hrMax - hrRest), MIN_EFFORT_FRACTION, MAX_EFFORT_FRACTION);
}

/** Scales an easy, low-effort pace toward a threshold-equivalent one — damped, not a full linear extrapolation. */
function effortNormalizedSpeed(rawSpeedMetersPerSec: number, effortFraction: number | null): number {
  if (effortFraction === null || effortFraction <= 0) return rawSpeedMetersPerSec;
  const fullyNormalized = rawSpeedMetersPerSec * (REFERENCE_EFFORT_FRACTION / effortFraction);
  return rawSpeedMetersPerSec + (fullyNormalized - rawSpeedMetersPerSec) * EFFORT_BLEND_FACTOR;
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
 * Strategy, in priority order:
 *  1. Resting-HR-ratio VO2max — effort-independent by construction, so an
 *     easy day and a hard day score the same if fitness hasn't changed.
 *  2. No resting HR, but this session has an avg HR — normalize the observed
 *     pace toward a threshold-equivalent effort using %HRR, so a slow,
 *     low-HR session isn't graded down just for being unhurried.
 *  3. No HR at all — fall back to pace alone (honesty-discounted), then
 *     soften the result if the athlete labelled the session easy/recovery/
 *     long or reported a low RPE, since a deliberately slow pace there
 *     isn't evidence of low fitness.
 * Pacing quality (negative-split reward / fade penalty) is layered on top
 * regardless of which path produced the base score.
 */
export function scoreCardioActivity(input: CardioInput): CardioResult {
  const flags: string[] = [];
  const rawSpeed = input.distanceMeters > 0 && input.durationSeconds > 0
    ? input.distanceMeters / input.durationSeconds // m/s
    : 0;

  let { value: vo2max, method } = vo2maxFromHR(input.restingHR, input.maxHR, input.age);
  const effortFraction = computeEffortFraction(input.avgHR, input.restingHR, input.maxHR, input.age);
  const norm = input.sex === 'female' ? 45 : 50; // VO2max reference midpoint

  let base: number;
  let confidence: number;

  if (vo2max !== null) {
    // Resting-HR ratio already normalizes for effort — a physiological
    // ceiling, not a grade on how hard this particular session was.
    base = clamp(500 + (vo2max - norm) * 18, 0, 1000);
    confidence = 1;
  } else if (effortFraction !== null && rawSpeed > 0) {
    // Real HR for this session, just no measured resting HR. Scale the pace
    // by how easy/hard the effort actually was instead of taking it at face value.
    const normalizedSpeed = effortNormalizedSpeed(rawSpeed, effortFraction);
    const estVo2 = 0.2 * (normalizedSpeed * 60) + 3.5; // ACSM running-economy curve, reused as a directional proxy for row/swim too
    vo2max = estVo2;
    method = 'pace-hr-adjusted';
    base = clamp(500 + (estVo2 - norm) * 18, 0, 1000);
    confidence = 0.8;
    flags.push('hr-effort-adjusted');
  } else if (input.type === 'run') {
    const est = vo2FromRunningPace(input.distanceMeters, input.durationSeconds);
    if (est !== null) {
      vo2max = est;
      method = 'pace-estimate';
      base = clamp(500 + (est - norm) * 18, 0, 1000);
    } else {
      base = 0;
    }
    confidence = 0.7;
    flags.push('no-hr-data');
  } else {
    // No HR at all for a row/swim session: score off speed alone, capped
    // and discounted for honesty.
    base = clamp(rawSpeed * 90, 0, 780);
    confidence = 0.45;
    flags.push('no-hr-data');
  }

  // Self-reported easy effort with no HR to verify it: don't grade a
  // deliberately slow pace down as if it were a maximal, revealing effort.
  if (flags.includes('no-hr-data')) {
    const selfReportedEasy =
      (input.sessionType != null && EASY_SESSION_TYPES.has(input.sessionType)) ||
      (typeof input.rpe === 'number' && input.rpe > 0 && input.rpe <= LOW_RPE_THRESHOLD);
    if (selfReportedEasy) {
      base = base + (NEUTRAL_ANCHOR - base) * EASY_SESSION_DAMPING;
      confidence = Math.max(confidence, 0.55);
      flags.push('easy-effort-acknowledged');
    }
  }

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
