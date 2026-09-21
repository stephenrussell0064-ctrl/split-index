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
 * Reads the age line back out of a strength result's `appliedFactors`.
 *
 * Both engines already push a ready-made string when the age curve moved the
 * anchor — `age:50 ×1.110 standard (beta)` from split-strength-engine, and
 * `age:50 x1.110 standard (beta)` (ASCII x) from strength/isometric-carry.
 * Parsing here rather than adding a structured field keeps this a pure
 * presentation concern: neither engine changes, and results persisted before
 * this readout existed render it too, since the string was always in there.
 *
 * Accepts either multiplication sign for exactly that reason — matching only
 * `×` would silently render nothing for every hold and carry.
 */
const AGE_FACTOR_PATTERN = /^age:(\d+(?:\.\d+)?)\s*[×x]\s*(\d+(?:\.\d+)?)/;

export interface AgeAdjustmentReadout {
  age: number;
  /** The raw curve output, as the engine applied it. */
  factor: number;
  /**
   * How far the standard moved, in percent, already rounded for display.
   *
   * NOT `factor - 1`. The engine divides the anchor by the factor
   * (`effectiveAnchor /= factor`), so a ×1.110 factor lowers the standard by
   * 1 - 1/1.110 = 9.9%, not 11%. Quoting the factor as a percentage directly
   * would overstate the adjustment the athlete actually received.
   */
  percentMoved: number;
  /** Which way the standard moved. Every published coefficient today is >= 1 (juniors 1.01-1.23, masters up to 1.11+), so this is "lower" in practice — direction is derived rather than assumed so a future sub-1.0 coefficient reads correctly instead of lying. */
  direction: "lower" | "higher";
  /** One-line readout to sit under the score. */
  label: string;
}

/**
 * Null when no age factor was applied — which is the correct, silent outcome
 * for the 23-35 peak band, where `ageFactor()` returns exactly 1.0 and the
 * engine pushes nothing at all.
 */
export function readAgeAdjustment(
  appliedFactors: readonly string[] | null | undefined
): AgeAdjustmentReadout | null {
  if (!appliedFactors) return null;

  for (const entry of appliedFactors) {
    const match = AGE_FACTOR_PATTERN.exec(entry);
    if (!match) continue;

    const age = Number(match[1]);
    const factor = Number(match[2]);
    // A factor of exactly 1 moves nothing; saying so would be noise. Guard
    // against a non-finite or zero factor too rather than dividing by it.
    if (!Number.isFinite(age) || !Number.isFinite(factor) || factor <= 0 || factor === 1) {
      continue;
    }

    const percentMoved = Math.round(Math.abs(1 - 1 / factor) * 1000) / 10;
    // Below 0.05% the rounded figure is "0%", which reads as a bug rather
    // than as a negligible adjustment. Stay quiet instead.
    if (percentMoved === 0) continue;

    const direction: "lower" | "higher" = factor > 1 ? "lower" : "higher";

    return {
      age,
      factor,
      percentMoved,
      direction,
      label: `Age ${age}: standard ${percentMoved}% ${direction} (×${factor.toFixed(3)})`,
    };
  }

  return null;
}

/**
 * The sentence that goes with the readout.
 *
 * Deliberately describes the MECHANISM and nothing else — the anchor moved,
 * the athlete's own numbers did not. That is architecturally exact (see
 * `effectiveAnchor /= factor`), and it is the only claim this curve can
 * currently support: the masters half is an estimate off a strength-by-age
 * chart, not a calibration against population data, which is why the engine
 * marks every one of these results beta. No accuracy claim belongs here.
 */
export function formatAgeAdjustmentNote(readout: AgeAdjustmentReadout): string {
  return (
    `Age-graded (beta): at ${readout.age}, the standard you're judged against sits ` +
    `${readout.percentMoved}% ${readout.direction} than the open standard. Your lift and your ` +
    `bodyweight ratio are unchanged — only the benchmark moved. The curve is provisional and ` +
    `not yet calibrated against population data.`
  );
}

/**
 * The cardio counterpart, reading the factor the endurance engine reports on
 * its result (`CardioResult.ageGradeFactor`).
 *
 * Same arithmetic as the strength readout, deliberately different words. The
 * engine multiplies the athlete's benchmark-equivalent TIME by the factor
 * before the table lookup (`timeToScore(sport, seconds * factor, sex)`), which
 * is identical to leaving their real time alone and dividing the standard's
 * times by the factor. So the magnitude is the same |1 - 1/factor| the
 * strength side reports — but for a time-based standard the honest word is
 * "slower", not "lower": a LOWER time standard would be HARDER, the exact
 * opposite of what age grading does.
 *
 * Endurance factors run below 1 (0.97 at 40, 0.89 at 50, 0.60 at 80), the
 * mirror image of the strength curve's above-1 coefficients. Direction is
 * derived rather than assumed, so neither curve can silently render backwards.
 */
export interface CardioAgeGradeReadout {
  factor: number;
  /** How much more lenient (or stricter) the standard became, rounded for display. */
  percentMoved: number;
  direction: "slower" | "faster";
  label: string;
}

/**
 * Null when nothing was graded — and null, deliberately, for a result
 * persisted before `ageGradeFactor` existed. Those genuinely carry no
 * magnitude, and the caller must fall back to the flag-only wording rather
 * than print a fabricated number or read `undefined` as 1.0.
 */
export function readCardioAgeGrade(
  factor: number | null | undefined
): CardioAgeGradeReadout | null {
  if (factor == null || !Number.isFinite(factor) || factor <= 0 || factor === 1) return null;

  const percentMoved = Math.round(Math.abs(1 - 1 / factor) * 1000) / 10;
  if (percentMoved === 0) return null;

  const direction: "slower" | "faster" = factor < 1 ? "slower" : "faster";

  return {
    factor,
    percentMoved,
    direction,
    label: `Age-graded: standard ${percentMoved}% ${direction} (×${factor.toFixed(3)})`,
  };
}
