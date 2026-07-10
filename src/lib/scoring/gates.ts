import type { CardioResult } from "@/lib/scoring/cardio-activity";
import {
  serializeStrengthResult,
  type ScoreStrengthResult,
  type FreeStrengthResult,
} from "@/lib/scoring/split-strength-engine";
import type { IndexResult } from "@/lib/scoring/index-engine";
import type { CardioEnrichment } from "@/lib/scoring/cardio/confidence";
import type { AIFeedback } from "@/types";

export type LockedCardioFields =
  | "trimp"
  | "efficiencyFactor"
  | "decouplingPct"
  | "predictions"
  | "confidence"
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

export type GatedStrengthResult = ScoreStrengthResult | FreeStrengthResult;

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
  result: ScoreStrengthResult,
  isPremium: boolean
): GatedStrengthResult {
  return serializeStrengthResult(result, isPremium);
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

/**
 * Gate the (legacy, non-`CardioResult`-shaped) cardio enrichment payload at
 * the presentation layer — the same trimp/efficiencyFactor/decoupling/
 * confidence/notes fields locked in gateCardioResult(), never sent real to
 * the client for free users. vo2max stays real (it's free-tier data, same
 * as gateCardioResult()). Synthetic placeholder values mirror the pattern
 * used in session-score-insights.tsx.
 */
export function gateCardioEnrichment(
  enrichment: CardioEnrichment,
  isPremium: boolean
): CardioEnrichment {
  if (isPremium) return enrichment;
  return {
    sportIndex: enrichment.sportIndex,
    adjustedDisplayIndex: enrichment.adjustedDisplayIndex,
    vo2maxEstimate: enrichment.vo2maxEstimate,
    confidence: "medium",
    flags: [],
    trimp: { trimp: 112, hrReserveRatio: 0.62, durationMinutes: 42, label: "moderate" },
    efficiencyFactor: { efficiencyFactor: 0.84, unit: "pace_per_hr", displayValue: "0.84" },
    decoupling: {
      firstHalfEF: 0.86,
      secondHalfEF: 0.83,
      decouplingPct: 3.1,
      flag: "stable",
      note: "Pacing held steady between halves.",
    },
    notes: [],
  };
}

/**
 * Gate GPT-generated AI Coach feedback at the presentation layer.
 * `next_workout_recommendation` is the intentional free-tier snippet (shown
 * unblurred in AICoachCard); the other four fields are real GPT output and
 * must never reach a free user's client, even blurred — replaced with
 * synthetic placeholder text instead.
 */
export function gateAiFeedback(feedback: AIFeedback, isPremium: boolean): AIFeedback {
  if (isPremium) return feedback;
  return {
    ...feedback,
    performance_explanation:
      "Your session score, drivers, and index movement — unlocked with Premium.",
    recovery_advice:
      "Personalized recovery timing based on your fatigue and ACWR — unlocked with Premium.",
    long_term_insight:
      "Multi-week trend analysis and projections — unlocked with Premium.",
    score_change_reason: "Why your Split Index moved — unlocked with Premium.",
  };
}

export function isCardioResultLocked(
  value: GatedCardioResult
): value is Extract<GatedCardioResult, { locked: LockedCardioFields[] }> {
  return "locked" in value;
}

export function isStrengthResultLocked(
  value: GatedStrengthResult
): value is FreeStrengthResult {
  return "premiumLocked" in value;
}

export function isIndexResultLocked(
  value: GatedIndexResult
): value is Extract<GatedIndexResult, { locked: LockedIndexFields[] }> {
  return "locked" in value;
}
