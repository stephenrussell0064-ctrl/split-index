import type { Gender, Profile } from "@/types";

export type Vo2MaxConfidence = "high" | "medium" | "low";

export interface Vo2MaxEstimate {
  /** Uth HR-ratio estimate (ml/kg/min scale proxy) */
  estimate: number;
  hrMax: number;
  hrRest: number;
  hrMaxSource: "measured" | "tanaka";
  confidence: Vo2MaxConfidence;
  /** Running-only cross-check note; not used for row/swim primary scoring */
  crossCheckNote?: string;
}

const DEFAULT_HR_REST = 60;

/** Tanaka et al. (2001): 208 − 0.7 × age */
export function estimateHrMaxTanaka(age: number | null): number {
  const a = age ?? 35;
  return Math.round(208 - 0.7 * a);
}

function resolveHrRest(profile: Profile, override?: number | null): number {
  if (override && override > 30 && override < 120) return override;
  return DEFAULT_HR_REST;
}

/**
 * Uth–Sørensen–Overgaard–Pedersen HR-ratio method:
 * VO2max ≈ 15.3 × (HRmax / HRrest)
 */
export function estimateVo2MaxUth(
  profile: Profile,
  options?: { hrRest?: number | null; sport?: string }
): Vo2MaxEstimate {
  const hrRest = resolveHrRest(profile, options?.hrRest);
  const measuredMax = profile.max_hr;
  const tanakaMax = estimateHrMaxTanaka(profile.age);
  const hrMax =
    measuredMax && measuredMax >= 140 && measuredMax <= 220 ? measuredMax : tanakaMax;
  const hrMaxSource: "measured" | "tanaka" =
    measuredMax && measuredMax >= 140 && measuredMax <= 220 ? "measured" : "tanaka";

  const estimate = Math.round((15.3 * (hrMax / hrRest)) * 10) / 10;

  let confidence: Vo2MaxConfidence = "medium";
  if (hrMaxSource === "measured" && options?.hrRest) confidence = "high";
  else if (hrMaxSource === "tanaka") confidence = "low";

  let crossCheckNote: string | undefined;
  if (options?.sport === "running" && hrMaxSource === "tanaka") {
    crossCheckNote =
      "VO2max label uses estimated max HR (Tanaka). Add measured max HR in profile for higher confidence.";
  } else if (options?.sport && options.sport !== "running") {
    crossCheckNote = "VO2max estimate is indicative only for non-running sports.";
  }

  return {
    estimate,
    hrMax,
    hrRest,
    hrMaxSource,
    confidence,
    crossCheckNote,
  };
}

export function formatVo2MaxLabel(estimate: Vo2MaxEstimate, gender: Gender | null): string {
  const band =
    estimate.estimate >= 55
      ? "Excellent"
      : estimate.estimate >= 48
        ? "Good"
        : estimate.estimate >= 42
          ? "Average"
          : "Developing";
  const sexNote =
    gender === "female" ? " (female reference bands differ)" : "";
  return `${band} aerobic capacity ~${estimate.estimate}${sexNote}`;
}
