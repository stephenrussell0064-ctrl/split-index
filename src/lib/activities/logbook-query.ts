import type { SupabaseClient } from "@supabase/supabase-js";
import { parseRoutePolyline, type RoutePoint } from "@/lib/scoring/gps-track";

/**
 * The logbook's single data source.
 *
 * Every surface that lists activities — the full logbook at /activities, The
 * Lab's session history, The Engine's session history, and the paging API
 * behind all three — reads through here. Before this existed each page ran
 * its own hand-rolled query with its own arbitrary `.limit()` (8, then 20,
 * then 50), which is exactly how the logbook ended up "silently cut off":
 * there was no shared notion of "there are more, here is how you get them".
 *
 * The contract is deliberately page-shaped rather than list-shaped — an
 * entry page always says how many rows match the filters in total and
 * whether more exist, so the UI can show "24 of 312" instead of pretending
 * the truncated slice is the whole history.
 */

export const LOGBOOK_PAGE_SIZE = 25;
/** How many rows an embedded zone-page logbook opens with before paging. */
export const LOGBOOK_ZONE_PAGE_SIZE = 12;

export type LogbookZone = "all" | "gym" | "cardio";
export type LogbookSort = "recent" | "oldest";
export type ActivityZone = "gym" | "cardio";

export interface LogbookEntry {
  id: string;
  sport: string;
  title: string | null;
  startedAt: string;
  durationSeconds: number | null;
  distanceMeters: number | null;
  elevationMeters: number | null;
  avgHeartRate: number | null;
  avgPaceSecondsPerKm: number | null;
  avgSplitSeconds: number | null;
  sessionType: string | null;
  /** Which half of the app this session belongs to — everything non-gym is The Engine. */
  zone: ActivityZone;
  /** Session index (0–1000 internal scale), or null when the session was never scored. */
  score: number | null;
  /** Present only for runs recorded by Split Index's own GPS tracker. */
  route: RoutePoint[] | null;
  /** Gym sessions only — what was actually done, so a Lab row isn't just a date and a duration. */
  gymSummary: { exercises: number; sets: number; volumeKg: number } | null;
}

export interface LogbookPage {
  entries: LogbookEntry[];
  /** Rows matching the current filters, across the whole history — not this page. */
  total: number;
  hasMore: boolean;
  nextOffset: number;
}

export interface LogbookQueryOptions {
  zone?: LogbookZone;
  /** A single sport id (e.g. "running"), or null for every sport in the zone. */
  sport?: string | null;
  sort?: LogbookSort;
  offset?: number;
  limit?: number;
}

/** Sessions logged per sport, across the athlete's whole history. Drives the filter chips' counts and which sports are offered at all. */
export type LogbookSportCounts = Record<string, number>;

const ENTRY_COLUMNS =
  "id, sport, title, started_at, duration_seconds, distance_meters, elevation_meters, avg_heart_rate, avg_pace_seconds_per_km, avg_split_seconds, session_type, source, metadata";

export function zoneOf(sport: string): ActivityZone {
  return sport === "gym" ? "gym" : "cardio";
}

export function parseZone(value: string | null | undefined): LogbookZone {
  return value === "gym" || value === "cardio" ? value : "all";
}

export function parseSort(value: string | null | undefined): LogbookSort {
  return value === "oldest" ? "oldest" : "recent";
}

/**
 * One page of the logbook, newest first by default.
 *
 * Filtering and ordering happen in Postgres, never on an already-truncated
 * client-side slice — a filter that only searched the rows already loaded
 * would reintroduce the exact "where did the rest of my history go" problem
 * this module exists to fix.
 */
