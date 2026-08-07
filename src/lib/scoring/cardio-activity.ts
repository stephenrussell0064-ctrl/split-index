/**
 * Split Index — Cardio scoring engine ("The Engine")
 * ---------------------------------------------------
 * Every activity (run / walk / row / swim / cycle / ski) gets a per-activity
 * score on a 0–1000 scale, plus the underlying physiological estimates
 * (VO2max, predicted race times, training load) that justify it.
 *
 * Primary scoring path (MASTER-BRIEF.md §4–5, monotonicity-bug fix): every
 * session is projected to its sport's benchmark distance via Riegel, then
 * HR-adjusted so a lower-HR session yields a faster (better) equivalent.
 * THIS session's own equivalent — never a multi-session memory — is what
 * gets scored on the calibrated anchor table (see cardio-benchmarks.ts).
 *
 * `score` (= `paceScore`) is pure and monotonic BY CONSTRUCTION: nothing —
 * no volume/terrain/environment bonus, no session-type weighting, no
 * pacing-quality adjustment — is ever added on top of it. A faster time for
 * the same activity can never score lower, full stop, and it's what the
 * rolling per-activity index averages/rolls up from. Volume/terrain/
 * environment credit and pacing-quality (negative split / fade) instead
 * feed a clearly separate `executionScore` — "how well was this session
 * executed," never blended back into `score`. An earlier attempt to keep a
 * single blended number (bounding the modifier to ±5% of paceScore so it
 * couldn't invert ordering) had a real side effect: the *absolute* bonus
 * allowance scaled with how fast the pace read, so a long/easy/low-HR run
 * (modest paceScore by design) got a much smaller allowance than a hard
 * fast effort — inverting the intent of rewarding sustained aerobic
 * durability "independent of how fast or easy it was." The two-number
 * split is the more robust fix (see cardio-session-score-monotonicity-bug.md).
 *
 * A per-user, per-sport memory (`storedPredictionSeconds`, maintained by the
 * caller across sessions, blended asymmetrically — a faster effort pulls it
 * down fast, a slower one barely nudges it) still exists and informs
 * `confidence`/flags (this athlete has proven this fitness across sessions,
 * not just today), but it must never replace this session's own equivalent —
 * doing so previously let a session's score depend on history rather than
 * its own pace.
 *
 * FREE tier reads `score` and `vo2max`.
 * PREMIUM tier additionally surfaces `executionScore`, `trimp`,
 * `efficiencyFactor`, `decoupling`, `predictions`, and `confidence`.
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
  computeSessionBenchmarkEquivalentSeconds,
  computeIntervalBenchmarkEquivalentSeconds,
  riegelEquivalentSeconds,
  RIEGEL_K,
  RELATIVE_EFFORT_SESSION_TYPES,
  MISTAG_GUARD_MAX_RATIO,
  elevationDifficultyFraction,
  temperatureDifficultyFraction,
  terrainHeatEffortCreditMultiplier,
  HR_ZONE_SPORTS,
  HR_ZONE_TARGET_CREDIT,
  computeHrZoneProfile,
  hrZoneEffortAdjustment,
  belowBasePaceCorroboration,
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
  /** This athlete's own baseline efficiency factor (speed per heartbeat) from recent easy/recovery/long same-sport sessions (see personalEasyEffortBaselineEF in cardio-predictions.ts). When present and sessionType is easy/recovery/long, the score is anchored to how this session's own efficiency compares to that personal baseline instead of the population pace-vs-benchmark table — omit/null to keep the standard scoring for these session types too. */
  easyEffortBaselineEF?: number | null;
  /** Mistag guard: this athlete's fastest recent race/tempo/threshold/interval/fartlek pace, Riegel-projected to the benchmark distance (see personalRecentHardEffortBenchmarkSeconds in cardio-predictions.ts). When an easy/recovery/long-tagged session's own pace is suspiciously close to this reference, it's more likely a hard effort logged with the wrong tag than a genuine easy run, so relative-effort scoring is skipped in favor of standard scoring. Omit/null to skip the guard (e.g. no hard-effort history yet). */
  recentHardEffortBenchmarkSeconds?: number | null;
  /** This athlete's own HR-independent baseline pace (Riegel-projected seconds at the benchmark distance) from recent easy/recovery/long same-sport sessions — see personalEasyEffortBaselinePaceSeconds. Used only to corroborate an at/below-base HR-zone reading (see hrZoneEffortAdjustment's below-base guard); omit/null to trust a below-base reading outright. */
  easyEffortBaselinePaceSeconds?: number | null;
  /** This athlete's own recent ALREADY-SCORED easy/recovery/long same-sport session scores (0-1000, most recent first or any order — only the median is used) — see EASY_SCORE_FLOOR_FRACTION below. A well-executed easy effort at a deliberately slower pace shouldn't score far below this athlete's demonstrated normal range for that same kind of session (user feedback), so this sets a bonus-only floor under the pace-derived score. Distinct from and safer than storedPredictionSeconds: these are real, settled past outcomes, not a lagging cross-session memory, so using them here can't reintroduce the monotonicity bug that constraint exists for. Omit/null (or fewer than MIN_RECENT_EASY_SCORES) to skip the floor entirely. */
  recentEasyEffortScores?: number[] | null;
  /**
   * This athlete's own personal Riegel k (see personalizeRiegelKFromWindow
   * in cardio/race-prediction.ts) derived from their own cross-distance
   * race/tempo/threshold history — overrides the flat system default
   * (RIEGEL_K) for BOTH this session's own score anchor (the distance ->
   * benchmark-distance projection every branch below runs through) and the
   * outward-facing predictions ladder, so a genuine endurance or speed bias
   * in this athlete's own data is reflected everywhere Riegel is used, not
   * just the separate Tier 1/Tier 2 race-prediction memory. Omit/null to
   * fall back to the system default everywhere (e.g. not enough of this
   * athlete's own comparable-effort, cross-distance evidence yet).
   */
  personalizedRiegelK?: number | null;
}

