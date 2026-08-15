import type { ScoreBreakdown } from "@/types";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";
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
    gateStrengthResult(row as ScoreStrengthResult, isPremium)
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

/**
 * Predicted times are stored to hundredths of a second (predicted_benchmarks.
 * benchmark_seconds is NUMERIC(10,2)), so the fractional part is rounded once
 * up front rather than per-field: rounding the seconds field on its own turned
 * 1499.6s into "24:60" instead of "25:00", because the minutes field was
 * floored off the unrounded value.
 */
export function formatRiegelPrediction(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
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
