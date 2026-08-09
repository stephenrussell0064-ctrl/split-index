/**
 * Race records — user feedback: "why is IPF GL and DOTS scores not there as
 * well as current race records" flagged that analytics had no distance-
 * specific personal-best ladder. The `personal_records` table only ever
 * stores one `benchmark_time` PR per sport (a single Riegel-normalized
 * number — see personal-records.ts), not a real best-time-per-distance
 * ladder. This builds that ladder directly from the athlete's own logged
 * activities instead of adding a new table: for each standard race
 * distance, find the fastest logged effort within a tolerance band of it.
 *
 * Deliberately not restricted to `session_type === "race"` — a runner's
 * true 5K best often comes from a hard training run they never tagged as a
 * race, and requiring the tag would leave the ladder mostly empty for most
 * users. `isRace` is still reported per record so the UI can badge it.
 */

export interface RaceRecordInput {
  distanceMeters: number | null;
  durationSeconds: number | null;
  startedAt: string;
  sessionType?: string | null;
}

export interface RaceRecord {
  label: string;
  distanceMeters: number;
  bestSeconds: number;
  achievedAt: string;
  isRace: boolean;
}

/** Same four distances offered as quick-picks when adding an upcoming race (upcoming-races-panel.tsx's COMMON_DISTANCES) — the most universally recognized road-race lengths. */
export const STANDARD_RACE_DISTANCES: Array<{ label: string; meters: number }> = [
  { label: "5K", meters: 5000 },
  { label: "10K", meters: 10000 },
  { label: "Half Marathon", meters: 21097 },
  { label: "Marathon", meters: 42195 },
];

/** How far a logged activity's distance may drift from a standard race distance and still count toward that distance's record — matches DISTANCE_MATCH_TOLERANCE_FRACTION already used for course-difficulty matching in /api/races. */
const DISTANCE_MATCH_TOLERANCE_FRACTION = 0.1;

export function computeRaceRecords(activities: RaceRecordInput[]): RaceRecord[] {
  const records: RaceRecord[] = [];

  for (const standard of STANDARD_RACE_DISTANCES) {
    let best: { seconds: number; achievedAt: string; isRace: boolean } | null = null;

    for (const a of activities) {
      if (a.distanceMeters == null || a.durationSeconds == null || a.durationSeconds <= 0) continue;
      const drift = Math.abs(a.distanceMeters - standard.meters) / standard.meters;
      if (drift > DISTANCE_MATCH_TOLERANCE_FRACTION) continue;

      if (!best || a.durationSeconds < best.seconds) {
        best = {
          seconds: a.durationSeconds,
          achievedAt: a.startedAt,
          isRace: a.sessionType === "race",
        };
      }
    }

    if (best) {
      records.push({
        label: standard.label,
        distanceMeters: standard.meters,
        bestSeconds: best.seconds,
        achievedAt: best.achievedAt,
        isRace: best.isRace,
      });
    }
  }

  return records;
}
