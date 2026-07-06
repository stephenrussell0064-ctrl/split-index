/**
 * Split Index Scoring Engine
 *
 * Scientifically grounded performance indexing for hybrid athletes.
 * Each sport produces a 0–999 index; Split Index = 50% endurance + 50% strength.
 *
 * Mathematical foundations (see inline comments for each):
 * - Exponential pace index vs gender/experience reference (not linear ratios)
 * - Riegel (1977) distance equivalence: T₂ = T₁ × (D₂/D₁)^1.06
 * - Grade Adjusted Pace (GAP): Minetti-style ~6% pace cost per 1% grade
 * - Karvonen heart-rate reserve for aerobic efficiency
 * - Banister (1991) impulse–response: chronic load → fitness bonus
 * - ACWR acute:chronic workload ratio for fatigue penalty
 * - El Helou et al. heat penalty beyond 15°C optimal
 * - Epley (1985) 1RM estimation for strength
 */

import type {
  EnduranceSport,
  ExperienceLevel,
  Gender,
  GymExercise,
  Profile,
  ScoreBreakdown,
  SessionType,
  SportType,
} from "@/types";
import {
  ACCESSORY_LIFT_WEIGHT,
  ACWR_DANGER,
  ACWR_OPTIMAL_HIGH,
  ACWR_OPTIMAL_LOW,
  COMPOUND_LIFT_MAP,
  COMPOUND_LIFT_WEIGHT,
  DEFAULT_RESTING_HR,
  DEFAULT_STRENGTH_RATIO,
  ENDURANCE_SPORTS,
  ERG_SPLIT_METERS,
  INDEX_ANCHOR,
  MAX_INDEX,
  MIN_INDEX,
  PACE_EXP_SENSITIVITY,
  REFERENCE_BODYWEIGHT_KG,
  REFERENCE_PACE_5K,
  REFERENCE_WATTS_PER_KG,
  RIEGEL_EXPONENT,
  SESSION_TYPE_MODIFIERS,
  SPORT_REFERENCE_PACE,
  STRENGTH_EXP_SENSITIVITY,
  STRENGTH_REFERENCE_RATIOS,
  SWIM_PACE_UNIT_METERS,
} from "@/lib/scoring/constants";

export {
  ENDURANCE_SPORTS,
  MAX_INDEX,
  MIN_INDEX,
} from "@/lib/scoring/constants";

// ─── Utilities ───────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resolveGender(gender: Gender | null): Gender {
  if (gender === "male" || gender === "female") return gender;
  return "other";
}

function resolveExperience(experience: ExperienceLevel | null): ExperienceLevel {
  return experience ?? "intermediate";
}

/**
 * Map relative performance to 0–999 via exponential curve.
 * At delta=0 (actual equals reference) → INDEX_ANCHOR (500).
 * Positive delta (better than reference) → index rises exponentially.
 */
export function exponentialPerformanceIndex(
  actual: number,
  reference: number,
  sensitivity: number,
  higherIsBetter: boolean
): number {
  if (actual <= 0 || reference <= 0) return INDEX_ANCHOR;
  const relativeDelta = higherIsBetter
    ? (actual - reference) / reference
    : (reference - actual) / reference;
  const raw = INDEX_ANCHOR * Math.exp(sensitivity * relativeDelta);
  return clamp(Math.round(raw), MIN_INDEX, MAX_INDEX);
}

// ─── Epley 1RM ───────────────────────────────────────────────────────────────

/**
 * Epley formula (1985): 1RM ≈ weight × (1 + reps/30)
 * Validated for submaximal sets in the 1–10 rep range.
 */
export function estimate1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

// ─── Karvonen HRR ────────────────────────────────────────────────────────────

/**
 * Karvonen heart-rate reserve (HRR):
 *   HRR% = (HR_avg − HR_rest) / (HR_max − HR_rest)
 * Lower HRR at a given pace indicates superior aerobic efficiency.
 */
export function heartRateReservePercent(
  avgHR: number,
  restingHR: number,
  maxHR: number
): number {
  const reserve = maxHR - restingHR;
  if (reserve <= 0) return 0.5;
  return clamp((avgHR - restingHR) / reserve, 0, 1);
}

/**
 * HR efficiency multiplier: compares observed HRR to expected HRR for session intensity.
 * Expected HRR scales with pace index relative to reference.
 */
