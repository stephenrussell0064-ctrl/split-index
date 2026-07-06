import {
  DOTS_BODYWEIGHT_BOUNDS,
  getDOTSCoefficients,
  type StrengthSex,
} from "./coefficients";

function dotsDenominator(
  bodyweightKg: number,
  sex: StrengthSex
): number {
  const { min, max } = DOTS_BODYWEIGHT_BOUNDS[sex];
  const bw = Math.min(max, Math.max(min, bodyweightKg));
  const { a, b, c, d, e } = getDOTSCoefficients(sex);
  return (
    a * bw ** 4 + b * bw ** 3 + c * bw ** 2 + d * bw + e
  );
}

/**
 * DOTS score for an SBD total (kg).
 * Formula: Total × 500 / (a·BW⁴ + b·BW³ + c·BW² + d·BW + e)
 */
export function calculateDOTS(
  totalKg: number,
  bodyweightKg: number,
  sex: StrengthSex
): number {
  if (totalKg <= 0 || bodyweightKg <= 0) return 0;
  const denom = dotsDenominator(bodyweightKg, sex);
  if (denom <= 0) return 0;
  return (totalKg * 500) / denom;
}
