import type { ScoreBreakdown } from "@/types";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { StrengthResult } from "@/lib/scoring/strength-activity";
import type { IndexResult } from "@/lib/scoring/index-engine";
import {
  gateCardioResult,
  gateStrengthResult,
  gateIndexResult,
  type GatedCardioResult,
  type GatedStrengthResult,
  type GatedIndexResult,
} from "@/lib/scoring/gates";

/** Gate persisted score breakdown for API / UI based on subscription tier. */
export function serializeScoreBreakdown(
  breakdown: ScoreBreakdown | null | undefined,
  isPremium: boolean
) {
  if (!breakdown) return null;

  const cardio = breakdown.cardio_activity
    ? gateCardioResult(breakdown.cardio_activity as CardioResult, isPremium)
    : undefined;

  const strength = breakdown.strength_activities?.map((row) =>
    gateStrengthResult(row as StrengthResult, isPremium)
  );

  const index = breakdown.index_result
    ? gateIndexResult(breakdown.index_result as IndexResult, isPremium)
    : undefined;

  return {
    ...breakdown,
    cardio_activity: cardio,
    strength_activities: strength,
    index_result: index,
  };
}

export type { GatedCardioResult, GatedStrengthResult, GatedIndexResult };

export function formatRiegelPrediction(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const RACE_LABELS: Record<string, string> = {
  "1500": "1500 m",
  "5000": "5K",
  "10000": "10K",
  "21097.5": "Half",
  "42195": "Marathon",
};

export function formatPredictionLabel(distanceMeters: string): string {
  return RACE_LABELS[distanceMeters] ?? `${distanceMeters} m`;
}
