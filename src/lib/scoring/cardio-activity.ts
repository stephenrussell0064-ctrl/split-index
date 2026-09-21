/**
 * Split Index — Cardio scoring engine ("The Engine")
 * ---------------------------------------------------
 * Every activity (run / walk / row / swim / cycle / ski) gets TWO per-activity
 * scores on the shared 0–1000 scale, plus the underlying physiological
 * estimates (VO2max, race predictions, training load) that justify them.
 *
 * Both scores are read off ONE number, this session's fitness equivalent —
 * the time it implies for a maximal, flat, comfortable-weather effort at the
 * sport's benchmark distance. cardio/fitness-equivalent.ts builds it from the
 * split, the distance, the climb, the temperature, the athlete's bodyweight
 * (ergs) and how hard they were working (heart rate, or RPE without it).
 *
 *  - `populationScore` (= `score` = `paceScore`): that equivalent, sex- and
 *    age-graded, on the sport's calibrated anchor table (cardio-benchmarks.ts).
 *    "How good was this, as a run, for a person like you." Monotonic BY
 *    CONSTRUCTION: a faster equivalent can never score lower. This is what the
 *    Engine Index rolls up from and what leaderboards rank.
 *
 *  - `personalScore`: that same equivalent against the recency-weighted
 *    median of the athlete's own recent same-sport sessions, read the same
 *    way (personal-score.ts). 500 is "your normal"; the same pace at a higher
 *    heart rate, or a slower split at the same heart rate, reads below it.
 *    "How good was this, for you, lately." Null until three comparable
 *    sessions exist.
 *
 * WHAT THIS REPLACED, and why it is not coming back in another shape. The
 * previous engine keyed a stack of bonus-only credits off the session-type
 * tag for easy/recovery/long sessions — HR-zone credit, an efficiency-factor
 * bonus, a long-run credit, a ceiling bonus, a floor at 85% of the athlete's
 * own recent easy scores — each individually reasoned and individually
 * capped, and with the caps binding on nearly every session. Measured on one
 * athlete's 8 km easy run: 780 at 140 bpm, 780 at 145, 723 at 157, 723 at
 * 165, 723 for 20 s/km slower, 691 for 50 s/km slower AND 15 bpm higher.
 * Visibly different sessions, three numbers. That is what "always 80+ with
 * very little movement" looks like from the inside. Nothing here reads the
 * tag any more: the tag says what the athlete intended, the heart rate says
 * what happened, and the personal score is where "a good easy run" is
 * credited — against the athlete's own easy runs, not against the 5K table.
 *
 * `executionScore` (pacing quality, volume/terrain/environment credit) is a
 * separate secondary metric and is never blended into either score.
 *
 * FREE tier reads `score`, `populationScore`, `personalScore` and `vo2max`.
 * PREMIUM tier additionally surfaces the adjustments breakdown, the personal
 * comparison detail, `executionScore`, `trimp`, `efficiencyFactor`,
 * `decoupling`, `predictions` and `confidence`.
 *
 * Sources (verify on review):
 *  - VO2max HR-ratio: Uth, Sørensen, Overgaard & Pedersen (2004) — 15.3 × HRmax/HRrest
 *  - HRmax fallback:  Tanaka (2001) — 208 − 0.7 × age
 *  - %HRR ≈ %VO2R:    Swain & Leutholtz (1997) heart-rate-reserve method (ACSM)
 *  - Race prediction: Riegel (1977) — T2 = T1 × (D2/D1)^k
 *  - Training load:   Banister TRIMP (1991), sex-specific weighting
 */

