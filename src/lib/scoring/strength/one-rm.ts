/**
 * Sub-maximal 1RM estimators for strength scoring.
 * Epley (1985) primary; Brzycki (1993) secondary — best-of for conservative peak estimate.
 * Exercise-class-specific Epley k values (Part D) and weighted-calisthenics blend (Part B1).
 */

/** Epley k by exercise class — lower k ⇒ higher implied 1RM at the same reps. */
export const EPLEY_K = {
  compound: 30,
  accessory: 22,
  isolation: 15,
} as const;

export type ExerciseClass = keyof typeof EPLEY_K;

/** Cap isolation multiplier — without it, high-rep sets imply implausible 1RMs. */
export const ISOLATION_MULT_CAP = 1.8;

/**
 * Weighted calisthenics 1RM blend: 0 = added-only (too low), 1 = total-load (too high).
 * Applies to weighted pull-ups, chin-ups, dips, muscle-ups.
 */
export const CALISTHENIC_BLEND = 0.5;

/** Flag when stated 1RM differs from formula estimate by more than this fraction (Part B4). */
export const ONE_RM_VARIANCE_THRESHOLD = 0.4;

export type RepsInReserve = number | null | undefined;

/** Blank RIR = assume near failure (Part B3). */
export function effectiveReps(reps: number, repsInReserve?: RepsInReserve): number {
  return reps + (repsInReserve ?? 0);
}

function epleyMultiplier(reps: number, exerciseClass: ExerciseClass = "compound"): number {
  const k = EPLEY_K[exerciseClass];
  if (exerciseClass === "isolation") {
    return Math.min(1 + reps / k, ISOLATION_MULT_CAP);
  }
  return 1 + reps / k;
}

/** Epley: 1RM ≈ weight × (1 + reps/k). Best for 1–10 reps on compounds. */
export function epley1RM(
  weightKg: number,
  reps: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): number {
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 0 || weightKg <= 0) return 0;
  if (effective === 1) return weightKg;
  return weightKg * epleyMultiplier(effective, exerciseClass);
}

/** Brzycki: 1RM ≈ weight × 36 / (37 − reps). Best for 2–10 reps. */
export function brzycki1RM(
  weightKg: number,
  reps: number,
  repsInReserve?: RepsInReserve
): number {
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 0 || weightKg <= 0) return 0;
  if (effective === 1) return weightKg;
  if (effective >= 37) return weightKg;
  return (weightKg * 36) / (37 - effective);
}

function blendedRepFormula(
  weightKg: number,
  reps: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): number {
  const epley = epley1RM(weightKg, reps, exerciseClass, repsInReserve);
  const brzycki = brzycki1RM(weightKg, reps, repsInReserve);
  return Math.max(epley, brzycki);
}

/**
 * Weighted calisthenics 1RM in ADDED-weight terms (Part B1).
 * Blends total-load and added-only estimates.
 */
export function weightedCalisthenic1RM(
  addedKg: number,
  reps: number,
  bodyweightKg: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): number {
  if (reps <= 1 && (repsInReserve ?? 0) === 0) return addedKg;
  const effective = effectiveReps(reps, repsInReserve);
  if (effective <= 1) return addedKg;
  const totalLoad1RM =
    blendedRepFormula(bodyweightKg + addedKg, reps, exerciseClass, repsInReserve) - bodyweightKg;
  const addedOnly1RM = blendedRepFormula(addedKg, reps, exerciseClass, repsInReserve);
  return CALISTHENIC_BLEND * totalLoad1RM + (1 - CALISTHENIC_BLEND) * addedOnly1RM;
}

/**
 * Conservative best estimate from sub-max sets (max of Epley & Brzycki).
 * Brzycki capped at 15 reps to avoid singularity blow-ups on high-rep sets.
 */
export function bestEstimate1RM(
  weightKg: number,
  reps: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): number {
  const effective = effectiveReps(reps, repsInReserve);
  const epley = epley1RM(weightKg, reps, exerciseClass, repsInReserve);
  const brzycki = brzycki1RM(weightKg, Math.min(effective, 15), repsInReserve);
  return Math.max(epley, brzycki);
}

/** Best 1RM across multiple sets of the same lift. */
export function bestSet1RM(
  sets: Array<{ weightKg: number; reps: number; repsInReserve?: RepsInReserve }>,
  exerciseClass: ExerciseClass = "compound"
): number {
  let best = 0;
  for (const s of sets) {
    best = Math.max(
      best,
      bestEstimate1RM(s.weightKg, s.reps, exerciseClass, s.repsInReserve)
    );
  }
  return best;
}

/** Data-quality guard: flag when stated 1RM diverges from set-derived estimate (Part B4). */
export function oneRMVarianceFlag(
  setWeightKg: number,
  reps: number,
  statedOneRMKg: number,
  exerciseClass: ExerciseClass = "compound",
  repsInReserve?: RepsInReserve
): boolean {
  if (setWeightKg <= 0 || reps <= 0 || statedOneRMKg <= 0) return false;
  const estimated = bestEstimate1RM(setWeightKg, reps, exerciseClass, repsInReserve);
  if (estimated <= 0) return false;
  return Math.abs(statedOneRMKg - estimated) / estimated > ONE_RM_VARIANCE_THRESHOLD;
}