export function karvonenEfficiencyMultiplier(
  avgHR: number,
  maxHR: number,
  paceIndex: number,
  restingHR = DEFAULT_RESTING_HR
): number {
  const hrr = heartRateReservePercent(avgHR, restingHR, maxHR);
  const intensityFraction = clamp(paceIndex / MAX_INDEX, 0.35, 1.0);
  const expectedHRR = 0.35 + intensityFraction * 0.55;
  const efficiencyDelta = expectedHRR - hrr;
  return clamp(1 + efficiencyDelta * 0.35, 0.88, 1.12);
}

// ─── ACWR & Banister ─────────────────────────────────────────────────────────

/**
 * Acute:Chronic Workload Ratio (ACWR):
 *   ACWR = acute_7d_load / chronic_28d_weekly_avg
 * Optimal zone 0.8–1.3; >1.5 elevates injury/fatigue risk (Gabbett 2016).
 */
export function calculateACWR(acuteLoad: number, chronicLoad: number): number {
  if (chronicLoad <= 0) return 1.0;
  return acuteLoad / chronicLoad;
}

/** Fatigue penalty from ACWR — multiplicative score reduction when overreaching */
export function acwrFatigueMultiplier(acwr: number): number {
  if (acwr <= ACWR_OPTIMAL_LOW) return 0.96;
  if (acwr <= ACWR_OPTIMAL_HIGH) return 1.0;
  if (acwr <= ACWR_DANGER) return 0.92;
  if (acwr <= 1.8) return 0.85;
  return 0.75;
}

/**
 * Banister fitness impulse–response model (1991):
 * Chronic exponentially-weighted training load approximates "fitness" (τ ≈ 42 d).
 * Higher chronic fitness raises performance potential on subsequent sessions.
 */
export function banisterFitnessMultiplier(
  chronicLoad: number,
  trainingHistoryYears: number
): number {
  const normalizedFitness = chronicLoad / 400;
  const fitnessBonus = 0.1 * Math.tanh(normalizedFitness - 0.5);
  const historyBonus = 0.015 * Math.min(trainingHistoryYears, 12);
  return clamp(1 + fitnessBonus + historyBonus, 0.94, 1.14);
}

/**
 * Banister fatigue component (τ ≈ 7 d) — acute load elevates short-term fatigue.
 * Applied as a secondary dampener alongside ACWR.
 */
export function banisterFatigueMultiplier(acuteLoad: number): number {
  const fatigue = 0.08 * Math.tanh(acuteLoad / 300);
  return clamp(1 - fatigue, 0.88, 1.0);
}

// ─── Environment & terrain ─────────────────────────────────────────────────

/**
 * Heat adjustment (El Helou et al., 2012):
 * Optimal marathon conditions ~10–15°C; ~2–3% performance loss per 5°C above optimal.
 * We apply a multiplicative factor: hot weather observed pace is "discounted" upward.
 */
export function temperatureFactor(celsius: number | null): number {
  if (celsius === null) return 1.0;
  const optimal = 15;
  const delta = Math.abs(celsius - optimal);
  if (delta <= 5) return 1.0;
  const penaltyPerDegree = 0.012;
  const penalty = (delta - 5) * penaltyPerDegree;
  return clamp(1 - penalty, 0.82, 1.04);
}

/**
 * Grade Adjusted Pace (GAP) — simplified Minetti cost model:
 * ~6% pace slowdown per 1% average gradient on climbs.
 * Converts uphill pace to flat-equivalent: faster GAP = better climbing economy.
 *
 *   grade% = (elevation_gain / distance) × 100
 *   GAP_pace = raw_pace / (1 + 0.006 × grade%)
 */
export function gapAdjustedPace(
  paceSecPerKm: number,
  elevationM: number | null,
  distanceM: number | null
): { gapPace: number; gapFactor: number } {
  if (!elevationM || !distanceM || distanceM <= 0 || elevationM <= 0) {
    return { gapPace: paceSecPerKm, gapFactor: 1.0 };
  }
  const gradePercent = (elevationM / distanceM) * 100;
  const gapFactor = 1 + 0.006 * gradePercent;
  const gapPace = paceSecPerKm / gapFactor;
  return { gapPace, gapFactor };
}

// ─── Riegel distance ─────────────────────────────────────────────────────────

/**
 * Riegel (1977) endurance equivalence:
 *   T₂ = T₁ × (D₂/D₁)^1.06
 * Converts any distance performance to an equivalent 5 km time for fair comparison.
 */
