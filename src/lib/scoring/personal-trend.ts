import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The athlete's own recent personal scores for one sport, oldest first.
 *
 * The number this feeds is the only one in the app that means "against
 * yourself", and until now it was shown once, for one session, and then thrown
 * away. Its whole point is the shape it makes over a block — a score that
 * centres on your own median cannot say "you are getting fitter" from a single
 * reading, because the baseline moves with you. Several readings can.
 *
 * ONE SPORT AT A TIME, deliberately. The personal score compares like with
 * like; mixing a run and a row onto one line would draw a trend across two
 * different baselines and invite exactly the reading it is not entitled to.
 *
 * DEGRADABLE, for the same reason `fetchScoreMap` is: `personal_index` arrived
 * with migration 077, and a sheet that 500s because one additive column is
 * missing is worse than a sheet with no chart on it. See
 * lib/activities/degradable-write.ts for the same rule on the write side.
 */

export interface PersonalTrendPoint {
  /** ISO date of the session. */
  at: string;
  /** Personal score on the stored 0–1000 scale; the caller formats it. */
  score: number;
}

export const PERSONAL_TREND_MAX_POINTS = 30;

/** Postgres's "column does not exist", which is what a stale schema answers. */
function missingPersonalIndex(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42703" || /personal_index/i.test(error.message ?? "");
}

export async function fetchPersonalTrend(
  supabase: SupabaseClient,
  userId: string,
  sport: string,
  limit: number = PERSONAL_TREND_MAX_POINTS
): Promise<{ points: PersonalTrendPoint[]; error: string | null }> {
  const rows = await supabase
    .from("activities")
    .select("started_at, workout_scores(personal_index)")
    .eq("user_id", userId)
    .eq("sport", sport)
    .order("started_at", { ascending: false })
    // Over-fetch: sessions with no comparable history carry a null score and
    // are dropped below, so asking for exactly `limit` rows would return fewer
    // than `limit` points whenever the athlete has any.
    .limit(Math.min(limit * 3, 150));

  if (rows.error) {
    // A stale schema is not an error worth failing the sheet over — the rest of
    // it explains the score perfectly well without a chart.
    if (missingPersonalIndex(rows.error)) return { points: [], error: null };
    return { points: [], error: rows.error.message };
  }

  type Row = {
    started_at: string;
    // Supabase types an embedded one-to-many as an array even where a unique
    // constraint makes it one row, so both shapes are read rather than cast.
    workout_scores: { personal_index: number | null } | { personal_index: number | null }[] | null;
  };

  const points: PersonalTrendPoint[] = [];
  for (const row of (rows.data ?? []) as unknown as Row[]) {
    const scores = Array.isArray(row.workout_scores) ? row.workout_scores : [row.workout_scores];
    const personal = scores.find((s) => s && typeof s.personal_index === "number");
    if (!personal || typeof personal.personal_index !== "number") continue;
    if (!row.started_at) continue;
    points.push({ at: row.started_at, score: personal.personal_index });
    if (points.length >= limit) break;
  }

  // Oldest first: a trend line is read left to right, and the query had to be
  // newest-first to take the most recent `limit` rather than the oldest.
  points.reverse();
  return { points, error: null };
}
