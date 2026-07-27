import type { DuelMetric } from "./types";

export interface WorkoutScoreRow {
  user_id: string;
  load_score: number | null;
  created_at: string;
  /** Set only on cardio sessions (null for gym) — see activity-scorer.ts. */
  endurance_component: number | null;
  /** Set only on gym sessions (null for cardio) — see activity-scorer.ts. */
  strength_component: number | null;
}

/**
 * Aggregates raw workout_scores rows into each participant's duel standing
 * for the given metric: count of sessions, summed training load (AU), or
 * best single-session endurance/strength score during the window ("speed"/
 * "strength" — a "who's faster/stronger right now" comparison, not a
 * cumulative one, so logging more sessions doesn't itself win it). The
 * component columns are naturally sport-scoped already (endurance_component
 * is null on gym rows and vice versa), so a "strength" duel with no sport
 * filter still only ever compares gym sessions.
 */
export function aggregateDuelScores(
  rows: WorkoutScoreRow[],
  metric: DuelMetric,
  participantIds: [string, string]
): Record<string, number> {
  const totals: Record<string, number> = {
    [participantIds[0]]: 0,
    [participantIds[1]]: 0,
  };
  for (const row of rows) {
    if (!(row.user_id in totals)) continue;
    if (metric === "load") {
      totals[row.user_id] += Number(row.load_score ?? 0);
    } else if (metric === "sessions") {
      totals[row.user_id] += 1;
    } else if (metric === "speed") {
      totals[row.user_id] = Math.max(totals[row.user_id], Number(row.endurance_component ?? 0));
    } else if (metric === "strength") {
      totals[row.user_id] = Math.max(totals[row.user_id], Number(row.strength_component ?? 0));
    }
  }
  return totals;
}

/** Exclusive upper timestamp bound for a duel's DATE end_date, so the whole end day counts (a DATE column has no time component to compare against created_at directly). */
export function duelWindowEndExclusive(endDate: string): string {
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return end.toISOString();
}

/** Null while tied, or before the duel has any standings to compare. */
export function pickLeader(
  challengerId: string,
  challengerScore: number,
  opponentId: string,
  opponentScore: number
): string | null {
  if (challengerScore === opponentScore) return null;
  return challengerScore > opponentScore ? challengerId : opponentId;
}