export interface CardioResult {
  /** Pure, monotonic pace-performance score — Riegel/work-piece equivalent + age/sex grading run through the anchor table, nothing else touches it. A faster time for the same activity can never score lower here, by construction. This is "the score for this run" and what the rolling per-activity index rolls up from. Identical to `paceScore`. */
  score: number;
  /** Alias of `score` — kept as its own field so callers can be explicit about which number they mean. */
  paceScore: number;
  /** Separate, secondary "how well was this session executed" metric — pacing quality (negative split / fade) and, when volume/terrain/environment data is present, sustained-aerobic-durability credit. Never blended into `score`/`paceScore`; can be lower than the pace score, and can be null when there's no execution-quality signal to assess. */
  executionScore: number | null;
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

// Relative-effort scoring cap for easy/recovery/long-tagged sessions —
// bonus-only (never a penalty, same philosophy as the HR adjustment above),
// wider than the population HR-adjustment cap (10%) because this factor is
// personalized (this athlete's OWN typical easy effort, not a fixed
// population reference), so genuinely beating one's own baseline deserves
// more credit than a population-wide number could safely assume for
// everyone.
const RELATIVE_EFFORT_MAX_ADJUSTMENT = 0.20;

// Easy-session score floor (user feedback: a well-executed easy/recovery/
// long run "should not deviate that far from my normal scores" despite a
// deliberately slower pace) — the floor sits at this fraction of the
// athlete's own recent median easy-effort score, not 1.0, so a genuinely
// off day can still score below normal; it just can't collapse arbitrarily
// far below it the way pure pace/HR-zone math alone sometimes did.
const EASY_SCORE_FLOOR_FRACTION = 0.85;
// Same minimum-sample-size philosophy as MIN_EASY_BASELINE_SAMPLES in
// cardio-predictions.ts (kept independent rather than imported — this is a
// different signal, real settled scores rather than a pace/EF baseline) —
// one lucky or unlucky recent score shouldn't set the floor for everyone after it.
const MIN_RECENT_EASY_SCORES = 3;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Inverse of timeToScore via binary search — timeToScore is monotonic
 * (strictly decreasing) in seconds for a fixed sport/sex, so this always
 * converges. Exists only so the easy-session floor above can be expressed
 * as an adjustment to the equivalent-seconds fed into the anchor table —
 * the same mechanism every other credit in this file uses — rather than a
 * direct post-hoc bump to paceScore itself, which the file header
 * documents as never happening.
 */
function secondsForScore(sport: BenchmarkSport, targetScore: number, sex: 'male' | 'female'): number {
  let lo = 1; // ~world-record-adjacent, upper score bound
  let hi = 100_000; // ~27.8 hours, lower score bound
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (timeToScore(sport, mid, sex) > targetScore) {
      lo = mid; // still scoring above target — this session needs to be slower to hit it
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

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
const MAX_TEMPERATURE_BONUS = 15;

/** Rewards sheer time-under-aerobic-load, independent of how fast or easy it was. */
function enduranceVolumeBonus(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const minutes = durationSeconds / 60;
  return MAX_VOLUME_BONUS * (minutes / (minutes + VOLUME_HALF_SATURATION_MINUTES));
}

// Long-run endurance credit for easy/recovery/long-tagged sessions (user
// feedback: "the longer you run, the harder it is at any split, therefore
// these should be scoring higher for the further distance" — the pure
// pace/HR equivalent above doesn't reflect this at all: Riegel's exponent
// actually discounts a LONGER session's projected 5K time relative to a
// shorter one at the same pace/HR, the opposite of what sustaining that
// effort for longer actually demonstrates). Distinct from
// `enduranceVolumeBonus` above — that's a separate, secondary metric folded
// only into `executionScore`, never the primary score (see this file's
// monotonicity-guarantee comment); this credit instead nudges
// `sessionEquivalentSeconds` itself, bonus-only, so it flows into BOTH the
// score and the predictions ladder the same way the HR-zone/EF-baseline
// credits already do. Saturates well short of 1.0 — a very long run is real
// evidence of aerobic durability, not proof of unlimited 5K speed.
// Raised from 0.12/75min (user feedback: "the long runs need to be credited
// in the 5km prediction slightly more") — both the cap and the ramp-up
// speed nudged up modestly rather than reworking the curve's shape.
const LONG_RUN_DISTANCE_CREDIT_MAX = 0.18;
const LONG_RUN_CREDIT_HALF_SATURATION_MINUTES = 60; // minutes at which half of the max credit is earned

export function longRunDistanceCredit(durationSeconds: number): number {
  if (durationSeconds <= 0) return 0;
  const minutes = durationSeconds / 60;
  return LONG_RUN_DISTANCE_CREDIT_MAX * (minutes / (minutes + LONG_RUN_CREDIT_HALF_SATURATION_MINUTES));
}

/** Rewards climbing — the same pace/HR is a harder effort on hillier terrain. Shares its difficulty curve (elevationDifficultyFraction) with relative-effort scoring's much smaller terrain credit — see cardio-predictions.ts. */
function elevationDifficultyBonus(elevationMeters?: number | null, distanceMeters?: number | null): number {
  return elevationDifficultyFraction(elevationMeters, distanceMeters) * MAX_ELEVATION_BONUS;
}

/** Rewards heat/cold — deviation from a comfortable reference temperature in either direction. Shares its difficulty curve (temperatureDifficultyFraction) with relative-effort scoring's much smaller heat credit — see cardio-predictions.ts. */
function temperatureDifficultyBonus(temperatureCelsius?: number | null): number {
  return temperatureDifficultyFraction(temperatureCelsius) * MAX_TEMPERATURE_BONUS;
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
 * Population-typical resting HR by experience tier — used only when an
 * athlete has a measured max HR but never answered the (optional) resting
 * HR onboarding question. Without this, computeHrZoneProfile requires BOTH
 * values and returns null, silently dropping every easy/recovery/long
 * session for that athlete to the much weaker EF-baseline/population
 * fallback (user feedback: this made easy efforts score far too low for
 * anyone who'd skipped just that one field). Trained endurance athletes
 * genuinely run a lower resting HR than untrained ones (greater stroke
 * volume) — the same population pattern the Riegel-k experience tiers
 * elsewhere in this file already lean on. Flagged as estimated wherever
 * it's used (see hr-zone-resting-hr-estimated) rather than presented with
 * the same confidence as a measured value.
 */
export function estimateRestingHR(experience: CardioInput['experience']): number {
  return experience === 'advanced' ? 58 : experience === 'beginner' ? 72 : 65;
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

/**
 * Riegel race-time predictions across the standard ladder. `personalizedK`
 * (see personalizedRiegelK in cardio-predictions.ts) overrides the generic
 * experience-tier k below with this athlete's own realized cross-distance
 * profile when enough evidence exists — omit/null to fall back to the
 * experience-tier default. Without this, every athlete's ladder used the
 * same flat k regardless of their own data, silently ignoring the
 * personalization this app already computes and stores elsewhere (user
 * feedback: 10k/half/marathon predictions read as too optimistic off a
 * genuine 5k time — a systematically-too-low k for that athlete does
 * exactly this, since it under-penalizes longer distances).
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

/**
 * Race-ladder predictions for row/ski/swim — same Riegel projection as
 * running's ladder above, just each sport's own typical benchmark
 * distances (user feedback: only running had a ladder; row/ski/swim/walk
 * did not). Walk gets its own linear (non-Riegel) ladder further below,
 * since walking is already treated everywhere else in this file as a
 * roughly constant per-km pace rather than a distance with its own fatigue
 * curve (see the `sport === 'walk'` branch in cardio-predictions.ts).
 */
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

/** Linear (no Riegel exponent) pace-based ladder for walking — this session's own per-km pace scaled to each distance, matching how walk is scored everywhere else (constant pace, not a fatigue curve). */
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
 * Live in-progress score/time prediction ladder (user feedback: "based off
 * the current pace, heart rate you are able to extrapolate a score
 * prediction for set distances") — for a GPS-tracked session that's still
 * running, not a finished one. Pure and client-computable: no DB access, no
 * multi-session memory, just this session's own pace/HR so far projected
 * forward via the same Riegel + HR-adjustment pipeline the real score uses
 * (`computeSessionBenchmarkEquivalentSeconds`), then re-projected across the
 * standard race ladder from the benchmark distance. Deliberately NOT the
 * same number this session will actually score once saved — that also runs
 * through the easy-session floor and EF-baseline stacking (see
 * scoreCardioActivity), neither of which make sense for a still-in-progress
 * session with no completed history of "this" run to floor against — this
 * is an honest live estimate, not a preview of the final score.
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
  const benchmarkEquivalentSeconds = computeSessionBenchmarkEquivalentSeconds(
    benchmarkSport,
    distanceMeters,
    durationSeconds,
    avgHR,
    undefined,
    personalization
  );
  if (benchmarkEquivalentSeconds === null) return null;
  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[benchmarkSport];
  const k = personalizedK ?? RIEGEL_K;
  return ladder.map(({ meters, label }) => {
    const seconds = benchmarkEquivalentSeconds * Math.pow(meters / benchmarkDistance, k);
    return { label, meters, seconds, score: timeToScore(benchmarkSport, seconds, sex) };
  });
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

  // Estimate resting HR from experience tier when not set — the same
  // fallback the HR-zone mechanism below already uses for easy/recovery/long
  // sessions, hoisted here so the PLAIN population HR-adjustment path
  // (resolveReferenceHR in cardio-predictions.ts) gets it too. Without this,
  // any tempo/race/threshold session for an athlete who hadn't set a resting
  // HR fell back to a flat, sport-generic reference (175bpm for running)
  // instead of one scaled to this athlete's own actual max HR — user
  // feedback: a hard 6km tempo (178bpm, well below this athlete's real max)
  // earned ~0% HR credit and read as barely faster than raw pace, because
  // resolveReferenceHR silently drops all personalization whenever
  // restingHR is null, even with maxHR known and an estimate one call away.
  const restingHRIsEstimated = !input.restingHR && !!input.maxHR;
  const effectiveRestingHR = input.restingHR ?? (input.maxHR ? estimateRestingHR(input.experience) : null);

  const personalization = { restingHR: effectiveRestingHR, maxHR: hrMaxForPersonalization };
  // This athlete's own personal Riegel k (see CardioInput.personalizedRiegelK)
  // — falls back to the system default (RIEGEL_K, via each callee's own
  // default parameter) when absent, same as before this was threaded in.
  const riegelK = input.personalizedRiegelK ?? undefined;
  let sessionEquivalentSeconds: number | null;
  if (isValidIntervalWorkPiece(input.structuredInterval)) {
    sessionEquivalentSeconds = computeIntervalBenchmarkEquivalentSeconds(
      input.benchmarkSport,
      intervalTotalWorkDistanceMeters(input.structuredInterval),
      intervalEquivalentPaceSecPerKm(input.structuredInterval),
      input.structuredInterval.workAvgHeartRate,
      riegelK,
      personalization
    );
    flags.push('interval-work-piece-scored');
  } else if (isValidFartlekOnPiece(input.structuredFartlek)) {
    sessionEquivalentSeconds = computeIntervalBenchmarkEquivalentSeconds(
      input.benchmarkSport,
      input.structuredFartlek.onDistanceMeters,
      fartlekEquivalentPaceSecPerKm(input.structuredFartlek),
      input.structuredFartlek.onAvgHeartRate,
      riegelK,
      personalization
    );
    flags.push('fartlek-work-piece-scored');
  } else {
    // Relative-effort scoring (user feedback): easy/recovery/long-tagged
    // sessions are DESIGNED to be run slow at low HR — judging them on the
    // same absolute pace-vs-benchmark table as a race/tempo/threshold effort
    // means the ~10%-capped population HR adjustment above can never
    // compensate for a deliberately easy pace, so genuinely well-executed
    // easy runs read as low scores. When a personal easy-effort baseline
    // exists (this athlete's own recent easy/recovery/long same-sport
    // sessions — see personalEasyEffortBaselineEF), these tags get an
    // ADDITIONAL, BONUS-ONLY credit when this session's own efficiency
    // factor (speed per heartbeat) beats that personal baseline — never a
    // penalty when it falls short. Being less efficient than one's own
    // recent average on an easy day isn't a fitness deficiency (fatigue,
    // heat, terrain — already credited separately via executionScore); the
    // population-referenced score above is never worse than it already was,
    // it can only improve, mirroring the bonus-only philosophy of the HR
    // adjustment already applied above (hrAdjustedEquivalentSeconds).
    // Race/tempo/threshold/interval/fartlek sessions are untouched: those
    // ARE meant to measure absolute pace capability.
    // Race-tagged sessions skip the population HR-adjustment credit entirely
    // (user feedback: "it isn't possible to get an average of your max heart
    // rate... if you've just done a 5km at 3:50 188bpm average it is
    // unlikely for you to run [meaningfully faster] next time"). A sustained
    // hard effort's AVERAGE heart rate is always well below one's true
    // instantaneous max — that gap is a mechanical property of how HR ramps
    // over minutes, not unused reserve, so treating it as headroom
    // systematically over-credits an effort that was already a genuine
    // best-effort race result. Tempo/threshold/interval/fartlek sessions are
    // untouched: those genuinely ARE run below the athlete's ceiling on
    // purpose, and the credit there is real (validated against a real
    // tempo run: 6km @ 4:06/km @ 178bpm correctly predicted faster).
    const raceCreditAvgHR = input.sessionType === 'race' ? undefined : input.avgHR;
    const populationEquivalentSeconds = computeSessionBenchmarkEquivalentSeconds(
      input.benchmarkSport,
      input.distanceMeters,
      input.durationSeconds,
      raceCreditAvgHR,
      riegelK,
      personalization
    );

    const isRelativeEffortSession =
      !!input.sessionType && RELATIVE_EFFORT_SESSION_TYPES.has(input.sessionType);
    const rawSessionEF = efficiencyFactor(input);
    // Terrain/heat difficulty credited directly into the efficiency-factor
    // comparison (not just executionScore) for relative-effort scoring —
    // the same pace/HR on a hilly, hot day is genuinely harder than on flat,
    // cool ground, and easy/recovery/long sessions are exactly where "effort,
    // not pace" should matter most. Bonus-only (multiplier >= 1), same
    // philosophy as the rest of relative-effort scoring.
    const thisSessionEF =
      rawSessionEF !== null
        ? rawSessionEF *
          terrainHeatEffortCreditMultiplier(input.elevationMeters, input.distanceMeters, input.temperatureCelsius)
        : null;
    const rawProjectedSeconds =
      input.distanceMeters > 0 && input.durationSeconds > 0
        ? input.benchmarkSport === 'walk'
          ? input.durationSeconds / (input.distanceMeters / 1000)
          : riegelEquivalentSeconds(
              input.durationSeconds,
              input.distanceMeters,
              BENCHMARK_DISTANCE_METERS[input.benchmarkSport],
              riegelK
            )
        : null;
    const looksMistagged =
      rawProjectedSeconds !== null &&
      input.recentHardEffortBenchmarkSeconds != null &&
      rawProjectedSeconds < input.recentHardEffortBenchmarkSeconds * MISTAG_GUARD_MAX_RATIO;
    if (looksMistagged) flags.push('easy-tag-pace-mismatch');

    // Personalized HR-zone scoring (user feedback) takes priority over the
    // EF-baseline mechanism below when this athlete has both resting/max HR
    // on file and this session has an avg HR reading, for the sports the
    // zone model applies to (walking excluded — see HR_ZONE_SPORTS). It
    // REPLACES, not stacks with, the EF-baseline bonus: symmetric credit
    // below target, penalty above, both anchored to this athlete's own
    // heart-rate reserve rather than a population or same-athlete-pace
    // reference.
    const zoneEligibleSport = HR_ZONE_SPORTS.has(input.benchmarkSport);
    // A real, measured resting HR is still preferred — but requiring it
    // outright meant an athlete who simply skipped that one (optional,
    // unlike max HR) onboarding question got NONE of this mechanism's
    // personalized easy-effort credit, on every relative-effort session,
    // forever, silently falling back to the much weaker EF-baseline/
    // population path instead (user feedback: easy efforts scoring far too
    // low). An experience-tier estimate still personalizes on this
    // athlete's own actual max HR and avg HR reading; it's flagged as
    // estimated so the UI can be honest about the reduced confidence.
    const hrZoneProfile = zoneEligibleSport ? computeHrZoneProfile(effectiveRestingHR, input.maxHR) : null;
    const hasHrZoneData = !!hrZoneProfile && !!input.avgHR;
    if (isRelativeEffortSession && zoneEligibleSport && !hasHrZoneData) {
      // Flags the caller/UI that this session's score would be more
      // accurate with resting/max HR + an avg HR reading, even though it
      // still gets a valid score via the EF-baseline/population fallback.
      flags.push('hr-zone-data-missing');
    } else if (isRelativeEffortSession && zoneEligibleSport && hasHrZoneData && restingHRIsEstimated) {
      flags.push('hr-zone-resting-hr-estimated');
    }

    if (
      isRelativeEffortSession &&
      !looksMistagged &&
      hrZoneProfile &&
      input.avgHR &&
      rawProjectedSeconds !== null
    ) {
      const belowBase = input.avgHR <= hrZoneProfile.base;
      const paceCorroboration = belowBase
        ? belowBasePaceCorroboration(rawProjectedSeconds, input.easyEffortBaselinePaceSeconds)
        : undefined;
      const zoneResult = hrZoneEffortAdjustment(input.avgHR, hrZoneProfile, paceCorroboration);
      sessionEquivalentSeconds = rawProjectedSeconds * (1 - zoneResult.adjustmentFraction);
      flags.push('hr-zone-scored');
      // Flagged on HR position relative to target, not the resulting credit/
      // penalty sign — every at/below-target session now clears the flat
      // credit floor (HR_ZONE_TARGET_CREDIT), so "credit" alone can't tell
      // the UI whether this session was actually above or below target.
      flags.push(input.avgHR <= hrZoneProfile.target ? 'hr-zone-at-or-below-target' : 'hr-zone-above-target');
      if (zoneResult.zone === 'penalty') flags.push('hr-zone-penalty');
      if (zoneResult.belowBaseGuardApplied) flags.push('hr-zone-below-base-guard');

      // Stacked fitness-maintenance bonus (user feedback): HR-zone position
      // alone doesn't know this athlete's demonstrated race fitness — a
      // deliberately slow, well-controlled long run at low HR can look only
      // modestly better than average on zone math alone, even though the
      // athlete's own recent easy-effort efficiency shows they haven't lost
      // fitness. Reuses the same personal-EF-baseline signal as the
      // population-branch's relative-effort mechanism below, just stacked on
      // top of the zone result instead of substituted for it. Bonus-only
      // (efRatio > 1 required) and capped at the same
      // RELATIVE_EFFORT_MAX_ADJUSTMENT, so this can only improve — never
      // worsen — the zone-computed score, and never revisits
      // storedPredictionSeconds.
      if (input.easyEffortBaselineEF && thisSessionEF) {
        const efRatio = thisSessionEF / input.easyEffortBaselineEF;
        const stackedBonus = clamp(efRatio - 1, 0, RELATIVE_EFFORT_MAX_ADJUSTMENT);
        if (stackedBonus > 0) {
          sessionEquivalentSeconds *= 1 - stackedBonus;
          flags.push('relative-effort-scored');
        }
      }
    } else if (
      isRelativeEffortSession &&
      !looksMistagged &&
      input.easyEffortBaselineEF &&
      thisSessionEF &&
      rawProjectedSeconds !== null &&
      populationEquivalentSeconds !== null
    ) {
      const efRatio = thisSessionEF / input.easyEffortBaselineEF;
      const bonus = clamp(efRatio - 1, 0, RELATIVE_EFFORT_MAX_ADJUSTMENT);
      const relativeEquivalentSeconds =
        bonus > 0 ? rawProjectedSeconds * (1 - bonus) : populationEquivalentSeconds;
      sessionEquivalentSeconds = Math.min(populationEquivalentSeconds, relativeEquivalentSeconds);
      if (sessionEquivalentSeconds < populationEquivalentSeconds) {
        flags.push('relative-effort-scored');
      }
    } else if (
      isRelativeEffortSession &&
      zoneEligibleSport &&
      !looksMistagged &&
      !input.avgHR &&
      rawProjectedSeconds !== null
    ) {
      // No avg HR reading at all for this session (the branches above both
      // require one). User feedback: rather than judge a genuinely HR-blind
      // easy/recovery/long session on the same absolute pace table as a race
      // effort, assume it was executed at target — a well-paced,
      // well-controlled easy run — and credit it accordingly. This is a
      // guess, not a measurement, so it's clearly flagged for the UI
      // (hr-zone-assumed-target) rather than presented as confidently as an
      // actual HR-zone-scored session. A session that DOES have an avg HR
      // reading but simply lacks a baseline/zones to compare it against
      // falls through to the plain population branch below instead — real
      // (if uncalibrated) HR data shouldn't be silently overridden by a
      // guess.
      sessionEquivalentSeconds = rawProjectedSeconds * (1 - HR_ZONE_TARGET_CREDIT);
      flags.push('hr-zone-assumed-target');
    } else {
      sessionEquivalentSeconds = populationEquivalentSeconds;
    }

    // Long-run distance credit — see LONG_RUN_DISTANCE_CREDIT_MAX's doc
    // comment. Same "regardless of which branch scored it" philosophy as the
    // easy-session floor below: a well-executed long easy run deserves this
    // credit whether it was scored by the HR-zone mechanism, the EF-baseline
    // stack, assumed-target, or plain population fallback.
    if (isRelativeEffortSession && !looksMistagged && sessionEquivalentSeconds !== null) {
      const distanceCredit = longRunDistanceCredit(input.durationSeconds);
      if (distanceCredit > 0) {
        sessionEquivalentSeconds *= 1 - distanceCredit;
        if (distanceCredit > LONG_RUN_DISTANCE_CREDIT_MAX * 0.5) flags.push('long-run-distance-credit');
      }
    }

    // Overall stacking cap (user feedback: a real 19.14km run at a genuine
    // long-run pace scored as if its 5K equivalent were ~17:33 — implausibly
    // fast). The HR-zone credit above (up to 21%), its stacked EF-baseline
    // bonus (up to another 20%), and the long-run distance credit (up to
    // 18%) were each independently reasoned and capped on their own, but
    // multiplying all three together compounds to a far larger combined
    // discount than any single mechanism was designed to allow (up to ~48%
    // off the raw pace-projected time). This caps the TOTAL combined credit
    // across every relative-effort mechanism above, not any one of them
    // individually — a genuinely well-executed easy/recovery/long session
    // can still earn meaningful credit, just not an unbounded stack of them.
    // Lowered from 0.30 (user feedback, after the demonstrated-best ceiling
    // below still wasn't enough: "this is still too high for a score, and
    // the credit for these runs needs to be reduced slightly").
    const MAX_TOTAL_RELATIVE_EFFORT_DISCOUNT = 0.25;
    if (
      isRelativeEffortSession &&
      !looksMistagged &&
      sessionEquivalentSeconds !== null &&
      rawProjectedSeconds !== null
    ) {
      const flooredByStackCap = rawProjectedSeconds * (1 - MAX_TOTAL_RELATIVE_EFFORT_DISCOUNT);
      if (sessionEquivalentSeconds < flooredByStackCap) {
        sessionEquivalentSeconds = flooredByStackCap;
        flags.push('relative-effort-discount-capped');
      }
    }

    // Demonstrated-capability ceiling (user feedback, with real numbers: a
    // 19.14km easy run at 47bpm resting HR credited all the way to a 17:33
    // predicted 5K — FASTER than this athlete's own actual best-ever 5K
    // (18:25), because their genuinely low resting HR alone makes 166bpm
    // read as "at/below target," and that credit is legitimate on its own
    // terms. `recentHardEffortBenchmarkSeconds` (this athlete's fastest
    // recent race/tempo/threshold pace, already computed and passed in for
    // the mistag guard above) is real, DEMONSTRATED evidence of this
    // athlete's actual capability — an easy run's credited equivalent
    // should be allowed to approach it, never exceed it.
    //
    // Floored at a small margin ABOVE (slower than) the literal PR, not
    // the PR itself (user feedback, after landing exactly on the PR still
    // read as too generous: "this is still too high... the credit for
    // these runs needs to be reduced slightly") — an easy training run can
    // look close to race fitness, but shouldn't fully match a dedicated
    // race effort at the same distance.
    const DEMONSTRATED_BEST_MARGIN = 1.03;
    if (
      isRelativeEffortSession &&
      !looksMistagged &&
      sessionEquivalentSeconds !== null &&
      input.recentHardEffortBenchmarkSeconds != null
    ) {
      const demonstratedBestFloor = input.recentHardEffortBenchmarkSeconds * DEMONSTRATED_BEST_MARGIN;
      if (sessionEquivalentSeconds < demonstratedBestFloor) {
        sessionEquivalentSeconds = demonstratedBestFloor;
        flags.push('relative-effort-capped-at-demonstrated-best');
      }
    }

    // Easy-session score floor — see EASY_SCORE_FLOOR_FRACTION's doc comment.
    // Deliberately NOT gated on which branch above scored this session
    // (HR-zone, EF-baseline-stacked, assumed-target, or plain population):
    // this is a last-resort safety net for a well-executed easy effort
    // regardless of which upstream mechanism under-credited it.
    if (
      isRelativeEffortSession &&
      !looksMistagged &&
      sessionEquivalentSeconds !== null &&
      input.recentEasyEffortScores &&
      input.recentEasyEffortScores.length >= MIN_RECENT_EASY_SCORES
    ) {
      const floorScore = median(input.recentEasyEffortScores) * EASY_SCORE_FLOOR_FRACTION;
      const ageFactorForFloor = enduranceAgeGradeFactor(input.age);
      const floorSeconds = secondsForScore(input.benchmarkSport, floorScore, input.sex) / ageFactorForFloor;
      if (floorSeconds < sessionEquivalentSeconds) {
        sessionEquivalentSeconds = floorSeconds;
        flags.push('easy-session-floor-applied');
      }
    }
  }
  // IMPORTANT — monotonicity guarantee (see cardio-session-score-monotonicity
  // -bug.md): the per-session score must ALWAYS be anchored to THIS session's
  // own pace/HR-adjusted equivalent, never to `storedPredictionSeconds` (the
  // asymmetric multi-session memory). A prior bug used the memory value here
  // whenever it existed, which meant a session's score depended on the
  // athlete's *history* rather than its own pace — a much faster run could
  // score lower than a slower one simply because prior sessions were slower
  // and the memory hadn't fully "caught up" (IMPROVE_RATE only pulls it 55%
  // of the way). The memory is still valuable context (this athlete has
  // proven this fitness across sessions, not just today), so it still
  // informs `confidence` and a flag — it just can never replace the number
  // that answers "how good was this specific run."
  const anchorSeconds = sessionEquivalentSeconds;

  let paceScore: number;
  let confidence: number;

  if (anchorSeconds !== null) {
    // Age-grade the benchmark-equivalent before scoring: an older athlete's
    // same finish time is a stronger performance, so their time is graded
    // down (credit for age); under-35s are unchanged (factor 1.0). Applied
    // to the score only — stored predictions and displayed race times stay
    // as the athlete's real (un-graded) times.
    const ageFactor = enduranceAgeGradeFactor(input.age);
    if (ageFactor !== 1) flags.push('age-graded');
    // paceScore: pure, monotonic — Riegel/work-piece equivalent + age/sex
    // grading run through the calibrated anchor table. NOTHING is added on
    // top of this — see the file header for why.
    paceScore = timeToScore(input.benchmarkSport, anchorSeconds * ageFactor, input.sex);
    if (input.storedPredictionSeconds != null) {
      flags.push('memory-available');
      confidence = input.avgHR ? 1 : 0.9;
    } else {
      confidence = input.avgHR ? 0.85 : 0.7;
    }
  } else {
    // No distance/duration to project from — shouldn't happen for a real
    // cardio session, but keep a safe, clearly-low-confidence fallback.
    paceScore = 0;
    confidence = 0.3;
  }

  // Pacing quality — reward negative splits (2nd half >= 1st half), penalize fade.
  const dec = decoupling(input);
  let decouplingAdjustment = 0;
  if (dec !== null) {
    // dec < 0 means got faster relative to HR: bonus. dec > 5% means faded: penalty.
    decouplingAdjustment = clamp(-dec * 3, -40, 40);
    if (dec > 6) flags.push('positive-split-fade');
    if (dec < -2) flags.push('negative-split-strong');
  }

  // executionScore — separate, secondary "how well was this session
  // executed" metric. Volume/terrain/environment credit (a long session, a
  // hilly one, one done in harsh heat/cold demonstrates real aerobic
  // durability a pace-per-heartbeat estimate alone won't capture) and
  // pacing quality (negative-split reward / fade penalty) land here instead
  // of on `paceScore` — this can vary independently, can be lower than
  // paceScore, and never overrides it.
  let executionScore: number | null = null;
  if (anchorSeconds !== null) {
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

  return {
    score: Math.round(clamp(paceScore, 0, 1000)),
    paceScore: Math.round(clamp(paceScore, 0, 1000)),
    executionScore,
    vo2max: vo2max === null ? null : Math.round(vo2max * 10) / 10,
    vo2maxMethod: method,
    trimp: tr === null ? null : Math.round(tr * 10) / 10,
    efficiencyFactor: ef === null ? null : Math.round(ef * 1000) / 1000,
    decouplingPct: dec === null ? null : Math.round(dec * 10) / 10,
    predictions: (() => {
      // Keyed off benchmarkSport (the fine-grained bucket), not the coarser
      // `type` — `type` previously grouped walking/indoor_cycling under
      // "run" for VO2max-method purposes, which meant they silently got a
      // running Riegel ladder (wrong distances/exponent for walking, and
      // no ladder was requested for cycling either).
      //
      // Anchored on `anchorSeconds` (this session's effort/HR-adjusted
      // benchmark-equivalent — the same number the score itself is built
      // from), NOT the raw input.distanceMeters/durationSeconds. Riegel
      // assumes whatever time it's fed was run flat-out; feeding it an
      // easy/recovery/long session's actual (deliberately slower) pace
      // made every ladder entry read as if that easy pace were an all-out
      // effort. Because Riegel's exponent scales with the distance ratio,
      // that error is tiny at 5K/10K (small ratio from most logged
      // distances) but balloons at half/marathon (4-8x ratio) — exactly
      // the "5K/10K read fine, half/marathon are very off" pattern from
      // user feedback. anchorSeconds already corrects for this (HR-zone
      // credit, easy-effort baseline, easy-session floor, interval
      // work-piece pace — see sessionEquivalentSeconds above), and is
      // already expressed at the sport's benchmark distance, so a
      // well-executed easy run now predicts the same race times a
      // flat-out effort at that same demonstrated fitness would.
      if (anchorSeconds === null) return null;
      const benchmarkDistance = BENCHMARK_DISTANCE_METERS[input.benchmarkSport];
      // Also personalized (input.personalizedRiegelK) rather than the
      // experience-tier default below, when available — this athlete's own
      // realized cross-distance k should drive how far the ladder extends
      // OUT from the benchmark distance too, not just how the benchmark
      // equivalent itself was computed above.
      switch (input.benchmarkSport) {
        case 'run':
          return riegelPredictions(benchmarkDistance, anchorSeconds, input.experience, input.personalizedRiegelK);
        case 'row':
        case 'ski':
        case 'swim':
          return sportRacePredictions(
            input.benchmarkSport,
            benchmarkDistance,
            anchorSeconds,
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