export function riegelEquivalent5kPace(
  distanceM: number,
  durationSeconds: number
): number {
  if (distanceM <= 0 || durationSeconds <= 0) return 0;
  const refDistanceM = 5000;
  const equivDuration =
    durationSeconds * Math.pow(refDistanceM / distanceM, RIEGEL_EXPONENT);
  return equivDuration / (refDistanceM / 1000);
}

/**
 * Distance credibility factor from Riegel-normalised performance.
 * Very short efforts (<1 km) are less indicative; ultra-long has diminishing signal.
 */
export function riegelDistanceFactor(
  distanceM: number,
  sport: EnduranceSport
): number {
  const km = distanceM / 1000;
  const minKm = sport === "swimming" ? 0.4 : 1.0;
  const maxKm = sport === "walking" ? 30 : 42;
  if (km < minKm) return clamp(0.75 + (km / minKm) * 0.15, 0.75, 0.9);
  if (km > maxKm) return clamp(1.05 - ((km - maxKm) / maxKm) * 0.1, 0.92, 1.05);
  return clamp(0.9 + Math.log1p(km / 5) * 0.08, 0.9, 1.08);
}

// ─── Pace derivation ─────────────────────────────────────────────────────────

export function referencePaceForSport(
  sport: EnduranceSport,
  gender: Gender | null,
  experience: ExperienceLevel | null
): number {
  if (sport === "running") {
    const g = resolveGender(gender);
    const e = resolveExperience(experience);
    return REFERENCE_PACE_5K[g][e];
  }
  return SPORT_REFERENCE_PACE[sport];
}

export function derivePaceSecPerKm(
  sport: EnduranceSport,
  durationSeconds: number,
  distanceMeters: number | null,
  avgPaceSecondsPerKm: number | null,
  avgSplitSeconds: number | null
): number {
  if (avgPaceSecondsPerKm && avgPaceSecondsPerKm > 0) {
    return avgPaceSecondsPerKm;
  }

  if (distanceMeters && distanceMeters > 0 && durationSeconds > 0) {
    if (sport === "swimming") {
      const secPer100m =
        durationSeconds / (distanceMeters / SWIM_PACE_UNIT_METERS);
      return secPer100m * 10;
    }
    return durationSeconds / (distanceMeters / 1000);
  }

  if (avgSplitSeconds && avgSplitSeconds > 0) {
    return avgSplitSeconds * (1000 / ERG_SPLIT_METERS);
  }

  return SPORT_REFERENCE_PACE[sport];
}

/** Minor bodyweight economy adjustment for running (lighter → slight advantage on flat) */
export function bodyweightEnduranceFactor(weightKg: number | null): number {
  if (!weightKg || weightKg <= 0) return 1.0;
  return clamp(Math.pow(REFERENCE_BODYWEIGHT_KG / weightKg, 0.12), 0.94, 1.06);
}

/** Training history years — long-term adaptation bonus (caps at 12 yr) */
export function trainingHistoryFactor(years: number | null): number {
  const y = years ?? 0;
  return clamp(1 + 0.012 * Math.min(y, 12), 1.0, 1.14);
}

// ─── Endurance scoring ─────────────────────────────────────────────────────────

export interface EnduranceScoreInput {
  sport: EnduranceSport;
  durationSeconds: number;
  distanceMeters: number | null;
  elevationMeters: number | null;
  avgHeartRate: number | null;
  avgPowerWatts: number | null;
  avgPaceSecondsPerKm: number | null;
  avgSplitSeconds: number | null;
  temperatureCelsius: number | null;
  sessionType: SessionType | null;
  profile: Pick<
    Profile,
    "max_hr" | "weight_kg" | "experience" | "gender" | "training_history_years"
  >;
  acuteLoad: number;
  chronicLoad: number;
}

