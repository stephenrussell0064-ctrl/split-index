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

/**
 * Conservative best estimate from sub-max sets (max of Epley & Brzycki).
 * Brzycki's denominator (37 − reps) approaches zero as reps approaches 37,
 * blowing the estimate up to unbounded multiples of the working weight —
 * it's only valid in the ~1–15 rep range documented above. High-rep sets
 * (30+ push-ups, high-rep accessory burnout sets) are common enough that
 * Brzycki's rep input is capped at 15 rather than left to spike or dropped
 * outright — an outright drop would make the max() flip from Brzycki's
 * (higher) 15-rep estimate to Epley's (lower) 16-rep estimate, a score dip
 * for doing one more rep. Capping instead holds Brzycki at a flat plateau
 * past 15 reps, so Epley (linear, no singularity) smoothly overtakes it as
 * reps keep climbing, with no discontinuity either way.
 */
export function bestEstimate1RM(weightKg: number, reps: number): number {
  const epley = epley1RM(weightKg, reps);
  const brzycki = brzycki1RM(weightKg, Math.min(reps, 15));
  return Math.max(epley, brzycki);
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
