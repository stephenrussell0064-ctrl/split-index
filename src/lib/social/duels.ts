import type { DuelMetric } from "./types";

export interface WorkoutScoreRow {
  user_id: string;
  load_score: number | null;
  created_at: string;
}

/** Aggregates raw workout_scores rows into each participant's duel standing for the given metric — count of sessions logged, or summed training load (AU). */
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
    totals[row.user_id] += metric === "load" ? Number(row.load_score ?? 0) : 1;
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