export function calculateEnduranceIndex(
  input: EnduranceScoreInput
): { index: number; breakdown: ScoreBreakdown; loadScore: number } {
  const explanation: string[] = [];
  const gender = resolveGender(input.profile.gender);
  const experience = resolveExperience(input.profile.experience);
  const refPace = referencePaceForSport(input.sport, gender, experience);

  const rawPace = derivePaceSecPerKm(
    input.sport,
    input.durationSeconds,
    input.distanceMeters,
    input.avgPaceSecondsPerKm,
    input.avgSplitSeconds
  );

  const { gapPace, gapFactor } = gapAdjustedPace(
    rawPace,
    input.elevationMeters,
    input.distanceMeters
  );
  if (gapFactor > 1.001 && input.elevationMeters) {
    explanation.push(
      `GAP adjustment ×${gapFactor.toFixed(3)} (${input.elevationMeters}m gain → flat-equiv ${(gapPace / 60).toFixed(2)} min/km)`
    );
  }

  let scoringPace = gapPace;
  if (input.distanceMeters && input.distanceMeters > 0) {
    const riegel5k = riegelEquivalent5kPace(
      input.distanceMeters,
      input.durationSeconds
    );
    scoringPace = riegel5k > 0 ? riegel5k : gapPace;
    explanation.push(
      `Riegel 5k-equivalent pace ${(scoringPace / 60).toFixed(2)} min/km (D=${(input.distanceMeters / 1000).toFixed(1)} km, k=${RIEGEL_EXPONENT})`
    );
  }

  const paceIndex = exponentialPerformanceIndex(
    scoringPace,
    refPace,
    PACE_EXP_SENSITIVITY,
    false
  );
  explanation.push(
    `Exponential pace index ${paceIndex} (ref ${(refPace / 60).toFixed(2)} min/km vs actual ${(scoringPace / 60).toFixed(2)} min/km)`
  );

  const distM = input.distanceMeters ?? 0;
  const dFactor =
    distM > 0 ? riegelDistanceFactor(distM, input.sport) : 0.82;
  explanation.push(
    `Riegel distance factor ${dFactor.toFixed(3)} (${(distM / 1000).toFixed(1)} km)`
  );

  let hrEfficiency = 1.0;
  if (input.avgHeartRate && input.profile.max_hr) {
    hrEfficiency = karvonenEfficiencyMultiplier(
      input.avgHeartRate,
      input.profile.max_hr,
      paceIndex
    );
    const hrr = heartRateReservePercent(
      input.avgHeartRate,
      DEFAULT_RESTING_HR,
      input.profile.max_hr
    );
    explanation.push(
      `Karvonen HR efficiency ×${hrEfficiency.toFixed(3)} (${Math.round(hrr * 100)}% HRR vs max ${input.profile.max_hr})`
    );
  }

  let powerFactor = 1.0;
  if (input.avgPowerWatts && input.profile.weight_kg) {
    const wkg = input.avgPowerWatts / input.profile.weight_kg;
    const powerIndex = exponentialPerformanceIndex(
      wkg,
      REFERENCE_WATTS_PER_KG,
      2.0,
      true
    );
    powerFactor = powerIndex / INDEX_ANCHOR;
    explanation.push(
      `Power index ${powerIndex} (${wkg.toFixed(1)} W/kg vs ref ${REFERENCE_WATTS_PER_KG})`
    );
  }

  const tempFactor = temperatureFactor(input.temperatureCelsius);
  if (input.temperatureCelsius !== null) {
    explanation.push(
      `Heat factor ×${tempFactor.toFixed(3)} (${input.temperatureCelsius}°C, optimal ~15°C)`
    );
  }

  const acwr = calculateACWR(input.acuteLoad, input.chronicLoad);
  const acwrMult = acwrFatigueMultiplier(acwr);
  explanation.push(
    `ACWR fatigue ×${acwrMult.toFixed(3)} (ratio ${acwr.toFixed(2)})`
  );

  const fitnessMult = banisterFitnessMultiplier(
    input.chronicLoad,
    input.profile.training_history_years ?? 0
  );
  explanation.push(
    `Banister fitness ×${fitnessMult.toFixed(3)} (chronic load ${Math.round(input.chronicLoad)})`
  );

  const banisterFatMult = banisterFatigueMultiplier(input.acuteLoad);
  explanation.push(
    `Banister fatigue ×${banisterFatMult.toFixed(3)} (acute load ${Math.round(input.acuteLoad)})`
  );

  const bwFactor = bodyweightEnduranceFactor(input.profile.weight_kg);
  if (input.profile.weight_kg) {
    explanation.push(
      `Bodyweight factor ×${bwFactor.toFixed(3)} (${input.profile.weight_kg} kg)`
    );
  }

  const historyFactor = trainingHistoryFactor(
    input.profile.training_history_years
  );
  explanation.push(
    `Training history ×${historyFactor.toFixed(3)} (${input.profile.training_history_years ?? 0} yr)`
  );

  const sessionMod = SESSION_TYPE_MODIFIERS[input.sessionType ?? "other"];

  const composite =
    paceIndex *
    dFactor *
    hrEfficiency *
    powerFactor *
    tempFactor *
    acwrMult *
    fitnessMult *
    banisterFatMult *
    bwFactor *
    historyFactor;

  const index = clamp(Math.round(composite), MIN_INDEX, MAX_INDEX);
  explanation.push(
    `Session load modifier ${sessionMod.toFixed(2)} (${input.sessionType ?? "other"})`
  );

  const maxHR = input.profile.max_hr ?? 190;
  const hrrForLoad =
    input.avgHeartRate && input.profile.max_hr
      ? heartRateReservePercent(
          input.avgHeartRate,
          DEFAULT_RESTING_HR,
          maxHR
        )
      : 0.65;

  const loadScore =
    (input.durationSeconds / 60) *
    sessionMod *
    hrrForLoad *
    (index / INDEX_ANCHOR);

  return {
    index,
    loadScore: Math.round(loadScore * 10) / 10,
    breakdown: {
      base_score: paceIndex,
      pace_factor: paceIndex / INDEX_ANCHOR,
      distance_factor: dFactor,
      elevation_factor: gapFactor,
      hr_efficiency: hrEfficiency,
      temperature_factor: tempFactor,
      fatigue_multiplier: acwrMult * banisterFatMult,
      session_type_modifier: sessionMod,
      duration_factor: historyFactor,
      final_sport_index: index,
      explanation,
    },
  };
}

