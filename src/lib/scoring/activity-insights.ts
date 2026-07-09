import {
  gateCardioResult,
  gateStrengthResult,
} from "@/lib/scoring/gates";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";
import type { ScoreBreakdown } from "@/types";

export function extractGatedCardioInsight(
  breakdown: ScoreBreakdown,
  isPremium: boolean
) {
  const raw = breakdown.cardio_activity as CardioResult | undefined;
  if (!raw) return null;
  return gateCardioResult(raw, isPremium);
}

/** Every logged exercise gets a scoreStrength() result now, each carrying its own liftKey — no name/index alignment needed. */
export function extractGatedStrengthInsights(
  breakdown: ScoreBreakdown,
  isPremium: boolean
) {
  const activities = breakdown.strength_activities as ScoreStrengthResult[] | undefined;
  if (!activities?.length) return null;

  return activities.map((result) => ({
    name: result.liftKey,
    result: gateStrengthResult(result, isPremium),
  }));
}
