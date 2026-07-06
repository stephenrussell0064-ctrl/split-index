/**
 * Sub-maximal 1RM estimators for strength scoring.
 * Epley (1985) primary; Brzycki (1993) secondary — best-of for conservative peak estimate.
 */

/** Epley: 1RM ≈ weight × (1 + reps/30). Best for 1–10 reps. */
export function epley1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

/** Brzycki: 1RM ≈ weight × 36 / (37 − reps). Best for 2–10 reps. */
export function brzycki1RM(weightKg: number, reps: number): number {
  if (reps <= 0 || weightKg <= 0) return 0;
  if (reps === 1) return weightKg;
  if (reps >= 37) return weightKg;
  return (weightKg * 36) / (37 - reps);
}

/** Conservative best estimate from sub-max sets (max of Epley & Brzycki). */
export function bestEstimate1RM(weightKg: number, reps: number): number {
  return Math.max(epley1RM(weightKg, reps), brzycki1RM(weightKg, reps));
}

/** Best 1RM across multiple sets of the same lift. */
export function bestSet1RM(
  sets: Array<{ weightKg: number; reps: number }>
): number {
  let best = 0;
  for (const s of sets) {
    best = Math.max(best, bestEstimate1RM(s.weightKg, s.reps));
  }
  return best;
}