// ─── Strength scoring ──────────────────────────────────────────────────────────

export interface StrengthScoreInput {
  exercises: Pick<
    GymExercise,
    "exercise_name" | "muscle_group" | "weight_kg" | "sets" | "reps" | "rpe"
  >[];
  bodyweightKg: number;
  gender: Gender | null;
  experience: Profile["experience"];
  acuteLoad: number;
  chronicLoad: number;
  trainingHistoryYears: number | null;
}

function lookupStrengthReference(
  exerciseName: string,
  gender: Gender,
  experience: ExperienceLevel
): number {
  const key = COMPOUND_LIFT_MAP[exerciseName.toLowerCase().trim()];
  if (!key || !STRENGTH_REFERENCE_RATIOS[key]) return DEFAULT_STRENGTH_RATIO;
  return STRENGTH_REFERENCE_RATIOS[key][gender][experience];
}

export function calculateStrengthIndex(
  input: StrengthScoreInput
): {
  index: number;
  breakdown: ScoreBreakdown;
  loadScore: number;
  exerciseScores: Array<{
    name: string;
    muscleGroup: string;
    estimated1RM: number;
    relativeStrength: number;
  }>;
} {
  const explanation: string[] = [];
  const gender = resolveGender(input.gender);
  const experience = resolveExperience(input.experience);

  if (input.exercises.length === 0) {
    return {
      index: MIN_INDEX,
      loadScore: 0,
      exerciseScores: [],
      breakdown: {
        base_score: 0,
        final_sport_index: MIN_INDEX,
        explanation: ["No exercises logged"],
      },
    };
  }

  let weightedIndexSum = 0;
  let weightSum = 0;
  let totalVolume = 0;
  let rpeAdjustmentSum = 0;

  const exerciseScores = input.exercises.map((ex) => {
    const rpe = ex.rpe ?? 7;
    const rpeAdj = 1 + (rpe - 7) * 0.04;
    rpeAdjustmentSum += rpeAdj;

    const effectiveReps = ex.reps * rpeAdj;
    const e1RM = estimate1RM(ex.weight_kg, effectiveReps);
    const relativeStrength = e1RM / input.bodyweightKg;
    const refRatio = lookupStrengthReference(
      ex.exercise_name,
      gender,
      experience
    );

    const exIndex = exponentialPerformanceIndex(
      relativeStrength,
      refRatio,
      STRENGTH_EXP_SENSITIVITY,
      true
    );

    const liftKey = COMPOUND_LIFT_MAP[ex.exercise_name.toLowerCase().trim()];
    const liftWeight = liftKey ? COMPOUND_LIFT_WEIGHT : ACCESSORY_LIFT_WEIGHT;

    weightedIndexSum += exIndex * liftWeight;
    weightSum += liftWeight;

    totalVolume += ex.sets * ex.reps * ex.weight_kg * rpeAdj;

    explanation.push(
      `${ex.exercise_name}: Epley 1RM ${e1RM.toFixed(1)} kg (${relativeStrength.toFixed(2)}× BW vs ref ${refRatio}×) → index ${exIndex}, RPE ${rpe}`
    );

    return {
      name: ex.exercise_name,
      muscleGroup: ex.muscle_group,
      estimated1RM: Math.round(e1RM * 10) / 10,
      relativeStrength: Math.round(relativeStrength * 100) / 100,
    };
  });

  const avgExerciseIndex =
    weightSum > 0 ? weightedIndexSum / weightSum : INDEX_ANCHOR;
  explanation.push(`Weighted exercise index ${Math.round(avgExerciseIndex)}`);

  const volumeFactor = clamp(
    0.88 + Math.log1p(totalVolume / 4000) * 0.12,
    0.85,
    1.12
  );
  explanation.push(
    `Volume factor ×${volumeFactor.toFixed(3)} (${Math.round(totalVolume)} kg·reps)`
  );

  const avgRpeAdj = rpeAdjustmentSum / input.exercises.length;
  explanation.push(`RPE adjustment ×${avgRpeAdj.toFixed(3)} (7 = baseline)`);

  const acwr = calculateACWR(input.acuteLoad, input.chronicLoad);
  const acwrMult = acwrFatigueMultiplier(acwr);
  explanation.push(
    `ACWR fatigue ×${acwrMult.toFixed(3)} (ratio ${acwr.toFixed(2)})`
  );

  const fitnessMult = banisterFitnessMultiplier(
    input.chronicLoad,
    input.trainingHistoryYears ?? 0
  );
  explanation.push(`Banister fitness ×${fitnessMult.toFixed(3)}`);

  const composite =
    avgExerciseIndex * volumeFactor * avgRpeAdj * acwrMult * fitnessMult;

  const index = clamp(Math.round(composite), MIN_INDEX, MAX_INDEX);

  const loadScore = Math.round((totalVolume / 800) * 10) / 10;

  return {
    index,
    loadScore,
    exerciseScores,
    breakdown: {
      base_score: Math.round(avgExerciseIndex),
      relative_strength: avgExerciseIndex / INDEX_ANCHOR,
      volume_load: totalVolume,
      rpe_adjustment: avgRpeAdj,
      fatigue_multiplier: acwrMult,
      final_sport_index: index,
      explanation,
    },
  };
}

