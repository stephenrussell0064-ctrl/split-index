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

/**
 * The same rungs, named for a column roughly 60px wide.
 *
 * The home page shows the whole ladder five-across on a phone (user feedback:
 * "rather than showing 5km prediction as a large square, show 1500m, 5km,
 * 10km, half and full predictions"), where "Marathon" and "1500 m" do not fit
 * without wrapping. Kept separate from `formatPredictionLabel` rather than
 * shortening that one, because the widget and the analytics ladder have the
 * room and "Marathon" is the better word when there is room for it.
 */
const SHORT_RACE_LABELS: Record<string, string> = {
  "1500": "1500m",
  "5000": "5K",
  "10000": "10K",
  "21097.5": "Half",
  "42195": "Full",
};

export function formatShortPredictionLabel(distanceMeters: string): string {
  return SHORT_RACE_LABELS[distanceMeters] ?? `${distanceMeters}m`;
}

/**
 * Reads the age entry the strength engine writes into `appliedFactors`
 * (`age:38 ×1.020 standard (beta)`) so it can be shown to the athlete.
 *
 * The engine applies the factor as `effectiveAnchor /= factor` — it moves the
 * *standard* being measured against, never the athlete's own lift or ratio.
 * That is the only honest way to describe it, and it is why this returns an
 * eased percentage rather than anything resembling an adjusted lift. A factor
 * above 1 means an easier anchor, which is true at both ends of the curve
 * (Foster junior coefficients below 23, Masters decline above 35).
 *
 * Returns null when there is no age entry, which covers three real cases and
 * needs no distinction between them: a free-tier result (appliedFactors is
 * premium-gated and absent entirely), an athlete inside the flat 23–35 band
 * (the engine only records an entry when the factor is not exactly 1), and a
 * profile with no date of birth.
 *
 * The factor is uncalibrated and flagged beta upstream — callers must present
 * it as a moved standard, never as an accuracy claim.
 */
export function describeAgeStandard(
  appliedFactors: string[] | undefined | null
): { age: number; factor: number; easedPct: number } | null {
  const entry = appliedFactors?.find((f) => f.startsWith("age:"));
  if (!entry) return null;

  // Both signs, deliberately: split-strength-engine.ts:1605 writes U+00D7
  // (`×`) while strength/isometric-carry.ts:387,485 writes an ASCII `x`.
  // Matching only the former renders nothing for every hold and carry.
  const parsed = /^age:(\d+(?:\.\d+)?)\s*[×x](\d+(?:\.\d+)?)/.exec(entry);
  if (!parsed) return null;

  const age = Number(parsed[1]);
  const factor = Number(parsed[2]);
  if (!Number.isFinite(age) || !Number.isFinite(factor) || factor <= 0) return null;

  // The anchor is divided by the factor, so the standard falls by 1 − 1/factor.
  // Dividing (rather than multiplying by factor − 1) matters at the junior end,
  // where 1.23 is an 18.7% easier standard and not a 23% one.
  return { age, factor, easedPct: (1 - 1 / factor) * 100 };
}
