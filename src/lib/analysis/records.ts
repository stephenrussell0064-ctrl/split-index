import type { SupabaseClient } from "@supabase/supabase-js";
import type { SportType } from "@/types";
import { bestEffortLabel } from "./best-efforts";
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
 * The athlete's fastest ever effort at one distance, wherever it happened.
 *
 * Deliberately a different thing from the race records already on the
 * analytics page. Those are the best WHOLE logged activity at a distance: you
 * ran a 5K race, that is your 5K. This is the fastest STRETCH of that distance
 * inside any session, so the quick 5K buried in the middle of a long run
 * counts. Most athletes' genuine best at a short distance is of the second
 * kind, which is why it is worth showing both rather than folding one into the
 * other.
 */
export interface PersonalBestEffort {
  sport: SportType;
  distanceMeters: number;
  /** "5K", "1 mile", "Half marathon" — the same names the per-run panel uses. */
  label: string;
  elapsedSeconds: number;
  paceSecondsPerKm: number;
  activityId: string;
  achievedAt: string;
  /** Sessions containing an effort at this distance. One means this is a first, not yet a record. */
  attempts: number;
}

interface BestEffortRow {
  sport: string;
  distance_meters: number;
  elapsed_seconds: number | string;
  activity_id: string;
  achieved_at: string;
  attempts: number;
}

/**
 * Every distance the athlete has ever covered, with their fastest at each.
 *
 * Reads the personal_best_efforts SQL function (migration 079) rather than
 * selecting and reducing, because PostgREST cannot express "one row per
 * distance" and a row-limited fetch silently loses whole distances from a
 * prolific athlete's history. Empty on any failure, including a database
 * without the migration, so the panel renders its own empty state instead of
 * the page failing.
 */
export async function fetchPersonalBestEfforts(
  supabase: SupabaseClient
): Promise<PersonalBestEffort[]> {
  const { data, error } = await supabase.rpc("personal_best_efforts");
  if (error || !Array.isArray(data)) {
    if (error) console.error("[analysis] personal_best_efforts failed:", error.message);
    return [];
  }
  return (data as BestEffortRow[])
    .map((row) => {
      const sport = row.sport as SportType;
      const distanceMeters = Number(row.distance_meters);
      const elapsedSeconds = Number(row.elapsed_seconds);
      return {
        sport,
        distanceMeters,
        label: bestEffortLabel(sport, distanceMeters),
        elapsedSeconds,
        paceSecondsPerKm:
          distanceMeters > 0 ? Math.round((elapsedSeconds / distanceMeters) * 1000 * 10) / 10 : 0,
        activityId: row.activity_id,
        achievedAt: row.achieved_at,
        attempts: Number(row.attempts),
      };
    })
    .filter((e) => e.distanceMeters > 0 && e.elapsedSeconds > 0);
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
