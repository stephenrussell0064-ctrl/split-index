import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreBreakdown, SessionType, SportType } from "@/types";

export type TimelineDomain = "strength" | "cardio";

export interface TimelineSession {
  activityId: string;
  sport: SportType;
  domain: TimelineDomain;
  startedAt: string;
  durationSeconds: number;
  sessionType: SessionType | null;
  avgHeartRate: number | null;
  avgPaceSecondsPerKm: number | null;
  /** Domain-blind AU unit — TRIMP-based for cardio, volume-based for strength (engine.ts). */
  loadScore: number | null;
  /** Set only on cardio sessions (null on strength). */
  enduranceComponent: number | null;
  /** Set only on strength sessions (null on cardio). */
  strengthComponent: number | null;
  /** Pace(m/min):HR ratio — null unless the session had HR data (cardio-activity.ts). */
  efficiencyFactor: number | null;
}

export function domainForSport(sport: SportType): TimelineDomain {
  return sport === "gym" ? "strength" : "cardio";
}

/**
 * Interference-engine brief, Part 0: a single call returning every session
 * (both strength and cardio) for a user in a date range, sorted by
 * timestamp. `activities` and `workout_scores` already both span both
 * domains keyed by user_id + started_at + sport — there was no separate
 * per-domain table to unify. This formalizes the query as one shared,
 * reusable source of truth (an embedded PostgREST join in a single round
 * trip) so the interference engine, readiness score, and "Today" card all
 * read from the same place instead of each re-deriving their own fetch.
 */
export async function getCrossDomainTimeline(
  supabase: SupabaseClient,
  userId: string,
  range: { since: string; until?: string }
): Promise<TimelineSession[]> {
  let query = supabase
    .from("activities")
    .select(
      "id, sport, started_at, duration_seconds, session_type, avg_heart_rate, avg_pace_seconds_per_km, workout_scores(load_score, endurance_component, strength_component, score_breakdown)"
    )
    .eq("user_id", userId)
    .eq("is_draft", false)
    .gte("started_at", range.since)
    .order("started_at", { ascending: true });

  if (range.until) {
    query = query.lte("started_at", range.until);
  }

  const { data } = await query;

  return (data ?? []).map((row): TimelineSession => {
    const rawScore = row.workout_scores as unknown;
    const ws = (Array.isArray(rawScore) ? rawScore[0] : rawScore) as
      | {
          load_score: number | null;
          endurance_component: number | null;
          strength_component: number | null;
          score_breakdown: unknown;
        }
      | null
      | undefined;
    const breakdown = (ws?.score_breakdown ?? null) as ScoreBreakdown | null;
    const cardioActivity = breakdown?.cardio_activity as
      | { efficiencyFactor?: number | null }
      | undefined;

    const sport = row.sport as SportType;
    return {
      activityId: row.id as string,
      sport,
      domain: domainForSport(sport),
      startedAt: row.started_at as string,
      durationSeconds: row.duration_seconds as number,
      sessionType: (row.session_type as SessionType | null) ?? null,
      avgHeartRate: (row.avg_heart_rate as number | null) ?? null,
      avgPaceSecondsPerKm: (row.avg_pace_seconds_per_km as number | null) ?? null,
      loadScore: ws?.load_score ?? null,
      enduranceComponent: ws?.endurance_component ?? null,
      strengthComponent: ws?.strength_component ?? null,
      efficiencyFactor: cardioActivity?.efficiencyFactor ?? null,
    };
  });
}
