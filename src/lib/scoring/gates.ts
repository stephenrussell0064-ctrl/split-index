import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { StrengthResult } from "@/lib/scoring/strength-activity";
import type { IndexResult } from "@/lib/scoring/index-engine";

export type LockedCardioFields =
  | "trimp"
  | "efficiencyFactor"
  | "decouplingPct"
  | "predictions"
  | "confidence"
  | "flags";

export type LockedStrengthFields =
  | "dots"
  | "bodyweightRatio"
  | "tier"
  | "percentileVsStandards"
  | "flags";

export type LockedIndexFields =
  | "labIndex"
  | "engineIndex"
  | "splitIndex"
  | "breakdown";

export type GatedCardioResult =
  | CardioResult
  | (Pick<CardioResult, "score" | "vo2max" | "vo2maxMethod"> & {
      locked: LockedCardioFields[];
    });

export type GatedStrengthResult =
  | StrengthResult
  | (Pick<StrengthResult, "score" | "estimated1RM"> & {
      locked: LockedStrengthFields[];
    });

export type GatedIndexResult =
  | IndexResult
  | (Pick<IndexResult, "headline" | "headlineLabel"> & {
      locked: LockedIndexFields[];
    });

/** Gate cardio premium fields at the presentation/API layer. */
export function gateCardioResult(
  result: CardioResult,
  isPremium: boolean
): GatedCardioResult {
  if (isPremium) return result;
  const { score, vo2max, vo2maxMethod } = result;
  return {
    score,
    vo2max,
    vo2maxMethod,
    locked: [
      "trimp",
      "efficiencyFactor",
      "decouplingPct",
      "predictions",
      "confidence",
      "flags",
    ],
  };
}

/** Gate strength premium fields at the presentation/API layer. */
export function gateStrengthResult(
  result: StrengthResult,
  isPremium: boolean
): GatedStrengthResult {
  if (isPremium) return result;
  const { score, estimated1RM } = result;
  return {
    score,
    estimated1RM,
    locked: ["dots", "bodyweightRatio", "tier", "percentileVsStandards", "flags"],
  };
}

/** Gate index premium fields at the presentation/API layer. */
export function gateIndexResult(
  result: IndexResult,
  isPremium: boolean
): GatedIndexResult {
  if (isPremium) return result;
  return {
    headline: result.headline,
    headlineLabel: result.headlineLabel,
    locked: ["labIndex", "engineIndex", "splitIndex", "breakdown"],
  };
}

export function isCardioResultLocked(
  value: GatedCardioResult
): value is Extract<GatedCardioResult, { locked: LockedCardioFields[] }> {
  return "locked" in value;
}

export function isStrengthResultLocked(
  value: GatedStrengthResult
): value is Extract<GatedStrengthResult, { locked: LockedStrengthFields[] }> {
  return "locked" in value;
}

export function isIndexResultLocked(
  value: GatedIndexResult
): value is Extract<GatedIndexResult, { locked: LockedIndexFields[] }> {
  return "locked" in value;
}
