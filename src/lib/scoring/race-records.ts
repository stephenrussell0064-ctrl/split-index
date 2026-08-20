/**
 * Race records — user feedback: "why is IPF GL and DOTS scores not there as
 * well as current race records" flagged that analytics had no distance-
 * specific personal-best ladder. The `personal_records` table only ever
 * stores one `benchmark_time` PR per sport (a single Riegel-normalized
 * number — see personal-records.ts), not a real best-time-per-distance
 * ladder. This builds that ladder directly from the athlete's own logged
 * activities instead of adding a new table: for each standard race
 * distance, find the fastest logged effort that actually covered it.
 *
 * A record is only ever a distance the athlete genuinely covered. An effort
 * that stopped short of the distance is not evidence of a time at it, no
 * matter how close it came, and projecting one (Riegel or otherwise) would
 * make this a prediction wearing a record's label — the Race Ladder in
 * Stored Predictions is where projections belong, clearly named as such.
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

/**
 * How far PAST a standard race distance a logged activity may run and still
 * count toward that distance's record — matches
 * DISTANCE_MATCH_TOLERANCE_FRACTION already used for course-difficulty
 * matching in /api/races.
 *
 * One-sided on purpose. The band used to be symmetric, which quietly
 * credited under-distance efforts: a 20 km long run is only 5.2% short of
 * the half, so its raw 20 km duration was published as a half-marathon PR
 * for athletes who had never run one. Over-distance is admitted because an
 * athlete who covered 22 km demonstrably passed 21.0975 km at some point
 * within that time, so the full duration is a true (if conservative) bound
 * on their half; under-distance demonstrates nothing at all.
 */
const OVER_DISTANCE_TOLERANCE_FRACTION = 0.1;

export function computeRaceRecords(activities: RaceRecordInput[]): RaceRecord[] {
  const records: RaceRecord[] = [];

  for (const standard of STANDARD_RACE_DISTANCES) {
    let best: { seconds: number; achievedAt: string; isRace: boolean } | null = null;

    for (const a of activities) {
      if (a.distanceMeters == null || a.durationSeconds == null || a.durationSeconds <= 0) continue;
      if (a.distanceMeters < standard.meters) continue;
      const overshoot = (a.distanceMeters - standard.meters) / standard.meters;
      if (overshoot > OVER_DISTANCE_TOLERANCE_FRACTION) continue;

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
