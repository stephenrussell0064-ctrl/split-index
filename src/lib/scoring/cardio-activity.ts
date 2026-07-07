/**
 * Split Index — Cardio scoring engine ("The Engine")
 * ---------------------------------------------------
 * Pure functions, no dependencies. Every activity (run / row / swim) gets a
 * per-activity score on a 0–1000 scale, plus the underlying physiological
 * estimates (VO2max, predicted race times, training load) that justify it.
 *
 * FREE tier reads `score` and `vo2max`.
 * PREMIUM tier additionally surfaces `trimp`, `efficiencyFactor`,
 * `decoupling`, `predictions`, and `confidence`.
 *
 * Sources (verify on review):
 *  - VO2max HR-ratio: Uth, Sørensen, Overgaard & Pedersen (2004) — 15.3 × HRmax/HRrest
 *  - HRmax fallback:  Tanaka (2001) — 208 − 0.7 × age
 *  - Race prediction: Riegel (1977) — T2 = T1 × (D2/D1)^k
 *  - Training load:   Banister TRIMP (1991), sex-specific weighting
 */

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
}

export interface CardioResult {
  score: number;               // 0–1000, the per-activity Engine contribution
  vo2max: number | null;       // ml/kg/min
  vo2maxMethod: 'hr-ratio' | 'pace-estimate' | 'none';
  trimp: number | null;
  efficiencyFactor: number | null;
  decouplingPct: number | null;
  predictions: Record<string, number> | null; // distance(m) -> seconds
  confidence: number;          // 0–1, how much HR data backed this score
  flags: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

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
 * Strategy: anchor on VO2max where HR data allows (the most defensible fitness
 * proxy), scale it against age/sex-referenced VO2max norms into a 0–1000 band,
 * then apply modifiers for pacing quality (negative split rewarded) and an
 * honesty discount when no HR data backs the effort. This keeps a fast GPS time
 * with no HR from outscoring a genuine, HR-verified effort.
 */
export function scoreCardioActivity(input: CardioInput): CardioResult {
  const flags: string[] = [];

  // 1. VO2max — HR ratio preferred, running-pace cross-check as fallback.
  let { value: vo2max, method } = vo2maxFromHR(input.restingHR, input.maxHR, input.age);
  if (vo2max === null && input.type === 'run') {
    const est = vo2FromRunningPace(input.distanceMeters, input.durationSeconds);
    if (est !== null) { vo2max = est; method = 'pace-estimate'; }
  }

  // 2. Base score from VO2max against a rough age/sex norm band (35–60 ml/kg/min
  //    typical adult range; anchored so ~50 maps mid-high). Where VO2max is
  //    unavailable, fall back to a pace-percentile proxy at reduced confidence.
  let base: number;
  let confidence: number;
  if (vo2max !== null) {
    const norm = input.sex === 'female' ? 45 : 50; // reference midpoint
    base = clamp(500 + (vo2max - norm) * 18, 0, 1000);
    confidence = method === 'hr-ratio' ? 1 : 0.7;
  } else {
    // No VO2max: score off speed alone, capped and discounted for honesty.
    const speed = input.distanceMeters / input.durationSeconds; // m/s
    base = clamp(speed * 90, 0, 780);
    confidence = 0.45;
    flags.push('no-hr-data');
  }

  // 3. Pacing quality — reward negative splits (2nd half >= 1st half).
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
