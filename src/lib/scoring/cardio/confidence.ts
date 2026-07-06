import type { Activity, Profile, SportType } from "@/types";
import { isEnduranceSport } from "@/lib/scoring/engine";
import { estimateHrMaxTanaka, estimateVo2MaxUth, type Vo2MaxEstimate } from "./vo2max";
import { calculateBanisterTrimp, type TrimpResult } from "./trimp";
import {
  calculateAerobicDecoupling,
  calculateEfficiencyFactor,
  type DecouplingResult,
  type EfficiencyFactorResult,
} from "./efficiency";

export type CardioConfidenceLevel = "high" | "medium" | "low";

export type CardioEnrichmentFlag =
  | "no_hr"
  | "positive_split"
  | "negative_split"
  | "decoupling"
  | "unverified";

export interface CardioEnrichment {
  sportIndex: number;
  /** Display-only adjusted index when confidence modifiers apply */
  adjustedDisplayIndex?: number;
  confidence: CardioConfidenceLevel;
  flags: CardioEnrichmentFlag[];
  vo2maxEstimate?: Vo2MaxEstimate;
  trimp?: TrimpResult;
  efficiencyFactor?: EfficiencyFactorResult;
  decoupling?: DecouplingResult;
  notes: string[];
}

export interface EnrichCardioScoreInput {
  sportIndex: number;
  sport: SportType;
  activity: Pick<
    Activity,
    | "duration_seconds"
    | "distance_meters"
    | "avg_heart_rate"
    | "avg_power_watts"
    | "avg_pace_seconds_per_km"
    | "avg_split_seconds"
  >;
  profile: Profile;
  /** Optional split paces in seconds (per km or segment) */
  splitPacesSec?: number[];
  hrRest?: number | null;
}

const HR_MISSING_DISPLAY_DISCOUNT = 0.07;

/**
 * Additive cardio enrichment layer — does NOT modify core sport index math.
 * Returns display metadata and optional adjusted display index.
 */
export function enrichCardioScore(input: EnrichCardioScoreInput): CardioEnrichment | null {
  const { sportIndex, sport, activity, profile, splitPacesSec, hrRest } = input;
  if (!isEnduranceSport(sport)) return null;

  const flags: CardioEnrichmentFlag[] = [];
  const notes: string[] = [];
  let confidence: CardioConfidenceLevel = "high";
  let adjustedDisplayIndex: number | undefined;

  const hrMax =
    profile.max_hr && profile.max_hr >= 140
      ? profile.max_hr
      : estimateHrMaxTanaka(profile.age);
  const restingHr = hrRest ?? 60;

  const vo2maxEstimate = estimateVo2MaxUth(profile, {
    hrRest: restingHr,
    sport,
  });

  let trimp: TrimpResult | undefined;
  let efficiencyFactor: EfficiencyFactorResult | undefined;
  let decoupling: DecouplingResult | undefined;

  if (!activity.avg_heart_rate) {
    flags.push("no_hr");
    flags.push("unverified");
    confidence = "low";
    adjustedDisplayIndex = Math.round(sportIndex * (1 - HR_MISSING_DISPLAY_DISCOUNT));
    notes.push(
      `No heart rate — display index reduced ~${Math.round(HR_MISSING_DISPLAY_DISCOUNT * 100)}% (core index unchanged). Add HR to unlock aerobic efficiency scoring.`
    );
  } else {
    trimp = calculateBanisterTrimp({
      durationSeconds: activity.duration_seconds,
      avgHeartRate: activity.avg_heart_rate,
      hrMax,
      hrRest: restingHr,
      gender: profile.gender,
    }) ?? undefined;

    efficiencyFactor =
      calculateEfficiencyFactor({
        avgHeartRate: activity.avg_heart_rate,
        paceSecPerKm: activity.avg_pace_seconds_per_km,
        avgPowerWatts: activity.avg_power_watts,
      }) ?? undefined;

    decoupling =
      calculateAerobicDecoupling({
        avgHeartRate: activity.avg_heart_rate,
        paceSecPerKm: activity.avg_pace_seconds_per_km,
        avgPowerWatts: activity.avg_power_watts,
        splitPacesSec,
        durationSeconds: activity.duration_seconds,
      }) ?? undefined;

    if (decoupling?.flag === "decoupling") {
      flags.push("decoupling");
      confidence = confidence === "high" ? "medium" : confidence;
    }
    if (decoupling?.flag === "negative_split") {
      flags.push("negative_split");
      notes.push("Negative split — faster second half noted for pacing quality.");
    }
    if (decoupling?.flag === "stable" && splitPacesSec?.length) {
      const mid = Math.floor(splitPacesSec.length / 2);
      const first = splitPacesSec.slice(0, mid);
      const second = splitPacesSec.slice(mid);
      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      if (avg(second) > avg(first) + 3) {
        flags.push("positive_split");
        notes.push("Positive split — slower second half.");
      }
    }

    if (vo2maxEstimate.confidence === "low") confidence = "medium";
    if (!efficiencyFactor) confidence = confidence === "high" ? "medium" : confidence;
  }

  return {
    sportIndex,
    adjustedDisplayIndex,
    confidence,
    flags,
    vo2maxEstimate,
    trimp,
    efficiencyFactor,
    decoupling,
    notes,
  };
}
