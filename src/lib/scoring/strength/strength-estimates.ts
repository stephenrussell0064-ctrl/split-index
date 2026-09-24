import { normalizeName, type ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";
import type { StrengthEstimate } from "@/components/analytics/types";

/** One row of the `latest_strength_scores` RPC — the most recent scored session per exercise. */
export interface LatestStrengthScoreRow {
  exercise_name: string;
  estimated_1rm_kg: number;
  score_breakdown: { strength_result?: ScoreStrengthResult } | null;
  recorded_at: string;
}

/**
 * One adaptive-1RM estimate per lift, from the latest scored session for each.
 *
 * Extracted from the analytics page so the Hybrid Athlete Report can show the
 * same lifts with the same numbers — two copies of this mapping would be two
 * chances to disagree about an athlete's bench.
 *
 * `allTime1RmByLift` is keyed by `normalizeName(exerciseName)` — the best ever
 * mined from every scored lift (bestOneRmByKey in all-time-one-rm.ts). The
 * engine only sees the most recent 200 sessions, so a high-water mark that
 * forgets anything older is not a high-water mark; the max of every source
 * that could hold the real best is taken, and all three are the engine's own
 * figure so the comparison is like with like.
 */
export function buildStrengthEstimates(
  rows: LatestStrengthScoreRow[],
  allTime1RmByLift: Map<string, number>
): StrengthEstimate[] {
  const byLift = new Map<string, StrengthEstimate>();
  for (const row of rows) {
    const name = row.exercise_name;
    // The RPC already returns one row per exercise; a defensive no-op if that ever changes.
    if (byLift.has(name)) continue;
    const result = row.score_breakdown?.strength_result;
    const estimated1RmKg = row.estimated_1rm_kg;
    byLift.set(name, {
      exerciseName: name,
      estimated1RmKg,
      allTime1RmKg: Math.max(
        allTime1RmByLift.get(normalizeName(name)) ?? 0,
        result?.allTimeOneRM ?? 0,
        estimated1RmKg
      ),
      current1RmKg: result?.currentOneRM ?? estimated1RmKg,
      trend: result?.trend ?? undefined,
      confidence: result?.oneRMConfidence,
      bandKg: result?.oneRMBandKg ?? undefined,
      recordedAt: row.recorded_at,
    });
  }
  return Array.from(byLift.values());
}