import type { SessionType } from "@/types";
import {
  timeToScore,
  enduranceAgeGradeFactor,
  BENCHMARK_DISTANCE_METERS,
  type BenchmarkSport,
} from "@/lib/scoring/cardio-benchmarks";
import {
  benchmarkRiegelK,
  elevationDifficultyFraction,
  temperatureDifficultyFraction,
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
import {
  computeFitnessEquivalent,
  type EffortSource,
  type FitnessEquivalent,
} from "@/lib/scoring/cardio/fitness-equivalent";
import {
  buildPersonalBaseline,
  improvementDelta,
  personalScoreFromDelta,
  intensitySimilarity,
  daysBetween,
  CARDIO_PERSONAL_SLOPE,
  type WeightedSample,
} from "@/lib/scoring/personal-score";

export type Sex = 'male' | 'female';
export type CardioType = 'run' | 'row' | 'swim';
export type { BenchmarkSport, EffortSource };

/**
 * One of the athlete's recent same-sport sessions, as the personal baseline
 * reads it. Structurally a superset of `HistorySession` (cardio/race-
 * prediction.ts) so the 90-day window every caller already fetches for the
 * race-prediction memory can be passed straight through. `sessionType` is
 * accepted so that window fits, and is deliberately never read.
 */
export interface RecentCardioSession {
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  rpe?: number | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
  startedAt: string | Date;
  sessionType?: SessionType | null;
  /** Structured work pieces, when the session had them — read the same way as the session being scored. */
  intervalReps?: number | null;
  intervalWorkDistanceMeters?: number | null;
  intervalWorkSeconds?: number | null;
  intervalRestSeconds?: number | null;
  intervalWorkAvgHr?: number | null;
  fartlekOnDistanceMeters?: number | null;
  fartlekOnSeconds?: number | null;
  fartlekOnAvgHr?: number | null;
}

export interface CardioInput {
  type: CardioType;
  /** Granular benchmark bucket driving the anchor-table score (run/walk/row/swim/cycle/ski). */
  benchmarkSport: BenchmarkSport;
  distanceMeters: number;
  durationSeconds: number;
  sex: Sex;
  age: number;
  restingHR?: number;      // bpm — optional, unlocks VO2max ratio method and a measured effort reference
  maxHR?: number;          // bpm — measured; else estimated from age
  avgHR?: number;          // bpm — unlocks effort scaling, TRIMP and efficiency factor
  firstHalfAvgHR?: number; // bpm — unlocks decoupling
  secondHalfAvgHR?: number;
  firstHalfPaceSecPerKm?: number;  // unlocks pace-based decoupling
  secondHalfPaceSecPerKm?: number;
  experience?: 'beginner' | 'intermediate' | 'advanced';
  /** Self-reported intent. Carried for display and for the race-prediction memory; NEVER read by either score. */
  sessionType?: SessionType | null;
  /** Structured interval reps — when present, the equivalent is seeded from work-piece pace (rest-ratio converted) instead of the whole-session average. */
  structuredInterval?: IntervalWorkPiece | null;
  /** Fartlek "on" distance/time — same work-piece treatment. */
  structuredFartlek?: FartlekOnPiece | null;
  /** 1–10 perceived effort — the effort signal when there is no heart rate. */
  rpe?: number | null;
  elevationMeters?: number | null;    // total climb
  temperatureCelsius?: number | null; // air temperature during the session
  /** Athlete's bodyweight — re-references erg times to the anchor tables' reference mass (row/ski only). */
  bodyweightKg?: number | null;
  /** Multi-session race-prediction memory (seconds at the benchmark distance) — informs confidence only, never either score. */
  storedPredictionSeconds?: number | null;
  /** This athlete's own Riegel k from their cross-distance race history (cardio/race-prediction.ts) — overrides the sport default for every projection here. */
  personalizedRiegelK?: number | null;
  /** The athlete's recent same-sport sessions, EXCLUDING this one — the personal score's baseline. Omit for a population-only score. */
  recentSessions?: RecentCardioSession[] | null;
  /** When this session happened — anchors the baseline window and its recency weights. Defaults to now. */
  startedAt?: string | Date | null;
}

/** How the session's equivalent was adjusted, for the athlete to read. */
export interface CardioAdjustments {
  /** Raw Riegel projection (walk: per-km pace) before any adjustment. */
  projectedSeconds: number;
  effortSource: EffortSource;
  /** %HRR (or RPE-implied fraction) the session was done at, null when unscaled. */
  effortFraction: number | null;
  /** The intensity a maximal effort of this session's own length is held at — what its heart rate was judged against. */
  benchmarkEffortFraction: number;
  /** Time divisor from effort — 1.18 means "18% faster if maximal". */
  effortRatio: number;
  elevationFraction: number;
  temperatureFraction: number;
  bodyweightFactor: number;
  ageFactor: number;
}

export interface CardioPersonalComparison {
  /** The athlete's recent norm — recency-weighted median equivalent, seconds at the benchmark distance. */
  baselineEquivalentSeconds: number;
  /** Fastest equivalent in the window (excluding this session). */
  bestEquivalentSeconds: number;
  /** Signed percent, positive = better than the norm. */
  deltaPct: number;
  sampleCount: number;
  /**
   * What was compared. `effort-matched` is the normal case: this session's
   * fitness equivalent against the equivalents of sessions recorded the same
   * way. `pace-only` means too few were recorded this way, so both sides fall
   * back to raw projected pace — a valid comparison, just a blunter one.
   */
  comparedWith: 'effort-matched' | 'pace-only';
  /**
   * How much of the baseline's weight came from sessions at a comparable
   * heart rate, 0–1 (see INTENSITY_SIMILARITY_BANDWIDTH). Low means this
   * athlete has not done a session like this one lately, so the comparison
   * is being stretched across intensities — worth saying rather than hiding.
   */
  intensityMatch: number;
}

export interface CardioResult {
  /** The population score — identical to `populationScore`; kept as the headline field every roll-up reads. */
  score: number;
  /** Alias of `score` — historical name, still written for anything that reads it. */
  paceScore: number;
  /** Against the sport's population anchor tables, sex/age graded. Monotonic in the fitness equivalent. */
  populationScore: number;
  /** Against this athlete's own recent same-sport sessions. 500 = their norm. Null until three comparable sessions exist. */
  personalScore: number | null;
  personal: CardioPersonalComparison | null;
  /**
   * The endurance age-grade factor actually used to score this session, so
   * the UI can tell the athlete BY HOW MUCH their standard moved rather than
   * only that it did (the `age-graded` flag alone carries no magnitude).
   *
   * Reports the value; does not change how it is computed or applied.
   *
   * Optional, and null when no grading applied. Results persisted before this
   * field existed genuinely do not have it, and readers must fall back to the
   * flag rather than trust a missing value as "1.0".
   */
  ageGradeFactor?: number | null;
  /** The one number both scores are read from — seconds at the benchmark distance (walk: per km). Null when there was nothing to project. */
  fitnessEquivalentSeconds: number | null;
  adjustments: CardioAdjustments | null;
  /** Separate, secondary "how well was this session executed" metric — pacing quality and volume/terrain/environment credit. Never blended into either score. */
  executionScore: number | null;
  vo2max: number | null;       // ml/kg/min
  vo2maxMethod: 'hr-ratio' | 'pace-hr-adjusted' | 'pace-estimate' | 'none';
  trimp: number | null;
  efficiencyFactor: number | null;
  decouplingPct: number | null;
  predictions: Record<string, number> | null; // distance(m) -> seconds
  confidence: number;          // 0–1
  flags: string[];
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

const DEFAULT_RESTING_HR = 60;
// %HRR treated as the "working hard" reference point for the supplementary
// VO2max estimate shown in premium panels — the scores use the per-sport
// BENCHMARK_EFFORT_FRACTION in cardio/fitness-equivalent.ts instead.
const REFERENCE_EFFORT_FRACTION = 0.85;
const MIN_EFFORT_FRACTION = 0.35;
const MAX_EFFORT_FRACTION = 1.05;
const MAX_NORMALIZATION_RATIO = 1.6;

/** Sessions older than this before the one being scored do not describe current form. */
export const PERSONAL_BASELINE_WINDOW_DAYS = 90;
/** Effort credit past this raw reach is flagged so the UI can say the equivalent leans on extrapolation. */
const EFFORT_EXTRAPOLATION_FLAG_RATIO = 1.3;

// Volume/terrain/environment bonuses — feed ONLY executionScore.
const MAX_VOLUME_BONUS = 110;
const VOLUME_HALF_SATURATION_MINUTES = 45;
const MAX_ELEVATION_BONUS = 25;
const MAX_TEMPERATURE_BONUS = 15;

/** Rewards sheer time-under-aerobic-load, independent of how fast or easy it was. */
function enduranceVolumeBonus(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const minutes = durationSeconds / 60;
  return MAX_VOLUME_BONUS * (minutes / (minutes + VOLUME_HALF_SATURATION_MINUTES));
}

function elevationDifficultyBonus(elevationMeters?: number | null, distanceMeters?: number | null): number {
  return elevationDifficultyFraction(elevationMeters, distanceMeters) * MAX_ELEVATION_BONUS;
}

function temperatureDifficultyBonus(temperatureCelsius?: number | null): number {
  return temperatureDifficultyFraction(temperatureCelsius) * MAX_TEMPERATURE_BONUS;
}

/** %HRR for this specific session — falls back to a population-average resting HR if none is on file. Supplementary VO2max path only. */
function computeEffortFraction(avgHR?: number, restingHR?: number, maxHR?: number, age?: number): number | null {
  if (!avgHR || avgHR <= 0) return null;
  const hrMax = maxHR && maxHR > 0 ? maxHR : estimateMaxHR(age ?? 30);
  const hrRest = restingHR && restingHR > 0 ? restingHR : DEFAULT_RESTING_HR;
  if (hrMax <= hrRest) return null;
  return clamp((avgHR - hrRest) / (hrMax - hrRest), MIN_EFFORT_FRACTION, MAX_EFFORT_FRACTION);
}

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
 * Population-typical resting HR by experience tier — used only when an
 * athlete never answered the (optional) resting HR onboarding question.
 * Trained endurance athletes genuinely run a lower resting HR than untrained
 * ones (greater stroke volume). Flagged as estimated wherever it's used (see
 * resting-hr-estimated) rather than presented with the same confidence as a
 * measured value.
 */
export function estimateRestingHR(experience: CardioInput['experience']): number {
  return experience === 'advanced' ? 58 : experience === 'beginner' ? 72 : 65;
}

/**
 * VO2max via the heart-rate-ratio method (Uth et al. 2004).
 * Requires a resting HR and a max HR (measured preferred, else age-estimated).
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

/** Running-only VO2 estimate from velocity (Daniels/ACSM-style running economy). */
export function vo2FromRunningPace(distanceMeters: number, durationSeconds: number): number | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;
  const vMetersPerMin = distanceMeters / (durationSeconds / 60);
  const vo2 = 0.2 * vMetersPerMin + 3.5;
  return vo2 > 0 ? vo2 : null;
}

