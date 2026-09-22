import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The athlete's own recent scores for one score, in one sport or one lift,
 * oldest first — the series behind every tap-to-explain sheet.
 *
 * FOUR SERIES, TWO SHAPES. A cardio session's two numbers live on
 * `workout_scores` beside the activity that produced them; a lift's live on
 * `strength_scores`, one row per exercise per session. Everything after the
 * query is identical, which is why it is one module and not two.
 *
 * ONE SPORT, OR ONE LIFT, AT A TIME. The personal score compares like with
 * like, so mixing a run and a row onto one line would draw a trend across two
 * baselines. The standards scores are comparable across sports in principle,
 * but a bench and a squat sit on different anchors and an athlete reading one
 * line would not know which.
 *
 * DEGRADABLE ON `personal_index` ONLY. That column arrived with migration 077;
 * `sport_index` and `strength_index` have been there since 002. A sheet that
 * 500s because one additive column is missing is worse than a sheet with no
 * chart on it. See lib/activities/degradable-write.ts for the same rule on the
 * write side.
 */

export interface ScoreTrendPoint {
  /** ISO timestamp of the session. */
  at: string;
  /** Score on the stored 0–1000 scale; the caller formats it. */
  score: number;
}

export const SCORE_TREND_MAX_POINTS = 30;

/** Which of a session's numbers to plot. */
export type CardioMetric = "personal" | "population";
export type StrengthMetric = "personal" | "population";

const CARDIO_COLUMN: Record<CardioMetric, string> = {
  personal: "personal_index",
  population: "sport_index",
};
const STRENGTH_COLUMN: Record<StrengthMetric, string> = {
  personal: "personal_index",
  population: "strength_index",
};

/** Postgres's "column does not exist", which is what a pre-077 schema answers. */
function missingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  if (!error) return false;
  return error.code === "42703" || new RegExp(column, "i").test(error.message ?? "");
}

/**
 * Over-fetch factor. Sessions with no comparable history carry a null personal
 * score and are dropped, so asking for exactly `limit` rows would return fewer
 * than `limit` points on any log containing one — which is most logs.
 */
const OVERFETCH = 3;
const MAX_ROWS = 150;

interface Fetched {
  points: ScoreTrendPoint[];
  error: string | null;
}

/** Newest-first rows in, oldest-first points out. A chart is read left to right. */
function toPoints(
  rows: Array<{ at: unknown; value: unknown }>,
  limit: number
): ScoreTrendPoint[] {
  const points: ScoreTrendPoint[] = [];
  for (const row of rows) {
    if (typeof row.value !== "number" || typeof row.at !== "string" || !row.at) continue;
    points.push({ at: row.at, score: row.value });
    if (points.length >= limit) break;
  }
  points.reverse();
  return points;
}

export async function fetchCardioScoreTrend(
  supabase: SupabaseClient,
  userId: string,
  sport: string,
  metric: CardioMetric = "personal",
  limit: number = SCORE_TREND_MAX_POINTS
): Promise<Fetched> {
  const column = CARDIO_COLUMN[metric];
  const rows = await supabase
    .from("activities")
    .select(`started_at, workout_scores(${column})`)
    .eq("user_id", userId)
    .eq("sport", sport)
    .order("started_at", { ascending: false })
    .limit(Math.min(limit * OVERFETCH, MAX_ROWS));

  if (rows.error) {
    if (metric === "personal" && missingColumn(rows.error, column)) return { points: [], error: null };
    return { points: [], error: rows.error.message };
  }

  type Row = {
    started_at: string;
    // PostgREST types an embedded relation as an array even where a unique
    // constraint makes it one row, and the shape has differed between client
    // versions, so both are read rather than cast.
    workout_scores: Record<string, unknown> | Record<string, unknown>[] | null;
  };

  const flat = ((rows.data ?? []) as unknown as Row[]).map((row) => {
    const scores = Array.isArray(row.workout_scores) ? row.workout_scores : [row.workout_scores];
    const hit = scores.find((s) => s && typeof s[column] === "number");
    return { at: row.started_at, value: hit ? hit[column] : null };
  });

  return { points: toPoints(flat, limit), error: null };
}

export async function fetchStrengthScoreTrend(
  supabase: SupabaseClient,
  userId: string,
  exerciseName: string,
  metric: StrengthMetric = "population",
  limit: number = SCORE_TREND_MAX_POINTS
): Promise<Fetched> {
  const column = STRENGTH_COLUMN[metric];
  const rows = await supabase
    .from("strength_scores")
    .select(`recorded_at, ${column}`)
    .eq("user_id", userId)
    // Case-insensitive: the same lift reaches this table as "Bench Press" and
    // "bench press" depending on where it was logged, and a case-sensitive
    // match would silently draw half an athlete's history.
    .ilike("exercise_name", exerciseName)
    .order("recorded_at", { ascending: false })
    .limit(Math.min(limit * OVERFETCH, MAX_ROWS));

  if (rows.error) {
    if (metric === "personal" && missingColumn(rows.error, column)) return { points: [], error: null };
    return { points: [], error: rows.error.message };
  }

  const flat = ((rows.data ?? []) as unknown as Array<Record<string, unknown>>).map((row) => ({
    at: row.recorded_at,
    value: row[column],
  }));

  return { points: toPoints(flat, limit), error: null };
}