// ─── Split index composite ───────────────────────────────────────────────────

export function calculateSplitIndex(
  enduranceIndex: number,
  strengthIndex: number
): number {
  return clamp(
    Math.round(0.5 * enduranceIndex + 0.5 * strengthIndex),
    MIN_INDEX,
    MAX_INDEX
  );
}

export function calculateRecoveryScore(
  fatigueScore: number,
  acwr: number,
  daysSinceLastHardSession: number
): number {
  const fatigueComponent = clamp(100 - fatigueScore, 0, 100);
  const acwrComponent =
    acwr <= ACWR_OPTIMAL_HIGH
      ? 100
      : clamp(100 - (acwr - ACWR_OPTIMAL_HIGH) * 100, 30, 100);
  const restComponent = clamp(daysSinceLastHardSession * 15, 0, 100);

  return Math.round(
    fatigueComponent * 0.4 + acwrComponent * 0.35 + restComponent * 0.25
  );
}

export function calculateFatigueScore(acwr: number, recentLoad: number): number {
  const acwrFatigue = clamp((acwr - ACWR_OPTIMAL_LOW) * 50, 0, 60);
  const loadFatigue = clamp(recentLoad / 10, 0, 40);
  return clamp(Math.round(acwrFatigue + loadFatigue), 0, 100);
}

export function predictIndex(history: number[], daysAhead = 7): number {
  if (history.length < 2) return history[0] ?? INDEX_ANCHOR;

  const n = history.length;
  let sumX = 0,
    sumY = 0,
    sumXY = 0,
    sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += history[i];
    sumXY += i * history[i];
    sumX2 += i * i;
  }
  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return history[n - 1];
  const slope = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  return clamp(
    Math.round(intercept + slope * (n - 1 + daysAhead)),
    MIN_INDEX,
    MAX_INDEX
  );
}

export function isEnduranceSport(sport: SportType): sport is EnduranceSport {
  return ENDURANCE_SPORTS.includes(sport as EnduranceSport);
}

/** Recency-weighted blend: newest session weight=1, each prior decays exponentially */
export function recencyWeightedBlend(
  newValue: number,
  history: number[],
  decay = 0.82
): number {
  if (history.length === 0) return newValue;
  const weights = [1, ...history.map((_, i) => Math.pow(decay, i + 1))];
  const values = [newValue, ...history];
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  const blended =
    values.reduce((sum, v, i) => sum + v * weights[i], 0) / totalWeight;
  return clamp(Math.round(blended), MIN_INDEX, MAX_INDEX);
}