/**
 * Riegel race-time predictions across the standard ladder. `personalizedK`
 * overrides the generic experience-tier k with this athlete's own realized
 * cross-distance profile when enough evidence exists.
 */
export function riegelPredictions(
  distanceMeters: number,
  durationSeconds: number,
  experience: CardioInput['experience'] = 'intermediate',
  personalizedK?: number | null
): Record<string, number> | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;
  const k =
    personalizedK ?? (experience === 'beginner' ? 1.08 : experience === 'advanced' ? 1.04 : 1.06);
  const ladder = [1500, 5000, 10000, 21097.5, 42195];
  const out: Record<string, number> = {};
  for (const d of ladder) out[String(d)] = durationSeconds * Math.pow(d / distanceMeters, k);
  return out;
}

const SPORT_LADDER_METERS: Record<'row' | 'ski' | 'swim', number[]> = {
  row: [500, 1000, 2000, 5000, 10000],
  ski: [500, 1000, 2000, 5000],
  swim: [100, 200, 400, 800, 1500],
};

export function sportRacePredictions(
  sport: 'row' | 'ski' | 'swim',
  distanceMeters: number,
  durationSeconds: number,
  experience: CardioInput['experience'] = 'intermediate',
  personalizedK?: number | null
): Record<string, number> | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;
  const k =
    personalizedK ?? (experience === 'beginner' ? 1.08 : experience === 'advanced' ? 1.04 : 1.06);
  const ladder = SPORT_LADDER_METERS[sport];
  const out: Record<string, number> = {};
  for (const d of ladder) out[String(d)] = durationSeconds * Math.pow(d / distanceMeters, k);
  return out;
}

