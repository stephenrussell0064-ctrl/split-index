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
import type { SessionType } from "@/types";

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

/**
 * Riegel k personalization (Part H, scoring-calibration-rewrite.md).
 * k=1.06 is the literature-standard population average — confirmed
 * correct, not a finding, and still what RIEGEL_K above is nudged from.
 * But individual athletes genuinely vary: speed-oriented athletes fit
 * better around 1.03-1.05, endurance-oriented/ultra athletes around
 * 1.07-1.10. Rather than one flat k for every user, a user's own realized
 * cross-distance performances (e.g. their actual 5k-to-10k ratio, once
 * they've logged both) nudge their personal k within this literature-
 * supported band — same rolling-window convergence pattern already built
 * for the asymmetric benchmark-prediction memory (`updatePrediction`
 * above), reused here rather than introducing a new mechanism.
 *
 * Not yet wired into a stored per-user profile field/DB column (that's the
 * natural next step, mirroring how `resting_hr` was added for HR
 * personalization) — this is the enhancement's core, tested mechanism the
 * brief itself frames as "worth considering" rather than a required
 * corrected anchor.
 */
export const RIEGEL_K_DEFAULT = 1.06;
export const RIEGEL_K_MIN = 1.03;
export const RIEGEL_K_MAX = 1.10;

/** How fast a personal k converges toward the athlete's own newly-implied k per cross-distance data point (symmetric — unlike the benchmark-prediction blend, a race-profile shape isn't something effort alone can game, so there's no reason to move slower in one direction). */
const RIEGEL_K_CONVERGENCE_RATE = 0.2;

/**
 * The k that would exactly fit two of an athlete's own realized performances
 * at different distances, solving Riegel's equation for k:
 * t2 = t1 × (d2/d1)^k  =>  k = ln(t2/t1) / ln(d2/d1).
 * Clamped to the literature-supported band — a noisy pair of runs (e.g. one
 * far easier effort than the other) shouldn't be able to imply a k outside
 * what's physiologically plausible.
 */
export function impliedRiegelK(
  shorterDistanceMeters: number,
  shorterTimeSeconds: number,
  longerDistanceMeters: number,
  longerTimeSeconds: number
): number | null {
  if (
    shorterDistanceMeters <= 0 ||
    longerDistanceMeters <= 0 ||
    shorterTimeSeconds <= 0 ||
    longerTimeSeconds <= 0 ||
    longerDistanceMeters <= shorterDistanceMeters
  ) {
    return null;
  }
  const k =
    Math.log(longerTimeSeconds / shorterTimeSeconds) /
    Math.log(longerDistanceMeters / shorterDistanceMeters);
  if (!Number.isFinite(k)) return null;
  return clamp(k, RIEGEL_K_MIN, RIEGEL_K_MAX);
}

/**
 * Blend a newly-implied personal k into the athlete's stored personal k
 * (or RIEGEL_K_DEFAULT — actually RIEGEL_K, the current live population
 * default — when they don't have one yet), the same rolling-window
 * convergence pattern as the benchmark-prediction memory. Ramps toward the
 * athlete's own realized cross-distance profile over repeated data points
 * rather than snapping to it from one pair of runs.
 */
export function personalizedRiegelK(
  storedPersonalK: number | null,
  newlyImpliedK: number
): number {
  const base = storedPersonalK ?? RIEGEL_K;
  const blended = base + (newlyImpliedK - base) * RIEGEL_K_CONVERGENCE_RATE;
  return clamp(blended, RIEGEL_K_MIN, RIEGEL_K_MAX);
}

/** Reference avg HR per sport for the HR-adjustment below — mid-tempo effort at that activity, calibrated against the population baseline (see PERSONALIZATION_POPULATION_* below). */
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

/**
 * Personalized HR calibration: HR_ADJUST_REF_HR above is one fixed bpm number
 * per sport, applied to every athlete alike — unfair to anyone whose resting/
 * max HR differs from the population this was tuned against. These two
 * constants describe that assumed population (a representative adult:
 * resting 60 bpm, Tanaka max HR at age 35), so each sport's fixed reference
 * can be re-expressed as an intensity FRACTION of that population's
 * heart-rate reserve, then remapped onto a specific athlete's own
 * resting/max HR (see `personalizedReferenceHR`). An athlete who hasn't set
 * a resting HR falls back to the exact original fixed-bpm behaviour.
 */
