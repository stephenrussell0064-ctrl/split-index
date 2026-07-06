import {
  getGLCoefficients,
  type GLEquipment,
  type StrengthSex,
} from "./coefficients";

/**
 * IPF GL equalization coefficient (6-decimal precision per IPF spec).
 * Coefficient = 100 / (A − B × e^(−C × BW))
 */
export function calculateGLCoefficient(
  bodyweightKg: number,
  sex: StrengthSex,
  equipment: GLEquipment = "classic"
): number {
  const minBw = sex === "female" ? 35 : 40;
  const bw = Math.max(minBw, bodyweightKg);
  const { A, B, C } = getGLCoefficients(sex, equipment);
  const denom = A - B * Math.exp(-C * bw);
  if (denom <= 0) return 0;
  return Math.round((100 / denom) * 1e6) / 1e6;
}

/**
 * IPF GL Points for an SBD total (kg).
 * Points = Total × GL Coefficient
 */
export function calculateGLPoints(
  totalKg: number,
  bodyweightKg: number,
  sex: StrengthSex,
  equipment: GLEquipment = "classic"
): number {
  if (totalKg <= 0 || bodyweightKg <= 0) return 0;
  const coef = calculateGLCoefficient(bodyweightKg, sex, equipment);
  return Math.round(totalKg * coef * 1e6) / 1e6;
}
