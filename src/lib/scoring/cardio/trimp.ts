import type { Gender } from "@/types";

export interface TrimpResult {
  trimp: number;
  hrReserveRatio: number;
  durationMinutes: number;
  label: "light" | "moderate" | "hard" | "very_hard";
}

/** Banister TRIMP — sex-specific exponential coefficients */
export function calculateBanisterTrimp(params: {
  durationSeconds: number;
  avgHeartRate: number;
  hrMax: number;
  hrRest: number;
  gender: Gender | null;
}): TrimpResult | null {
  const { durationSeconds, avgHeartRate, hrMax, hrRest, gender } = params;
  if (durationSeconds <= 0 || avgHeartRate <= 0) return null;

  const reserve = hrMax - hrRest;
  if (reserve <= 0) return null;

  const hrReserveRatio = Math.min(1, Math.max(0, (avgHeartRate - hrRest) / reserve));
  const durationMinutes = durationSeconds / 60;

  const isFemale = gender === "female";
  const a = isFemale ? 0.86 : 0.64;
  const b = isFemale ? 1.67 : 1.92;

  const trimp = durationMinutes * hrReserveRatio * a * Math.exp(b * hrReserveRatio);

  const label: TrimpResult["label"] =
    trimp < 50
      ? "light"
      : trimp < 100
        ? "moderate"
        : trimp < 150
          ? "hard"
          : "very_hard";

  return {
    trimp: Math.round(trimp * 10) / 10,
    hrReserveRatio: Math.round(hrReserveRatio * 1000) / 1000,
    durationMinutes: Math.round(durationMinutes * 10) / 10,
    label,
  };
}