const PERSONALIZATION_POPULATION_RESTING_HR = 60;
const PERSONALIZATION_POPULATION_MAX_HR = 208 - 0.7 * 35; // Tanaka at a representative age 35 = 183.5

/**
 * Re-expresses a sport's fixed HR_ADJUST_REF_HR as a heart-rate-reserve
 * intensity fraction (against the assumed population resting/max), then
 * maps that same relative intensity onto this athlete's own resting/max HR.
 * Two athletes at very different absolute HR now get compared at the same
 * RELATIVE effort instead of the same absolute bpm number.
 */
export function personalizedReferenceHR(
  sport: BenchmarkSport,
  restingHR: number,
  maxHR: number
): number {
  const populationRefHR = HR_ADJUST_REF_HR[sport];
  const populationIntensity = clamp(
    (populationRefHR - PERSONALIZATION_POPULATION_RESTING_HR) /
      (PERSONALIZATION_POPULATION_MAX_HR - PERSONALIZATION_POPULATION_RESTING_HR),
    0,
    1
  );
  return restingHR + populationIntensity * (maxHR - restingHR);
}

/** A faster-predicting session pulls the stored prediction down this fraction of the gap (Part E1). */
export const IMPROVE_RATE = 0.55;
/** Alias for callers still using the old name. */
export const FASTER_PULL_FACTOR = IMPROVE_RATE;

/**
 * A "race"-tagged session run at (or within DIRECT_EVIDENCE_DISTANCE_TOLERANCE
 * of) the sport's benchmark distance itself is direct, non-extrapolated proof
 * of current capability — not a Riegel projection from some other distance
 * that still carries model error. User feedback: running an actual 18:25 5k
 * and having the stored 5k prediction only creep from ~18:42 to 18:33 (the
 * ordinary IMPROVE_RATE=0.55 blend) makes no sense — if you just raced the
 * exact distance, the prediction for that distance IS that time, full stop,
 * not a partially-trusted blend toward it.
 */
export const DIRECT_EVIDENCE_IMPROVE_RATE = 1.0;
export const DIRECT_EVIDENCE_DISTANCE_TOLERANCE = 0.05;

/** True when a session's own distance sits within DIRECT_EVIDENCE_DISTANCE_TOLERANCE of the sport's benchmark distance — i.e. a genuine at-distance time trial rather than a projection from a different distance. */
export function isDirectBenchmarkDistance(
  sessionDistanceMeters: number,
  benchmarkDistanceMeters: number
): boolean {
  if (sessionDistanceMeters <= 0 || benchmarkDistanceMeters <= 0) return false;
  const ratio = sessionDistanceMeters / benchmarkDistanceMeters;
  return Math.abs(ratio - 1) <= DIRECT_EVIDENCE_DISTANCE_TOLERANCE;
}

/** Hard effort that regressed: gentle pull (Part E1). */
export const REGRESS_RATE = 0.15;

/** Session counts as quality if its equivalent is within this fraction of stored prediction (Part E1). */
export const QUALITY_PROXIMITY = 1.1;

/** Legacy export — replaced by REGRESS_RATE + quality gate; kept for reference only. */
export const SLOWER_NUDGE_FACTOR = 0.04;

/**
 * Time-based prediction decay (Part E2). Two separate ceilings (user
 * feedback: "someone who ran a 20:00 5k a year ago is likely not to be
 * able to run a 20:00 5k now, dependent on the exercise they've done
 * since"): total inactivity (no running at all) should be able to erode
 * the prediction considerably more than merely "hasn't tested near-capability
 * lately but still runs easy" — the old single 15% ceiling applied to both,
 * which was too gentle for genuine months-long inactivity (a runner who
 * stops entirely for a year could realistically lose well more than 15% of
 * their 5k fitness). ratePerWeekInactive reaches the new 35% ceiling around
 * 5-6 months of total inactivity, consistent with detraining research
 * showing most of the loss happens well before a year and then plateaus —
 * a full year off lands at the ceiling, not still climbing toward it.
 */
