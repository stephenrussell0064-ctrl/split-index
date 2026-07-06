/**
 * Published powerlifting coefficient sets for DOTS and IPF GL Points.
 *
 * DOTS — OpenPowerlifting / IPF (2019+)
 *   https://www.powerlifting.sport/fileadmin/ipf/data/ipf-formula/DOTS_Coefficients.pdf
 *   Last verified: 2026-07-06
 *
 * IPF GL — IPF Goodlift Formula (2020, v0.6.5)
 *   https://powerlifting.sport/fileadmin/ipf/data/ipf-formula/IPF_GL_Coefficients-2020.pdf
 *   Last verified: 2026-07-06
 */

export type StrengthSex = "male" | "female";

/** 4th-degree polynomial coefficients for DOTS denominator (BW in kg). */
export interface DOTSCoefficients {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
}

/** Exponential-model coefficients for IPF GL equalization. */
export interface GLCoefficients {
  A: number;
  B: number;
  C: number;
}

export type GLEquipment = "classic" | "equipped";
export type GLEvent = "powerlifting" | "bench";

/** Men DOTS — brief + OpenPowerlifting standard set */
export const DOTS_MEN: DOTSCoefficients = {
  a: -0.000001093,
  b: 0.0007391293,
  c: -0.1918759221,
  d: 24.0900756,
  e: -307.75076,
};

/** Women DOTS — OpenPowerlifting standard set */
export const DOTS_WOMEN: DOTSCoefficients = {
  a: -0.0000010706,
  b: 0.0005158568,
  c: -0.1126655495,
  d: 13.6175032,
  e: -57.96288,
};

export const DOTS_BODYWEIGHT_BOUNDS: Record<
  StrengthSex,
  { min: number; max: number }
> = {
  male: { min: 40, max: 210 },
  female: { min: 40, max: 150 },
};

/** IPF GL Classic (raw) 3-lift — men */
export const GL_MEN_CLASSIC_POWERLIFTING: GLCoefficients = {
  A: 1199.72839,
  B: 1025.18162,
  C: 0.00921,
};

/** IPF GL Equipped 3-lift — men */
export const GL_MEN_EQUIPPED_POWERLIFTING: GLCoefficients = {
  A: 1236.25115,
  B: 1449.21864,
  C: 0.01644,
};

/** IPF GL Classic (raw) 3-lift — women */
export const GL_WOMEN_CLASSIC_POWERLIFTING: GLCoefficients = {
  A: 610.32796,
  B: 1045.59282,
  C: 0.03048,
};

/** IPF GL Equipped 3-lift — women */
export const GL_WOMEN_EQUIPPED_POWERLIFTING: GLCoefficients = {
  A: 758.63878,
  B: 949.31382,
  C: 0.02435,
};

export function getDOTSCoefficients(sex: StrengthSex): DOTSCoefficients {
  return sex === "female" ? DOTS_WOMEN : DOTS_MEN;
}

export function getGLCoefficients(
  sex: StrengthSex,
  equipment: GLEquipment = "classic",
  event: GLEvent = "powerlifting"
): GLCoefficients {
  if (event !== "powerlifting") {
    throw new Error("Phase 1 supports 3-lift totals only");
  }
  if (sex === "female") {
    return equipment === "equipped"
      ? GL_WOMEN_EQUIPPED_POWERLIFTING
      : GL_WOMEN_CLASSIC_POWERLIFTING;
  }
  return equipment === "equipped"
    ? GL_MEN_EQUIPPED_POWERLIFTING
    : GL_MEN_CLASSIC_POWERLIFTING;
}
