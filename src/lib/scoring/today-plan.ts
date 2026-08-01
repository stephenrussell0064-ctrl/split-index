/**
 * Prescriptive layer (interference-engine brief, Part 3) — turns the app
 * from descriptive (here's what happened) to prescriptive (here's what to
 * do). Pure function: takes the Part 2 readiness result, the Part 1
 * interference report, and the user's existing Tier 2 race prediction
 * (reused, not recalculated), and returns one plain-language plan.
 */
import { tier2IsCalibrating } from "./cardio/race-prediction";
import { formatRiegelPrediction } from "./presentation";
import type { ReadinessResult } from "./readiness";
import type { InterferenceReport } from "./interference";
import type { StoredPredictedBenchmark } from "./predicted-benchmark";

export type SuggestedIntensity = "hard" | "moderate" | "easy";

export interface TodayPlan {
  suggestedIntensity: SuggestedIntensity;
  suggestionLabel: string;
  targetPaceLabel: string | null;
  /** Non-null only when both readiness and interference point the same unfavorable way at once — the moment those two features combine into something neither alone can say. */
  deloadNudge: string | null;
}

const READINESS_HARD_THRESHOLD = 70;
const READINESS_EASY_THRESHOLD = 40;

function suggestionFor(readiness: number): { intensity: SuggestedIntensity; label: string } {
  if (readiness >= READINESS_HARD_THRESHOLD) {
    return { intensity: "hard", label: "Good day for a hard effort — intervals, tempo, or a heavy lift." };
  }
  if (readiness >= READINESS_EASY_THRESHOLD) {
    return { intensity: "moderate", label: "Moderate effort today — an easy run or a lighter lift." };
  }
  return { intensity: "easy", label: "Recovery day — easy movement only, or take the day fully off." };
}

/** Shared with the Hybrid Athlete Report — same "reuse the existing Tier 2 prediction, don't recalculate" rule applies there too. */
export function buildTargetPaceLabel(benchmark: StoredPredictedBenchmark | null): string | null {
  if (!benchmark || tier2IsCalibrating(benchmark.sampleCount)) return null;
  return `Target: ${formatRiegelPrediction(benchmark.benchmarkSeconds)} for your next 5K attempt`;
}

function buildDeloadNudge(readiness: ReadinessResult, interference: InterferenceReport): string | null {
  if (readiness.readiness >= READINESS_EASY_THRESHOLD) return null;

  const strengthHurting =
    !interference.strengthToCardio.calibrating &&
    interference.strengthToCardio.decayByDay.some((d) => d.efDeltaPct !== null && d.efDeltaPct < -3);
  const cardioHurting =
    !interference.cardioToStrength.calibrating &&
    interference.cardioToStrength.deltaPct !== null &&
    interference.cardioToStrength.deltaPct < -3;

  if (!strengthHurting && !cardioHurting) return null;

  return "Readiness is low and your own interference data shows real cross-training cost right now — this week is a good candidate for a deload.";
}

export function buildTodayPlan(
  readiness: ReadinessResult,
  interference: InterferenceReport,
  predictedBenchmark: StoredPredictedBenchmark | null
): TodayPlan {
  const { intensity, label } = suggestionFor(readiness.readiness);

  return {
    suggestedIntensity: intensity,
    suggestionLabel: label,
    targetPaceLabel: buildTargetPaceLabel(predictedBenchmark),
    deloadNudge: buildDeloadNudge(readiness, interference),
  };
}
