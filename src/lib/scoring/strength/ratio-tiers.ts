/**
 * ExRx-style strength standards expressed as lift ÷ bodyweight ratio tiers.
 * Source: ExRx.net strength standards (approximate adult benchmarks).
 * Last verified: 2026-07-06
 *
 * Phase 1 uses ratio tiers for accessories (OHP, weighted pull-up) until
 * OpenPowerlifting CSV percentiles land in Phase 2.
 */

import type { StrengthSex } from "./coefficients";

export type ExRxTier =
  | "untrained"
  | "novice"
  | "intermediate"
  | "advanced"
  | "elite";

export type AccessoryLift = "ohp" | "pullup";

/** Ratio thresholds (lift kg / bodyweight kg) by tier, ascending. */
const MALE_RATIO_TIERS: Record<
  AccessoryLift,
  Record<ExRxTier, number>
> = {
  ohp: {
    untrained: 0.35,
    novice: 0.55,
    intermediate: 0.75,
    advanced: 0.95,
    elite: 1.15,
  },
  pullup: {
    untrained: 0,
    novice: 0.15,
    intermediate: 0.35,
    advanced: 0.55,
    elite: 0.75,
  },
};

const FEMALE_RATIO_TIERS: Record<
  AccessoryLift,
  Record<ExRxTier, number>
> = {
  ohp: {
    untrained: 0.25,
    novice: 0.4,
    intermediate: 0.55,
    advanced: 0.7,
    elite: 0.85,
  },
  pullup: {
    untrained: 0,
    novice: 0.05,
    intermediate: 0.2,
    advanced: 0.35,
    elite: 0.5,
  },
};

const TIER_ORDER: ExRxTier[] = [
  "untrained",
  "novice",
  "intermediate",
  "advanced",
  "elite",
];

/** Map tier to a 0–1000 sub-index (midpoint of tier band). */
const TIER_INDEX_MIDPOINT: Record<ExRxTier, number> = {
  untrained: 200,
  novice: 350,
  intermediate: 500,
  advanced: 700,
  elite: 850,
};

export const EXRX_TIER_LABELS: Record<ExRxTier, string> = {
  untrained: "Untrained",
  novice: "Novice",
  intermediate: "Intermediate",
  advanced: "Advanced",
  elite: "Elite",
};

function tiersForLift(
  lift: AccessoryLift,
  sex: StrengthSex
): Record<ExRxTier, number> {
  return sex === "female"
    ? FEMALE_RATIO_TIERS[lift]
    : MALE_RATIO_TIERS[lift];
}

export function classifyRatioTier(
  ratio: number,
  lift: AccessoryLift,
  sex: StrengthSex
): ExRxTier {
  const thresholds = tiersForLift(lift, sex);
  let tier: ExRxTier = "untrained";
  for (const t of TIER_ORDER) {
    if (ratio >= thresholds[t]) tier = t;
  }
  return tier;
}

/**
 * Map a bodyweight ratio to a 0–1000 index via ExRx tier bands with
 * linear interpolation within the active tier.
 */
export function ratioToTierIndex(
  ratio: number,
  lift: AccessoryLift,
  sex: StrengthSex
): number {
  const thresholds = tiersForLift(lift, sex);
  const tier = classifyRatioTier(ratio, lift, sex);
  const tierIdx = TIER_ORDER.indexOf(tier);
  const floor = thresholds[tier];
  const ceiling =
    tierIdx < TIER_ORDER.length - 1
      ? thresholds[TIER_ORDER[tierIdx + 1]]
      : floor * 1.25;
  const floorIndex =
    tierIdx > 0
      ? TIER_INDEX_MIDPOINT[TIER_ORDER[tierIdx - 1]]
      : 100;
  const ceilingIndex = TIER_INDEX_MIDPOINT[tier];
  if (ceiling <= floor) return ceilingIndex;
  const t = Math.min(1, Math.max(0, (ratio - floor) / (ceiling - floor)));
  return Math.round(floorIndex + t * (ceilingIndex - floorIndex));
}

/** Weighted pull-up: total load (BW + added) / BW. Bodyweight-only ≈ 1.0. */
export function pullUpRatio(
  addedWeightKg: number,
  bodyweightKg: number
): number {
  if (bodyweightKg <= 0) return 0;
  return (bodyweightKg + Math.max(0, addedWeightKg)) / bodyweightKg - 1;
}