const WALK_LADDER_METERS = [1000, 5000, 10000, 21097.5];

/** Linear (no Riegel exponent) pace-based ladder for walking. */
export function walkPacePredictions(
  distanceMeters: number,
  durationSeconds: number
): Record<string, number> | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;
  const pacePerKm = durationSeconds / (distanceMeters / 1000);
  const out: Record<string, number> = {};
  for (const d of WALK_LADDER_METERS) out[String(d)] = pacePerKm * (d / 1000);
  return out;
}

export interface LivePredictionEntry {
  label: string;
  meters: number;
  seconds: number;
  score: number;
}

const LIVE_LADDER_METERS: Partial<Record<BenchmarkSport, Array<{ meters: number; label: string }>>> = {
  run: [
    { meters: 5000, label: "5K" },
    { meters: 10000, label: "10K" },
    { meters: 21097.5, label: "Half Marathon" },
    { meters: 42195, label: "Marathon" },
  ],
};

/**
 * Live in-progress score/time prediction ladder for a GPS-tracked session
 * that's still running. Pure and client-computable: this session's own pace
 * and HR so far, through the same fitness-equivalent pipeline the final
 * population score uses (minus terrain and weather, which aren't known
 * live), re-projected across the standard race ladder.
 *
 * The score under each rung is the score for running THAT time over THAT
 * distance — which, projected back to the benchmark distance, is the same
 * fitness equivalent on every rung, so every rung shows the same score. That
 * is correct, not a bug: the rungs differ in time, not in how good the
 * athlete is. (An earlier version fed a rung's raw seconds straight into the
 * 5K-calibrated table, so a 4:02 marathon showed 0.1 — user report.)
 */