export const PREDICTION_DECAY = {
  graceDays: 14,
  ratePerWeekInactive: 0.015,
  maxDecayInactive: 0.35,
  qualityGraceDays: 60,
  ratePerWeekNoQuality: 0.001,
  maxDecayNoQuality: 0.15,
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

export interface HrPersonalization {
  restingHR?: number | null;
  maxHR?: number | null;
}

/** The reference HR to judge this session's avgHR against: personalized when both resting/max HR are known, else the original fixed population value. */
function resolveReferenceHR(sport: BenchmarkSport, personalization?: HrPersonalization): number {
  const restingHR = personalization?.restingHR;
  const maxHR = personalization?.maxHR;
  if (restingHR && restingHR > 0 && maxHR && maxHR > restingHR) {
    return personalizedReferenceHR(sport, restingHR, maxHR);
  }
  return HR_ADJUST_REF_HR[sport];
}

/**
 * Project a single session to its sport's benchmark distance (or, for
 * walking, its per-km pace) and HR-adjust the result. Returns null when
 * there's no distance/duration to project from. `personalization` (resting/
 * max HR) re-centers the HR adjustment on this athlete's own heart-rate
 * reserve instead of the fixed population reference — omit it (or leave
 * either field unset) for the original, unpersonalized behaviour.
 */
export function computeSessionBenchmarkEquivalentSeconds(
  sport: BenchmarkSport,
  distanceMeters: number,
  durationSeconds: number,
  avgHR?: number | null,
  riegelK: number = RIEGEL_K,
  personalization?: HrPersonalization
): number | null {
  if (distanceMeters <= 0 || durationSeconds <= 0) return null;

  const refHR = resolveReferenceHR(sport, personalization);

  if (sport === "walk") {
    const pacePerKm = durationSeconds / (distanceMeters / 1000);
    return hrAdjustedEquivalentSeconds(pacePerKm, avgHR, refHR);
  }

  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[sport];
  const projected = riegelEquivalentSeconds(durationSeconds, distanceMeters, benchmarkDistance, riegelK);
  return hrAdjustedEquivalentSeconds(projected, avgHR, refHR);
}

/**
 * Project a structured interval/fartlek session to its benchmark distance
 * from its work-piece equivalent pace (rest-ratio converted — see
 * cardio/interval-scoring.ts) instead of the whole-session average pace.
 * Reuses the same Riegel + HR-bonus + personalization pipeline as
 * `computeSessionBenchmarkEquivalentSeconds`, just seeded from the work
 * distance/pace rather than the raw session distance/duration.
 */
export function computeIntervalBenchmarkEquivalentSeconds(
  sport: BenchmarkSport,
  totalWorkDistanceMeters: number,
  equivalentPaceSecPerKm: number,
  workAvgHR?: number | null,
  riegelK: number = RIEGEL_K,
  personalization?: HrPersonalization
): number | null {
  if (totalWorkDistanceMeters <= 0 || equivalentPaceSecPerKm <= 0) return null;
  const equivalentDurationSeconds = equivalentPaceSecPerKm * (totalWorkDistanceMeters / 1000);
  return computeSessionBenchmarkEquivalentSeconds(
    sport,
    totalWorkDistanceMeters,
    equivalentDurationSeconds,
    workAvgHR,
    riegelK,
    personalization
  );
}

/** True when a session's equivalent is close enough to stored capability to count as quality (Part E1). */
export function isQualityEffort(storedSeconds: number, equivSeconds: number): boolean {
  if (storedSeconds <= 0 || equivSeconds <= 0) return false;
  return equivSeconds <= storedSeconds * QUALITY_PROXIMITY;
}

/**
 * Relative-trend evidence for the Tier 2 prediction (user feedback): an
 * easy/recovery/long session whose own HR-adjusted equivalent is nowhere
 * near the stored prediction (far outside QUALITY_PROXIMITY) still isn't
 * NOTHING — if it beat the athlete's own recent easy-effort baseline (the
 * same relative-effort comparison the primary score uses), that's a small,
 * indirect signal of improved fitness, distinct from and much weaker than
 * an outright faster absolute time. Deliberately tiny and bonus-only: this
 * is inferred from an easy run, not demonstrated on a fast one, so it can
 * only ever nudge the prediction a small fraction of a percent — nowhere
 * near IMPROVE_RATE's 55% pull for genuine faster-time evidence.
 */
export interface RelativeEffortTrendContext {
  sessionType?: SessionType | null;
  /** This session's own efficiency factor (speed per heartbeat, terrain/heat-credited) — see terrainAdjustedSessionEF. */
  thisSessionEF?: number | null;
  /** This athlete's personal easy-effort baseline EF — see personalEasyEffortBaselineEF. */
  baselineEF?: number | null;
  /** True when this session's own distance is at (or within DIRECT_EVIDENCE_DISTANCE_TOLERANCE of) the sport's benchmark distance itself, rather than Riegel-projected from a different distance — see isDirectBenchmarkDistance below. */
  isDirectBenchmarkDistance?: boolean;
}

const EASY_TREND_SENSITIVITY = 0.3;
/** Max prediction nudge from relative-trend evidence alone — deliberately far smaller than IMPROVE_RATE/REGRESS_RATE since it's inferred, not demonstrated. */
const EASY_TREND_MAX_IMPROVEMENT_FRACTION = 0.02;

function easyTrendImprovementNudge(storedSec: number, context?: RelativeEffortTrendContext): number {
  if (!context?.sessionType || !RELATIVE_EFFORT_SESSION_TYPES.has(context.sessionType)) return storedSec;
  if (!context.thisSessionEF || !context.baselineEF) return storedSec;
  const efRatio = context.thisSessionEF / context.baselineEF;
  const nudgeFraction = clamp((efRatio - 1) * EASY_TREND_SENSITIVITY, 0, EASY_TREND_MAX_IMPROVEMENT_FRACTION);
  return storedSec * (1 - nudgeFraction);
}

/**
 * Asymmetric memory update (Part E1): easy runs never move prediction slower.
 * `context` (optional) enables the relative-trend nudge above for sessions
 * that don't clear the absolute QUALITY_PROXIMITY gate.
 */
export function updatePrediction(
  storedSec: number,
  equivSec: number,
  context?: RelativeEffortTrendContext
): number {
  if (equivSec < storedSec) {
    const isDirectRaceEvidence = context?.isDirectBenchmarkDistance && context.sessionType === "race";
    const rate = isDirectRaceEvidence ? DIRECT_EVIDENCE_IMPROVE_RATE : IMPROVE_RATE;
    return storedSec + (equivSec - storedSec) * rate;
  }
  if (isQualityEffort(storedSec, equivSec)) {
    return storedSec + (equivSec - storedSec) * REGRESS_RATE;
  }
  return easyTrendImprovementNudge(storedSec, context);
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
  if (daysSinceAnyRun > PREDICTION_DECAY.graceDays) {
    const d =
      PREDICTION_DECAY.ratePerWeekInactive *
      ((daysSinceAnyRun - PREDICTION_DECAY.graceDays) / 7);
    return storedSec * (1 + Math.min(d, PREDICTION_DECAY.maxDecayInactive));
  }
  if (daysSinceQuality > PREDICTION_DECAY.qualityGraceDays) {
    const d =
      PREDICTION_DECAY.ratePerWeekNoQuality *
      ((daysSinceQuality - PREDICTION_DECAY.qualityGraceDays) / 7);
    return storedSec * (1 + Math.min(d, PREDICTION_DECAY.maxDecayNoQuality));
  }
  return storedSec;
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
export function blendPredictedBenchmark(
  previousSeconds: number | null,
  sessionSeconds: number,
  context?: RelativeEffortTrendContext
): number {
  if (previousSeconds == null || !Number.isFinite(previousSeconds)) return sessionSeconds;
  return updatePrediction(previousSeconds, sessionSeconds, context);
}

/** Whether this session should refresh the last-quality timestamp. */
export function sessionCountsAsQuality(
  previousSeconds: number | null,
  sessionSeconds: number
): boolean {
  if (previousSeconds == null) return true;
  return sessionSeconds <= previousSeconds || isQualityEffort(previousSeconds, sessionSeconds);
}

// ---------------------------------------------------------------------------
// Relative-effort scoring for easy/recovery/long sessions (user feedback:
// easy runs should score off HOW EFFICIENT this session was relative to this
// athlete's own typical easy effort, not off absolute pace-vs-benchmark — the
// population HR-adjustment above caps out at 10%, far too small to offset a
// deliberately slow, low-HR pace judged against the same anchor table a race
// effort is judged on). See scoreCardioActivity in cardio-activity.ts for
// where this baseline is actually applied to the score.
// ---------------------------------------------------------------------------

/** Session types scored relative to the athlete's own easy-effort baseline instead of the population pace-vs-benchmark table. */
export const RELATIVE_EFFORT_SESSION_TYPES = new Set<SessionType>(["easy", "recovery", "long"]);

/** Minimum qualifying sessions before a baseline is trusted — below this, callers fall back to standard scoring. */
export const MIN_EASY_BASELINE_SAMPLES = 3;

export interface EasyEffortSession {
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  sessionType?: SessionType | null;
  elevationMeters?: number | null;
  temperatureCelsius?: number | null;
}

// Shared terrain/heat difficulty curves — same formulas cardio-activity.ts's
// executionScore terrain/environment bonus already uses (elevationDifficultyBonus/
// temperatureDifficultyBonus there), factored out here as plain 0-1 fractions
// so relative-effort scoring below can reuse the identical curve for its own,
// much smaller, bonus-only EF credit. cardio-activity.ts imports these and
// multiplies by its own (much larger) MAX_ELEVATION_BONUS/MAX_TEMPERATURE_BONUS
// — executionScore's numbers are unchanged by this refactor.
const REFERENCE_GRADIENT_M_PER_KM = 15; // climb rate treated as "hilly"
const REFERENCE_COMFORT_TEMP_C = 12;
const TEMPERATURE_SENSITIVITY = 100; // divisor on squared deviation from comfort

/** 0-1: how much a session's climb rate (m per km) suggests genuinely hilly terrain. */
export function elevationDifficultyFraction(
  elevationMeters?: number | null,
  distanceMeters?: number | null
): number {
  if (!elevationMeters || elevationMeters <= 0 || !distanceMeters || distanceMeters <= 0) return 0;
  const gradientPerKm = elevationMeters / (distanceMeters / 1000);
  return 1 / (1 + Math.exp(-(gradientPerKm - REFERENCE_GRADIENT_M_PER_KM) / 10));
}

/** 0-1: how much a session's temperature suggests genuinely harsh heat/cold. */
export function temperatureDifficultyFraction(temperatureCelsius?: number | null): number {
  if (temperatureCelsius == null) return 0;
  const deviation = temperatureCelsius - REFERENCE_COMFORT_TEMP_C;
  return 1 - Math.exp(-(deviation * deviation) / TEMPERATURE_SENSITIVITY);
}

/** Max relative-effort EF credit from genuinely hilly terrain — modest and bonus-only, same philosophy as the rest of relative-effort scoring. */
export const RELATIVE_EFFORT_TERRAIN_CREDIT_MAX = 0.05;
/** Max relative-effort EF credit from genuinely harsh heat/cold. */
export const RELATIVE_EFFORT_HEAT_CREDIT_MAX = 0.05;

/**
 * Bonus-only multiplier (always >= 1) crediting a session's efficiency
 * factor for terrain/heat difficulty a pace/HR reading alone can't capture —
 * the same pace and HR on a hilly, hot day is a harder effort than on flat,
 * cool ground. Applied identically when building the personal easy-effort
 * baseline (so both sides of the relative-effort comparison are normalized
 * the same way) and when scoring a session directly (cardio-activity.ts).
 */
export function terrainHeatEffortCreditMultiplier(
  elevationMeters?: number | null,
  distanceMeters?: number | null,
  temperatureCelsius?: number | null
): number {
  const terrainCredit = elevationDifficultyFraction(elevationMeters, distanceMeters) * RELATIVE_EFFORT_TERRAIN_CREDIT_MAX;
  const heatCredit = temperatureDifficultyFraction(temperatureCelsius) * RELATIVE_EFFORT_HEAT_CREDIT_MAX;
  return 1 + terrainCredit + heatCredit;
}

/** Speed (m/min) per heartbeat for one session — same definition as cardio-activity.ts's efficiencyFactor(), duplicated here (rather than imported) to avoid a circular dependency, since cardio-activity.ts already imports from this module. */
function sessionEfficiencyFactor(
  distanceMeters: number,
  durationSeconds: number,
  avgHR: number
): number | null {
  if (distanceMeters <= 0 || durationSeconds <= 0 || avgHR <= 0) return null;
  const speedMetersPerMin = distanceMeters / (durationSeconds / 60);
  return speedMetersPerMin / avgHR;
}

/**
 * This session's own efficiency factor, credited for terrain/heat
 * difficulty — the single per-session EF calculation shared by the personal
 * easy-effort baseline (personalEasyEffortBaselineEF) and callers comparing
 * a fresh session against that baseline (e.g. the Tier 2 relative-trend
 * nudge above).
 */
export function terrainAdjustedSessionEF(
  distanceMeters: number,
  durationSeconds: number,
  avgHR?: number | null,
  elevationMeters?: number | null,
  temperatureCelsius?: number | null
): number | null {
  if (!avgHR) return null;
  const ef = sessionEfficiencyFactor(distanceMeters, durationSeconds, avgHR);
  if (ef === null) return null;
  return ef * terrainHeatEffortCreditMultiplier(elevationMeters, distanceMeters, temperatureCelsius);
}

/** Session types that genuinely measure pace capability — used as the mistag guard's reference pace below, and as the direct-evidence gate for updatePrediction above. */
export const HARD_EFFORT_SESSION_TYPES = new Set<SessionType>(["race", "tempo", "threshold", "interval", "fartlek"]);

/** A session tagged easy/recovery/long whose own pace is within this fraction of (or faster than) the athlete's fastest recent hard-effort pace is treated as a likely mistagged hard effort, not a genuine easy run — both when scoring it directly and when deciding whether it should count toward the easy-effort baseline below. */
export const MISTAG_GUARD_MAX_RATIO = 1.08;

/**
 * Mistag guard reference: the fastest recent race/tempo/threshold/interval/
 * fartlek pace, Riegel-projected to the sport's benchmark distance. Returns
 * null for walk (no Riegel benchmark-distance projection applies) or when no
 * qualifying hard-effort session exists yet.
 */
export function personalRecentHardEffortBenchmarkSeconds(
  sport: BenchmarkSport,
  sessions: EasyEffortSession[],
  riegelK: number = RIEGEL_K
): number | null {
  if (sport === "walk") return null;
  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[sport];
  const projected = sessions
    .filter(
      (s) =>
        !!s.sessionType &&
        HARD_EFFORT_SESSION_TYPES.has(s.sessionType) &&
        s.distanceMeters > 0 &&
        s.durationSeconds > 0
    )
    .map((s) => riegelEquivalentSeconds(s.durationSeconds, s.distanceMeters, benchmarkDistance, riegelK))
    .filter((t) => Number.isFinite(t) && t > 0);
  if (projected.length === 0) return null;
  return Math.min(...projected);
}

/**
 * This athlete's own baseline efficiency factor (speed per heartbeat) from
 * their recent easy/recovery/long same-sport sessions — the reference point
 * a new easy-tagged session is compared against for relative-effort scoring.
 * Sessions that look like mistagged hard efforts (their own pace suspiciously
 * close to the athlete's fastest recent race/tempo/threshold pace — the same
 * MISTAG_GUARD_MAX_RATIO test applied when scoring a session directly) are
 * excluded from the baseline pool: a single fluke hard effort logged under
 * an easy/long tag would otherwise drag the whole baseline up, making it
 * harder for genuinely easy runs to ever earn the bonus they're meant to.
 * Returns null below MIN_EASY_BASELINE_SAMPLES qualifying sessions, signaling
 * the caller to fall back to standard pace-vs-benchmark scoring.
 */
export function personalEasyEffortBaselineEF(
  sport: BenchmarkSport,
  sessions: EasyEffortSession[],
  riegelK: number = RIEGEL_K
): number | null {
  const hardEffortReferenceSeconds = personalRecentHardEffortBenchmarkSeconds(sport, sessions, riegelK);
  const benchmarkDistance = sport === "walk" ? null : BENCHMARK_DISTANCE_METERS[sport];

  const efs = sessions
    .filter((s) => !!s.sessionType && RELATIVE_EFFORT_SESSION_TYPES.has(s.sessionType))
    .filter((s) => {
      if (hardEffortReferenceSeconds == null || benchmarkDistance == null) return true;
      if (s.distanceMeters <= 0 || s.durationSeconds <= 0) return true;
      const projected = riegelEquivalentSeconds(s.durationSeconds, s.distanceMeters, benchmarkDistance, riegelK);
      return projected >= hardEffortReferenceSeconds * MISTAG_GUARD_MAX_RATIO;
    })
    .map((s) =>
      terrainAdjustedSessionEF(s.distanceMeters, s.durationSeconds, s.avgHR, s.elevationMeters, s.temperatureCelsius)
    )
    .filter((ef): ef is number => ef !== null && ef > 0);
  if (efs.length < MIN_EASY_BASELINE_SAMPLES) return null;
  return efs.reduce((a, b) => a + b, 0) / efs.length;
}

/**
 * This athlete's own baseline PACE (Riegel-projected seconds at the sport's
 * benchmark distance) from the same easy/recovery/long same-sport session
 * pool as personalEasyEffortBaselineEF — deliberately HR-independent, unlike
 * the EF baseline, so it can serve as a corroborating signal for the HR-zone
 * below-base guard below (a signal derived from HR can't be used to sanity
 * -check HR itself). Same mistag-guard filtering, same minimum-sample gate.
 */
export function personalEasyEffortBaselinePaceSeconds(
  sport: BenchmarkSport,
  sessions: EasyEffortSession[],
  riegelK: number = RIEGEL_K
): number | null {
  if (sport === "walk") return null;
  const hardEffortReferenceSeconds = personalRecentHardEffortBenchmarkSeconds(sport, sessions, riegelK);
  const benchmarkDistance = BENCHMARK_DISTANCE_METERS[sport];

  const projected = sessions
    .filter((s) => !!s.sessionType && RELATIVE_EFFORT_SESSION_TYPES.has(s.sessionType))
    .filter((s) => s.distanceMeters > 0 && s.durationSeconds > 0)
    .map((s) => riegelEquivalentSeconds(s.durationSeconds, s.distanceMeters, benchmarkDistance, riegelK))
    .filter((t) => {
      if (hardEffortReferenceSeconds == null) return true;
      return t >= hardEffortReferenceSeconds * MISTAG_GUARD_MAX_RATIO;
    });
  if (projected.length < MIN_EASY_BASELINE_SAMPLES) return null;
  return projected.reduce((a, b) => a + b, 0) / projected.length;
}

// ---------------------------------------------------------------------------
// Personalized heart-rate-zone scoring for easy/recovery/long sessions (user
// feedback): rather than judging these sessions purely against a population
// or EF-baseline reference, an athlete who knows their own resting/max HR
// gets a fully personalized zone model. base = maxHR - restingHR is this
// athlete's own aerobic "floor"; each 20% of restingHR above that marks a
// new zone (5 zones span base..maxHR); target sits 30% of restingHR above
// base (the low end of zone 2 — "textbook" easy effort). Landing at target
// already earns a flat credit floor (user feedback: target "means they have
// executed a really good easy run" — it shouldn't score as merely neutral
// pace-based scoring), and the reward still ramps incrementally on top of
// that floor: further below target (down to base) earns progressively
// more; above target, a progressively larger penalty erodes the floor
// (drifting toward max HR on a session tagged "easy" is a sign of
// overexertion or mistagging). Applies to run/row/swim/cycle/ski;
// walking is deliberately excluded (typically done at low, non-zone-driven
// intensity — see computeHrZoneProfile). REPLACES (not stacks with) the
// EF-baseline mechanism above when this athlete has both resting/max HR on
// file — see scoreCardioActivity in cardio-activity.ts for the gating.
// ---------------------------------------------------------------------------

export interface HrZoneProfile {
  /** maxHR - restingHR — this athlete's own aerobic floor. */
  base: number;
  /** base + 30% of restingHR — "textbook" easy effort; at or below this gets the full max credit. */
  target: number;
  /** 20% of restingHR — width of each of the 5 zones spanning base..maxHR. */
  zoneWidth: number;
  restingHR: number;
  maxHR: number;
}

/** Sports the personalized HR-zone model applies to — walking is typically done at low, non-zone-driven intensity (user feedback), so it keeps the population/EF-baseline path instead. */
export const HR_ZONE_SPORTS = new Set<BenchmarkSport>(["run", "row", "swim", "cycle", "ski"]);

export function computeHrZoneProfile(
  restingHR: number | null | undefined,
  maxHR: number | null | undefined
): HrZoneProfile | null {
  if (!restingHR || restingHR <= 0 || !maxHR || maxHR <= restingHR) return null;
  const base = maxHR - restingHR;
  return {
    base,
    target: base + 0.3 * restingHR,
    zoneWidth: 0.2 * restingHR,
    restingHR,
    maxHR,
  };
}

/**
 * Flat credit floor earned simply by landing at or below target (user
 * feedback: "the target heart rate means that they have executed a really
 * good easy run" — a well-executed easy effort at target shouldn't merely
 * read as neutral pace-based scoring; it should score as the genuinely good
 * session it is). Applied before the ramp below, so target isn't the
 * "0% adjustment" point anymore — it's the ramp's own zero, sitting on top
 * of this floor.
 */
export const HR_ZONE_TARGET_CREDIT = 0.11;

/** Ramp amplitude on top of/below HR_ZONE_TARGET_CREDIT — the incremental reward for going easier than target, or the incremental penalty for drifting above it (user-confirmed magnitude). */
export const HR_ZONE_MAX_ADJUSTMENT = 0.10;

/**
 * Below-base guard (user feedback: "I have just rowed what felt like zone
 * 2-3 and it averaged at 156 which would be less than my base value,
 * therefore it needs to be able to account for this potential error"). Any
 * avgHR at/under base reads as "maximum possible ease" by the raw zone math,
 * but HR readings drift day to day and modality to modality (rowing often
 * reads lower than running for the same felt effort) — a boundary-hugging
 * reading shouldn't blindly earn the full bonus reserved for a genuinely
 * ultra-easy effort. This cross-checks the HR signal against an independent
 * one (this session's own pace vs this athlete's HR-independent pace
 * baseline, see personalEasyEffortBaselinePaceSeconds): a real ultra-easy
 * effort should also be slower than normal, not just low-HR. Corroboration
 * ramps 0->1 over PACE_CORROBORATION_MARGIN of slowdown past the baseline
 * pace, floored at MIN_TRUST rather than dropping to zero outright (a HR
 * reading alone is still weak evidence, not proof of error).
 */
const PACE_CORROBORATION_MARGIN = 0.05;
const PACE_CORROBORATION_MIN_TRUST = 0.2;

export function belowBasePaceCorroboration(
  rawProjectedSeconds: number,
  baselinePaceSeconds: number | null | undefined
): number {
  if (!baselinePaceSeconds || baselinePaceSeconds <= 0) return 1; // no baseline yet — trust the HR reading outright
  const slowerFraction = (rawProjectedSeconds - baselinePaceSeconds) / baselinePaceSeconds;
  return clamp(slowerFraction / PACE_CORROBORATION_MARGIN, PACE_CORROBORATION_MIN_TRUST, 1);
}

export interface HrZoneAdjustmentResult {
  /** Signed: positive shrinks the equivalent time (credit), negative grows it (penalty). */
  adjustmentFraction: number;
  zone: "credit" | "neutral" | "penalty";
  belowBaseGuardApplied: boolean;
}

/**
 * HR_ZONE_TARGET_CREDIT is the floor, earned just for landing at or below
 * target; the incremental ramp still applies on top of it in both
 * directions (user feedback: "it should still have the incremental bonus
 * below the target heart rate... below target should score higher and
 * above target should score lower, by +-10%" — the credit/penalty stays
 * relative and graduated across the whole HR range, it's just anchored to a
 * buffed floor instead of plain neutral). Below target, the ramp adds up to
 * HR_ZONE_MAX_ADJUSTMENT more credit by base (further below doesn't add
 * more). Above target, the ramp subtracts up to HR_ZONE_MAX_ADJUSTMENT by
 * maxHR. `paceCorroboration` (0-1, only consulted when avgHR <= base — see
 * belowBasePaceCorroboration) scales back the RAMP's portion (not the
 * target floor itself, which isn't an anomalous reading) when this
 * session's pace doesn't corroborate an at/below-base HR reading. Omit to
 * trust the HR reading outright (e.g. no pace baseline exists yet).
 */
export function hrZoneEffortAdjustment(
  avgHR: number,
  profile: HrZoneProfile,
  paceCorroboration?: number | null
): HrZoneAdjustmentResult {
  const { base, target, maxHR } = profile;
  if (avgHR <= target) {
    const rampFraction = clamp((target - avgHR) / (target - base), 0, 1);
    const belowBase = avgHR <= base;
    const corroboration = belowBase ? (paceCorroboration ?? 1) : 1;
    const adjustmentFraction = HR_ZONE_TARGET_CREDIT + rampFraction * corroboration * HR_ZONE_MAX_ADJUSTMENT;
    return {
      adjustmentFraction,
      zone: "credit",
      belowBaseGuardApplied: belowBase && corroboration < 1,
    };
  }
  const penaltyRampFraction = clamp((avgHR - target) / (maxHR - target), 0, 1);
  const adjustmentFraction = HR_ZONE_TARGET_CREDIT - penaltyRampFraction * HR_ZONE_MAX_ADJUSTMENT;
  return {
    adjustmentFraction,
    zone: adjustmentFraction > 0 ? "credit" : adjustmentFraction < 0 ? "penalty" : "neutral",
    belowBaseGuardApplied: false,
  };
}
