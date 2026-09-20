import type { SupabaseClient } from "@supabase/supabase-js";
import { parseActivityStreams, type ActivityStreams } from "./streams";

/**
 * How one of this run's best efforts stands against the athlete's history at
 * the same distance — the "PB" badge and the "12s faster than your previous
 * best" line. Read from the rank_best_efforts SQL function (migration 078).
 */
export interface BestEffortStanding {
  distanceMeters: number;
  elapsedSeconds: number;
  /** 1 = fastest ever; ties share a rank. */
  rank: number;
  /** How many runs have an effort at this distance, this one included. */
  attempts: number;
  bestElapsedSeconds: number;
  bestActivityId: string;
  bestAchievedAt: string;
  /** The best from runs that happened before this one; null when this was the first. */
  previousBestElapsedSeconds: number | null;
}

interface RankRow {
  distance_meters: number;
  elapsed_seconds: number | string;
  rank: number;
  attempts: number;
  best_elapsed_seconds: number | string;
  best_activity_id: string;
  best_achieved_at: string;
  previous_best_elapsed_seconds: number | string | null;
}

/** Ranks every best effort on `activityId` against the caller's own history. Empty on any failure — including a database without migration 078 — so the panel simply shows no badges. */
export async function fetchBestEffortStandings(
  supabase: SupabaseClient,
  activityId: string
): Promise<BestEffortStanding[]> {
  const { data, error } = await supabase.rpc("rank_best_efforts", { p_activity_id: activityId });
  if (error || !Array.isArray(data)) {
    if (error) console.error("[activities] rank_best_efforts failed:", error.message);
    return [];
  }
  return (data as RankRow[]).map((row) => ({
    distanceMeters: Number(row.distance_meters),
    elapsedSeconds: Number(row.elapsed_seconds),
    rank: Number(row.rank),
    attempts: Number(row.attempts),
    bestElapsedSeconds: Number(row.best_elapsed_seconds),
    bestActivityId: row.best_activity_id,
    bestAchievedAt: row.best_achieved_at,
    previousBestElapsedSeconds:
      row.previous_best_elapsed_seconds === null ? null : Number(row.previous_best_elapsed_seconds),
  }));
}

/**
 * Whether an activity has streams, without reading them.
 *
 * For the locked state of the analysis panel: a free account must be told
 * there is something behind the lock, but must not receive a byte of it. A
 * primary-key existence check answers exactly that question and returns no
 * analysis data at all. It also keeps the lock honest — a run recorded before
 * streams existed has no analysis to sell, so it gets no upsell.
 */
export async function activityHasStreams(
  supabase: SupabaseClient,
  activityId: string
): Promise<boolean> {
  const { data, error } = await supabase
    .from("activity_streams")
    .select("activity_id")
    .eq("activity_id", activityId)
    .maybeSingle();
  if (error) return false;
  return data !== null;
}

/** The stored streams for an activity, or null when there are none (a manual entry, a run recorded before streams existed, or a malformed row). */
export async function fetchActivityStreams(
  supabase: SupabaseClient,
  activityId: string
): Promise<ActivityStreams | null> {
  const { data, error } = await supabase
    .from("activity_streams")
    .select("streams")
    .eq("activity_id", activityId)
    .maybeSingle();
  if (error) {
    console.error("[activities] activity_streams read failed:", error.message);
    return null;
  }
  return data ? parseActivityStreams(data.streams) : null;
}
