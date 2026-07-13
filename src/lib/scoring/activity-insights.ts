import {
  gateCardioResult,
  gateStrengthResult,
} from "@/lib/scoring/gates";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import {
  tierForScore,
  type ScoreStrengthResult,
} from "@/lib/scoring/split-strength-engine";
import type { ScoreBreakdown, StrengthScore } from "@/types";

export type GatedStrengthInsight = {
  name: string;
  result: ReturnType<typeof gateStrengthResult>;
};

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
): GatedStrengthInsight[] | null {
  const activities = breakdown.strength_activities as ScoreStrengthResult[] | undefined;
  if (!activities?.length) return null;

  return activities.map((result) => ({
    name: result.liftKey,
    result: gateStrengthResult(result, isPremium),
  }));
}

function strengthResultFromScoreRow(row: StrengthScore): ScoreStrengthResult | null {
  const raw = row.score_breakdown?.strength_result;
  if (raw && typeof raw === "object" && "score" in raw) {
    return raw as ScoreStrengthResult;
  }
  if (row.strength_index <= 0) return null;
  return {
    liftKey: row.exercise_name,
    score: row.strength_index,
    tier: tierForScore(row.strength_index),
    oneRM: row.estimated_1rm_kg,
    oneRMConfidence: 0.5,
    bodyweightRatio: row.relative_strength ?? 0,
    source: "accessory",
    appliedFactors: [],
    nextTier: null,
    flags: [],
    oneRMBandKg: null,
    trend: null,
    suggestion: null,
  };
}

function insightsFromStrengthScores(
  rows: StrengthScore[],
  isPremium: boolean
): GatedStrengthInsight[] {
  return rows
    .map((row) => {
      const result = strengthResultFromScoreRow(row);
      if (!result) return null;
      return {
        name: row.exercise_name,
        result: gateStrengthResult(result, isPremium),
      };
    })
    .filter((row): row is GatedStrengthInsight => row !== null);
}

/**
 * Per-exercise scores for a past gym session — prefers persisted
 * `strength_activities` on the workout score, falls back to `strength_scores`
 * rows so older sessions still show individual lift indexes.
 */
export function resolveStrengthInsights(
  breakdown: ScoreBreakdown,
  strengthScores: StrengthScore[] | null | undefined,
  isPremium: boolean
): GatedStrengthInsight[] | null {
  const fromBreakdown = extractGatedStrengthInsights(breakdown, isPremium);
  if (fromBreakdown?.length) return fromBreakdown;

  const fromRows = insightsFromStrengthScores(strengthScores ?? [], isPremium);
  return fromRows.length > 0 ? fromRows : null;
}

export function strengthIndexByExerciseName(
  insights: GatedStrengthInsight[] | null
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const row of insights ?? []) {
    map[row.name.toLowerCase()] = row.result.score;
  }
  return map;
}