export function livePredictionLadder(
  benchmarkSport: BenchmarkSport,
  distanceMeters: number,
  durationSeconds: number,
  avgHR: number | null | undefined,
  sex: Sex,
  personalization?: { restingHR?: number | null; maxHR?: number | null },
  personalizedK?: number | null
): LivePredictionEntry[] | null {
  const ladder = LIVE_LADDER_METERS[benchmarkSport];
  if (!ladder) return null;
  const fitness = computeFitnessEquivalent({
    sport: benchmarkSport,
    distanceMeters,
    durationSeconds,
    avgHR,
    sex,
    restingHR: personalization?.restingHR ?? null,
    maxHR: personalization?.maxHR ?? null,
    riegelK: personalizedK ?? null,
  });
  if (!fitness) return null;
  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[benchmarkSport];
  const k = personalizedK ?? benchmarkRiegelK(benchmarkSport);
  const score = timeToScore(benchmarkSport, fitness.equivalentSeconds, sex);
  return ladder.map(({ meters, label }) => ({
    label,
    meters,
    seconds: fitness.equivalentSeconds * Math.pow(meters / benchmarkDistance, k),
    score,
  }));
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

interface EffortReference {
  restingHR: number;
  maxHR: number;
  restingHRIsEstimated: boolean;
}

/**
 * The athlete's heart-rate reserve for effort scaling. Max HR measured or
 * Tanaka-estimated; resting HR measured, else estimated from experience tier
 * (and flagged) so an athlete who skipped that one optional question still
 * gets effort-scaled scores.
 */
function resolveEffortReference(input: CardioInput): EffortReference {
  const maxHR = input.maxHR && input.maxHR > 0 ? input.maxHR : estimateMaxHR(input.age);
  if (input.restingHR && input.restingHR > 0) {
    return { restingHR: input.restingHR, maxHR, restingHRIsEstimated: false };
  }
  return { restingHR: estimateRestingHR(input.experience), maxHR, restingHRIsEstimated: true };
}

interface SessionShape {
  benchmarkSport: BenchmarkSport;
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  rpe?: number | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
  structuredInterval?: IntervalWorkPiece | null;
  structuredFartlek?: FartlekOnPiece | null;
}

interface AthleteShape {
  sex: Sex;
  bodyweightKg?: number | null;
  riegelK?: number | null;
}

/**
 * A session's fitness equivalent, seeded from a structured work piece when
 * one is present (whole-session averages blend rest into the pace and the
 * heart rate, and understate both). Used identically for the session being
 * scored and for every session in its personal baseline.
 */
function sessionFitnessEquivalent(
  session: SessionShape,
  athlete: AthleteShape,
  reference: EffortReference
): { fitness: FitnessEquivalent | null; seededFrom: 'session' | 'interval' | 'fartlek' } {
  const common = {
    sport: session.benchmarkSport,
    sex: athlete.sex,
    bodyweightKg: athlete.bodyweightKg ?? null,
    restingHR: reference.restingHR,
    maxHR: reference.maxHR,
    riegelK: athlete.riegelK ?? null,
    elevationMeters: session.elevationMeters ?? null,
    temperatureCelsius: session.temperatureCelsius ?? null,
    rpe: session.rpe ?? null,
  };

  if (isValidIntervalWorkPiece(session.structuredInterval)) {
    const distance = intervalTotalWorkDistanceMeters(session.structuredInterval);
    const pace = intervalEquivalentPaceSecPerKm(session.structuredInterval);
    return {
      seededFrom: 'interval',
      fitness: computeFitnessEquivalent({
        ...common,
        distanceMeters: distance,
        durationSeconds: pace * (distance / 1000),
        avgHR: session.structuredInterval.workAvgHeartRate ?? null,
      }),
    };
  }
  if (isValidFartlekOnPiece(session.structuredFartlek)) {
    const distance = session.structuredFartlek.onDistanceMeters;
    const pace = fartlekEquivalentPaceSecPerKm(session.structuredFartlek);
    return {
      seededFrom: 'fartlek',
      fitness: computeFitnessEquivalent({
        ...common,
        distanceMeters: distance,
        durationSeconds: pace * (distance / 1000),
        avgHR: session.structuredFartlek.onAvgHeartRate ?? null,
      }),
    };
  }
  return {
    seededFrom: 'session',
    fitness: computeFitnessEquivalent({
      ...common,
      distanceMeters: session.distanceMeters,
      durationSeconds: session.durationSeconds,
      avgHR: session.avgHR ?? null,
    }),
  };
}

function recentSessionShape(session: RecentCardioSession, benchmarkSport: BenchmarkSport): SessionShape {
  const structuredInterval = {
    reps: session.intervalReps ?? 0,
    workDistanceMeters: session.intervalWorkDistanceMeters ?? 0,
    workSecondsPerRep: session.intervalWorkSeconds ?? 0,
    restSeconds: session.intervalRestSeconds ?? 0,
    workAvgHeartRate: session.intervalWorkAvgHr ?? undefined,
  };
  const structuredFartlek = {
    onDistanceMeters: session.fartlekOnDistanceMeters ?? 0,
    onSeconds: session.fartlekOnSeconds ?? 0,
    totalDurationSeconds: session.durationSeconds,
    onAvgHeartRate: session.fartlekOnAvgHr ?? undefined,
  };
  return {
    benchmarkSport,
    distanceMeters: session.distanceMeters,
    durationSeconds: session.durationSeconds,
    avgHR: session.avgHR ?? null,
    rpe: session.rpe ?? null,
    elevationMeters: session.elevationMeters ?? null,
    temperatureCelsius: session.temperatureCelsius ?? null,
    structuredInterval: isValidIntervalWorkPiece(structuredInterval) ? structuredInterval : null,
    structuredFartlek: isValidFartlekOnPiece(structuredFartlek) ? structuredFartlek : null,
  };
}

interface PersonalOutcome {
  score: number | null;
  comparison: CardioPersonalComparison | null;
  flags: string[];
}

/**
 * This session's equivalent against the athlete's own recent ones.
 *
 * Comparable means "read with the same kind of effort signal". A session
 * with heart rate carries effort credit its HR-less siblings cannot, so a
 * baseline mixing the two would make every HR-less session look like an off
 * day and every HR session look like a breakthrough. The pool is therefore
 * restricted to sessions with the same signal class when enough exist, and
 * widened to everything (flagged) only when it must be.
 */
function personalOutcome(
  input: CardioInput,
  thisFitness: FitnessEquivalent,
  reference: EffortReference
): PersonalOutcome {
  const sessions = input.recentSessions ?? [];
  if (sessions.length === 0) return { score: null, comparison: null, flags: ['personal-calibrating'] };

  const anchor = input.startedAt ? new Date(input.startedAt) : new Date();
  const anchorMs = Number.isFinite(anchor.getTime()) ? anchor.getTime() : Date.now();
  const athlete: AthleteShape = {
    sex: input.sex,
    bodyweightKg: input.bodyweightKg,
    riegelK: input.personalizedRiegelK,
  };

  /** One prior session, read both ways — see the fallback below. */
  interface Sample extends WeightedSample {
    /** Raw projected benchmark time, before any effort credit. */
    paceOnly: number;
    hasEffort: boolean;
  }

  const samples: Sample[] = [];
  for (const session of sessions) {
    const sessionMs = new Date(session.startedAt).getTime();
    if (!Number.isFinite(sessionMs)) continue;
    // Sessions after this one are not "recent history" for it — matters when
    // an old session is edited and re-scored against a window that now
    // contains everything logged since.
    if (sessionMs > anchorMs) continue;
    const daysBefore = daysBetween(session.startedAt, new Date(anchorMs));
    if (daysBefore > PERSONAL_BASELINE_WINDOW_DAYS) continue;
    const { fitness } = sessionFitnessEquivalent(
      recentSessionShape(session, input.benchmarkSport),
      athlete,
      reference
    );
    if (!fitness) continue;
    samples.push({
      value: fitness.equivalentSeconds,
      paceOnly: fitness.projectedSeconds,
      daysBefore,
      // Heart rate only. An RPE-implied fraction is a different instrument
      // reading a different scale, and pairing the two would compare a felt
      // 6 with a measured 68% of reserve as though they were the same thing.
      intensity: fitness.effort.source === 'hr' ? fitness.effort.fraction : null,
      hasEffort: fitness.effort.source !== 'none',
    });
  }

  const thisIntensity = thisFitness.effort.source === 'hr' ? thisFitness.effort.fraction : null;
  const thisHasEffort = thisFitness.effort.source !== 'none';
  const matched = samples.filter((s) => s.hasEffort === thisHasEffort);

  const flags: string[] = [];
  let pool: Sample[] = matched;
  let comparedWith: CardioPersonalComparison['comparedWith'] = 'effort-matched';
  let thisValue = thisFitness.equivalentSeconds;
  let baseline = buildPersonalBaseline(matched, true, thisIntensity);

  if (!baseline) {
    /*
     * Too few sessions recorded the way this one was — typically an athlete
     * who wears a heart-rate strap most days and forgot it today.
     *
     * The wrong repair, and the one that was here first, is to widen the pool
     * and compare anyway: this session carries no effort credit and those
     * sessions do, so the comparison is between two different quantities and
     * an ordinary run reads as a collapse in form. Measured on a realistic
     * block, a perfectly normal 8 km at the athlete's usual pace scored 259
     * against a norm of 500 purely for the missing strap.
     *
     * Falling back to RAW PROJECTED PACE on BOTH sides is a genuine
     * comparison — was this run faster than my recent runs — just a blunter
     * one, since it cannot see that today was harder work for the same pace.
     * It is flagged so the UI can say which question it answered.
     */
    pool = samples;
    comparedWith = 'pace-only';
    thisValue = thisFitness.projectedSeconds;
    baseline = buildPersonalBaseline(
      samples.map((s) => ({ ...s, value: s.paceOnly })),
      true,
      thisIntensity
    );
    if (baseline) flags.push('personal-baseline-pace-only');
  }
  if (!baseline) return { score: null, comparison: null, flags: ['personal-calibrating'] };

  const delta = improvementDelta(thisValue, baseline.baseline, true);
  if (thisValue < baseline.best) flags.push('personal-best');

  // Mean intensity similarity across the pool, at the width the baseline
  // actually settled on, so the UI can say how alike the compared sessions
  // really were.
  const similarities = pool.map((s) =>
    intensitySimilarity(s.intensity, thisIntensity, baseline.bandwidth)
  );
  const intensityMatch = similarities.length
    ? similarities.reduce((a, b) => a + b, 0) / similarities.length
    : 1;
  // Either the compared sessions are not much like this one, or the window
  // had to widen so far that it is reaching across intensities this athlete
  // has not actually trained at. Both mean the same thing to a reader: the
  // comparison is being stretched.
  if (intensityMatch < 0.25 || baseline.effectiveSamples < 3) {
    flags.push('personal-baseline-intensity-stretched');
  }

  return {
    score: personalScoreFromDelta(delta, CARDIO_PERSONAL_SLOPE),
    comparison: {
      baselineEquivalentSeconds: Math.round(baseline.baseline * 10) / 10,
      bestEquivalentSeconds: Math.round(baseline.best * 10) / 10,
      deltaPct: Math.round(delta * 1000) / 10,
      sampleCount: pool.length,
      comparedWith,
      intensityMatch: Math.round(intensityMatch * 100) / 100,
    },
    flags,
  };
}

/**
 * Per-activity cardio scores (0–1000) — see the file header.
 */
export function scoreCardioActivity(input: CardioInput): CardioResult {
  const flags: string[] = [];
  const rawSpeed = input.distanceMeters > 0 && input.durationSeconds > 0
    ? input.distanceMeters / input.durationSeconds // m/s
    : 0;

  // Supplementary VO2max estimate — premium panel only, never drives a score.
  let { value: vo2max, method } = vo2maxFromHR(input.restingHR, input.maxHR, input.age);
  if (vo2max === null) {
    const effortFraction = computeEffortFraction(input.avgHR, input.restingHR, input.maxHR, input.age);
    if (effortFraction !== null && rawSpeed > 0) {
      const normalizedSpeed = effortNormalizedSpeed(rawSpeed, effortFraction);
      vo2max = 0.2 * (normalizedSpeed * 60) + 3.5;
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
  const reference = resolveEffortReference(input);
  if (!reference.restingHRIsEstimated) flags.push('hr-personalized');

  const { fitness, seededFrom } = sessionFitnessEquivalent(
    input,
    { sex: input.sex, bodyweightKg: input.bodyweightKg, riegelK: input.personalizedRiegelK },
    reference
  );
  if (seededFrom === 'interval') flags.push('interval-work-piece-scored');
  if (seededFrom === 'fartlek') flags.push('fartlek-work-piece-scored');

  const ageFactor = enduranceAgeGradeFactor(input.age);
  /** Reported on the result so the UI can name the magnitude, not just the fact. Stays null when nothing was graded. */
  let appliedAgeGradeFactor: number | null = null;
  if (ageFactor !== 1) {
    flags.push('age-graded');
    appliedAgeGradeFactor = ageFactor;
  }

  let populationScore = 0;
  let personal: PersonalOutcome = { score: null, comparison: null, flags: [] };
  let adjustments: CardioAdjustments | null = null;
  let confidence = 0.3;

  if (fitness) {
    // The whole model in one line: the equivalent, age-graded, on the table.
    populationScore = timeToScore(input.benchmarkSport, fitness.equivalentSeconds * ageFactor, input.sex);

    if (fitness.effort.source === 'hr') {
      flags.push('effort-from-hr');
      if (reference.restingHRIsEstimated) flags.push('resting-hr-estimated');
    } else if (fitness.effort.source === 'rpe') {
      flags.push('effort-from-rpe');
    } else {
      flags.push('effort-not-scaled');
    }
    if (
      fitness.effort.fraction !== null &&
      fitness.benchmarkEffortFraction / fitness.effort.fraction > EFFORT_EXTRAPOLATION_FLAG_RATIO
    ) {
      flags.push('effort-credit-extrapolated');
    }
    if (fitness.elevationFraction > 0) flags.push('terrain-adjusted');
    if (fitness.temperatureFraction > 0) flags.push('weather-adjusted');
    if (fitness.bodyweightFactor !== 1) flags.push('bodyweight-adjusted');

    adjustments = {
      projectedSeconds: Math.round(fitness.projectedSeconds * 10) / 10,
      effortSource: fitness.effort.source,
      effortFraction: fitness.effort.fraction === null ? null : Math.round(fitness.effort.fraction * 1000) / 1000,
      benchmarkEffortFraction: Math.round(fitness.benchmarkEffortFraction * 1000) / 1000,
      effortRatio: Math.round(fitness.effortRatio * 1000) / 1000,
      elevationFraction: Math.round(fitness.elevationFraction * 1000) / 1000,
      temperatureFraction: Math.round(fitness.temperatureFraction * 1000) / 1000,
      bodyweightFactor: Math.round(fitness.bodyweightFactor * 1000) / 1000,
      ageFactor,
    };

    personal = personalOutcome(input, fitness, reference);
    flags.push(...personal.flags);

    // Confidence: how much of the number rests on measurement rather than
    // estimate. A heart-rate-read session with cross-session memory behind it
    // is the strongest case; an HR-less, RPE-less one the weakest; a long
    // effort extrapolation (fitness.confidence) discounts either.
    const base = fitness.effort.source === 'hr' ? 0.85 : fitness.effort.source === 'rpe' ? 0.75 : 0.65;
    const memoryBonus = input.storedPredictionSeconds != null ? 0.1 : 0;
    if (input.storedPredictionSeconds != null) flags.push('memory-available');
    confidence = clamp((base + memoryBonus) * fitness.confidence, 0, 1);
  }

  // Pacing quality — reward negative splits (2nd half >= 1st half), penalize fade.
  const dec = decoupling(input);
  let decouplingAdjustment = 0;
  if (dec !== null) {
    decouplingAdjustment = clamp(-dec * 3, -40, 40);
    if (dec > 6) flags.push('positive-split-fade');
    if (dec < -2) flags.push('negative-split-strong');
  }

  let executionScore: number | null = null;
  if (fitness) {
    const EXECUTION_NEUTRAL = 500;
    const volumeBonus = enduranceVolumeBonus(input.durationSeconds);
    if (volumeBonus > MAX_VOLUME_BONUS * 0.5) flags.push('long-session-credit');
    const elevationBonus = elevationDifficultyBonus(input.elevationMeters, input.distanceMeters);
    if (elevationBonus > MAX_ELEVATION_BONUS * 0.5) flags.push('hilly-terrain-credit');
    const temperatureBonus = temperatureDifficultyBonus(input.temperatureCelsius);
    if (temperatureBonus > MAX_TEMPERATURE_BONUS * 0.5) flags.push('harsh-conditions-credit');
    executionScore = clamp(
      Math.round(EXECUTION_NEUTRAL + volumeBonus + elevationBonus + temperatureBonus + decouplingAdjustment),
      0,
      1000
    );
  }

  const ef = efficiencyFactor(input);
  const tr = trimp(input);
  const rounded = Math.round(clamp(populationScore, 0, 1000));
  const equivalent = fitness ? fitness.equivalentSeconds : null;

  return {
    score: rounded,
    paceScore: rounded,
    populationScore: rounded,
    personalScore: personal.score,
    personal: personal.comparison,
    ageGradeFactor: appliedAgeGradeFactor,
    fitnessEquivalentSeconds: equivalent === null ? null : Math.round(equivalent * 10) / 10,
    adjustments,
    executionScore,
    vo2max: vo2max === null ? null : Math.round(vo2max * 10) / 10,
    vo2maxMethod: method,
    trimp: tr === null ? null : Math.round(tr * 10) / 10,
    efficiencyFactor: ef === null ? null : Math.round(ef * 1000) / 1000,
    decouplingPct: dec === null ? null : Math.round(dec * 10) / 10,
    // Anchored on the fitness equivalent — the same number both scores are
    // built from — so an easy run predicts the race times its demonstrated
    // fitness implies, not the times its deliberately slower pace would.
    predictions: (() => {
      if (equivalent === null) return null;
      const benchmarkDistance = BENCHMARK_DISTANCE_METERS[input.benchmarkSport];
      switch (input.benchmarkSport) {
        case 'run':
          return riegelPredictions(benchmarkDistance, equivalent, input.experience, input.personalizedRiegelK);
        case 'row':
        case 'ski':
        case 'swim':
          return sportRacePredictions(
            input.benchmarkSport,
            benchmarkDistance,
            equivalent,
            input.experience,
            input.personalizedRiegelK
          );
        case 'walk':
          return walkPacePredictions(input.distanceMeters, input.durationSeconds);
        default:
          return null;
      }
    })(),
    confidence: Math.round(confidence * 100) / 100,
    flags,
  };
}
