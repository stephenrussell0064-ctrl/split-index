import { mapExerciseToLift } from "@/lib/scoring/adapters";
import {
  gateCardioResult,
  gateStrengthResult,
} from "@/lib/scoring/gates";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { StrengthResult } from "@/lib/scoring/strength-activity";
import type { ScoreBreakdown } from "@/types";

export function extractGatedCardioInsight(
  breakdown: ScoreBreakdown,
  isPremium: boolean
) {
  const raw = breakdown.cardio_activity as CardioResult | undefined;
  if (!raw) return null;
  return gateCardioResult(raw, isPremium);
}

export function extractGatedStrengthInsights(
  breakdown: ScoreBreakdown,
  exercises: Array<{ exercise_name: string }>,
  isPremium: boolean
) {
  const activities = breakdown.strength_activities as StrengthResult[] | undefined;
  if (!activities?.length) return null;

  const mappedNames = exercises
    .map((ex) => ex.exercise_name)
    .filter((name) => mapExerciseToLift(name));

  return activities.map((result, index) => ({
    name: mappedNames[index] ?? `Lift ${index + 1}`,
    result: gateStrengthResult(result, isPremium),
  }));
}