export async function fetchLogbookPage(
  supabase: SupabaseClient,
  userId: string,
  options: LogbookQueryOptions = {}
): Promise<LogbookPage> {
  const zone = options.zone ?? "all";
  const sort = options.sort ?? "recent";
  const offset = Math.max(0, options.offset ?? 0);
  const limit = Math.min(100, Math.max(1, options.limit ?? LOGBOOK_PAGE_SIZE));

  let query = supabase
    .from("activities")
    .select(ENTRY_COLUMNS, { count: "exact" })
    .eq("user_id", userId)
    .eq("is_draft", false);

  if (zone === "gym") query = query.eq("sport", "gym");
  if (zone === "cardio") query = query.neq("sport", "gym");
  // A sport filter is always narrower than its zone, so it simply wins.
  if (options.sport) query = query.eq("sport", options.sport);

  const {
    data: rows,
    count,
    error,
  } = await query
    .order("started_at", { ascending: sort === "oldest" })
    .range(offset, offset + limit - 1);

  if (error) throw new Error(error.message);

  const activities = rows ?? [];
  const ids = activities.map((a) => a.id as string);

  const [scoreMap, gymSummaries] = await Promise.all([
    fetchScoreMap(supabase, ids),
    fetchGymSummaries(
      supabase,
      activities.filter((a) => a.sport === "gym").map((a) => a.id as string)
    ),
  ]);

  const entries: LogbookEntry[] = activities.map((a) => {
    const id = a.id as string;
    const sport = a.sport as string;
    return {
      id,
      sport,
      title: (a.title as string | null) ?? null,
      startedAt: a.started_at as string,
      durationSeconds: (a.duration_seconds as number | null) ?? null,
      distanceMeters: (a.distance_meters as number | null) ?? null,
      elevationMeters: (a.elevation_meters as number | null) ?? null,
      avgHeartRate: (a.avg_heart_rate as number | null) ?? null,
      avgPaceSecondsPerKm: (a.avg_pace_seconds_per_km as number | null) ?? null,
      avgSplitSeconds: (a.avg_split_seconds as number | null) ?? null,
      sessionType: (a.session_type as string | null) ?? null,
      zone: zoneOf(sport),
      score: scoreMap[id] ?? null,
      // Parsed server-side rather than in the client so a malformed stored
      // value can never reach a render, and null-checked so imported or
      // manually logged runs simply have no map rather than an empty box.
      route:
        a.source === "gps"
          ? parseRoutePolyline((a.metadata as { route?: unknown } | null)?.route)
          : null,
      gymSummary: gymSummaries[id] ?? null,
    };
  });

  const total = count ?? entries.length;
  const nextOffset = offset + entries.length;

  return { entries, total, hasMore: nextOffset < total, nextOffset };
}

async function fetchScoreMap(
  supabase: SupabaseClient,
  activityIds: string[]
): Promise<Record<string, number>> {
  if (activityIds.length === 0) return {};
  const { data } = await supabase
    .from("workout_scores")
    .select("activity_id, sport_index")
    .in("activity_id", activityIds);
  return Object.fromEntries(
    (data ?? []).map((s) => [s.activity_id as string, s.sport_index as number])
  );
}

/**
 * What a gym session actually contained. Without this a Lab row reads
 * "12 Aug · 58m · 71.2" — three numbers, none of which say whether it was a
 * leg day or twenty minutes of curls.
 */
async function fetchGymSummaries(
  supabase: SupabaseClient,
  gymActivityIds: string[]
): Promise<Record<string, { exercises: number; sets: number; volumeKg: number }>> {
  if (gymActivityIds.length === 0) return {};
  const { data } = await supabase
    .from("gym_exercises")
    .select("activity_id, sets, reps, weight_kg")
    .in("activity_id", gymActivityIds);

  const summaries: Record<string, { exercises: number; sets: number; volumeKg: number }> = {};
  for (const row of data ?? []) {
    const id = row.activity_id as string;
    const summary = (summaries[id] ??= { exercises: 0, sets: 0, volumeKg: 0 });
    const sets = (row.sets as number | null) ?? 0;
    const reps = (row.reps as number | null) ?? 0;
    const weight = (row.weight_kg as number | null) ?? 0;
    summary.exercises += 1;
    summary.sets += sets;
    summary.volumeKg += sets * reps * weight;
  }
  return summaries;
}

/**
 * Sessions per sport across the entire history. One narrow single-column
 * scan rather than a count query per chip — the numbers on the filter chips
 * are the whole point of the redesign's "you have 312 sessions, here is how
 * to reach all of them" promise, so they must reflect everything, not the
 * currently loaded page.
 */
export async function fetchLogbookSportCounts(
  supabase: SupabaseClient,
  userId: string
): Promise<LogbookSportCounts> {
  const { data } = await supabase
    .from("activities")
    .select("sport")
    .eq("user_id", userId)
    .eq("is_draft", false);

  const counts: LogbookSportCounts = {};
  for (const row of data ?? []) {
    const sport = row.sport as string;
    counts[sport] = (counts[sport] ?? 0) + 1;
  }
  return counts;
}

/** Zone totals derived from the per-sport counts — no extra round trip. */
export function zoneTotals(counts: LogbookSportCounts): {
  all: number;
  gym: number;
  cardio: number;
} {
  let gym = 0;
  let cardio = 0;
  for (const [sport, n] of Object.entries(counts)) {
    if (sport === "gym") gym += n;
    else cardio += n;
  }
  return { all: gym + cardio, gym, cardio };
}
