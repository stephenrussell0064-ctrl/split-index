import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE RULER for "best ever" 1RM.
 *
 * ---------------------------------------------------------------------------
 * THE TWO COLUMNS
 * ---------------------------------------------------------------------------
 * `estimated_1rm_kg` exists on two tables, written by two different rules:
 *
 *   gym_exercises.estimated_1rm_kg   computeExercise1RM(topSet.weight_kg,
 *                                    topSet.reps) — raw Epley over the flat
 *                                    best-set summary, written at log time.
 *   strength_scores.estimated_1rm_kg the scoring engine's own e1RM, written
 *                                    when the session is scored.
 *
 * They are not two estimates of the same number. The engine's figure resolves
 * the weight MODE (per-hand dumbbells and single-arm cable work are not the
 * load on the bar), folds bodyweight into calisthenics before expressing the
 * result back in added-weight terms, honours reps-in-reserve, and converts reps
 * on the published table the population anchors were built from rather than on
 * Epley. The flat column does none of that — it cannot, because it has neither
 * the athlete's bodyweight nor the per-set detail.
 *
 * Measured on real logged sessions, same exercise, same session:
 *
 *   Single Arm Pushdown      gym_exercises  16.5kg   engine    8.0kg   +106%
 *   Incline Dumbbell Press   gym_exercises  57.0kg   engine  111.1kg    -49%
 *   Weighted Pull Up         gym_exercises  44.3kg   engine   61.5kg    -28%
 *   Bench Press              gym_exercises 132.0kg   engine  123.5kg     +7%
 *
 * ---------------------------------------------------------------------------
 * WHY THAT MATTERED
 * ---------------------------------------------------------------------------
 * The Lab and Analytics pages both computed an athlete's all-time best per lift
 * as `Math.max(<gym_exercises figure>, <engine figure>, ...)`. Across two
 * rulers that is a ratchet: it takes the larger number whichever rule produced
 * it, so it cannot go down when the engine is corrected. The single-arm
 * pushdown above is the sharpest case — the movement whose curve was
 * deliberately reshaped, still reporting double the engine's figure because the
 * flat column reads a single-arm load as if it were the whole stack.
 *
 * The cross-user exercise leaderboard (lib/social/dimension-leaderboards.ts)
 * has always read strength_scores. So an athlete's own "best ever" and the
 * ranking they were placed in came off different rulers.
 *
 * Everything here therefore reads strength_scores. Verified against production
 * before the switch: every gym_exercises entry has a matching strength_scores
 * row (66 of 66), and no strength_scores row belongs to a draft — the create
 * path writes is_draft: false, so a scored session is never a draft and
 * filtering on user_id alone is equivalent to the activities join these call
 * sites used to do.
 *
 * gym_exercises.estimated_1rm_kg is still written and still read by
 * api/gym-exercises/history (which shows what a past session estimated at the
 * time, deliberately unrescored). It must not be used for anything comparative.
 */

export interface AllTimeLiftRow {
  exercise_name: string;
  estimated_1rm_kg: number | null;
}

/**
 * Every scored lift this athlete has ever logged, with the engine's 1RM.
 *
 * Shaped as `{ exercise_name, estimated_1rm_kg }` so it drops straight into
 * `calculateOverallDotsGl`, which only ever wanted the best e1RM per SBD lift
 * and is indifferent to which table supplied it.
 */
export async function fetchAllTimeLiftRows(
  supabase: SupabaseClient,
  userId: string
): Promise<AllTimeLiftRow[]> {
  const { data } = await supabase
    .from("strength_scores")
    .select("exercise_name, estimated_1rm_kg")
    .eq("user_id", userId);

  return (data ?? []) as AllTimeLiftRow[];
}

/**
 * Best-ever 1RM per lift, keyed however the caller needs.
 *
 * `keyOf` differs by page — the Lab keys by resolved anchor key so free-text
 * names line up with canonical lift keys, Analytics keys by normalized name,
 * training goals key by the raw name a goal was written against — so it is the
 * caller's, but the max-per-key reduction is not, and duplicating it is how the
 * two pages drifted in the first place.
 */
export function bestOneRmByKey(
  rows: AllTimeLiftRow[],
  keyOf: (exerciseName: string) => string
): Map<string, number> {
  const best = new Map<string, number>();
  for (const row of rows) {
    const value = row.estimated_1rm_kg ?? 0;
    if (value <= 0) continue;
    const key = keyOf(row.exercise_name);
    best.set(key, Math.max(best.get(key) ?? 0, value));
  }
  return best;
}
