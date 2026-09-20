import type { SportType } from "@/types";
import { meanOver, totalDistanceMeters, type ActivityStreams } from "./streams";
import { METERS_PER_MILE } from "./splits";

/**
 * Best efforts — the fastest stretch of each standard distance inside a run.
 *
 * A 10K contains a 5K, and the athlete's fastest-ever 5K is quite often the
 * middle of a longer run rather than a race. Strava calls these "best
 * efforts" and Garmin "personal records"; they are what a runner means by
 * "PB" for a distance, and they are only computable from a per-sample stream.
 */
export interface BestEffortDistance {
  meters: number;
  label: string;
}

/** On foot: the distances runners quote times over. */
const RUN_DISTANCES: readonly BestEffortDistance[] = [
  { meters: 400, label: "400m" },
  { meters: 800, label: "800m" },
  { meters: 1000, label: "1K" },
  { meters: METERS_PER_MILE, label: "1 mile" },
  { meters: 3000, label: "3K" },
  { meters: 5000, label: "5K" },
  { meters: 10_000, label: "10K" },
  { meters: 15_000, label: "15K" },
  { meters: 10 * METERS_PER_MILE, label: "10 miles" },
  { meters: 21_097.5, label: "Half marathon" },
  { meters: 30_000, label: "30K" },
  { meters: 42_195, label: "Marathon" },
];

/** On a bike the interesting distances are longer. */
const RIDE_DISTANCES: readonly BestEffortDistance[] = [
  { meters: 1000, label: "1K" },
  { meters: 5000, label: "5K" },
  { meters: 10_000, label: "10K" },
  { meters: 20_000, label: "20K" },
  { meters: 40_000, label: "40K" },
  { meters: 50_000, label: "50K" },
  { meters: 100_000, label: "100K" },
];

export function bestEffortDistancesFor(sport: SportType): readonly BestEffortDistance[] {
  return sport === "outdoor_cycling" ? RIDE_DISTANCES : RUN_DISTANCES;
}

/** The whole-metre key a distance is stored under — one rounding, shared by write and read, so a mile is 1609 on both sides. */
export function bestEffortDistanceKey(meters: number): number {
  return Math.round(meters);
}

export function bestEffortLabel(sport: SportType, distanceMeters: number): string {
  const key = bestEffortDistanceKey(distanceMeters);
  const match = bestEffortDistancesFor(sport).find((d) => bestEffortDistanceKey(d.meters) === key);
  if (match) return match.label;
  return key >= 1000 ? `${Math.round(key / 100) / 10}K` : `${key}m`;
}

export interface BestEffort {
  distanceMeters: number;
  label: string;
  elapsedSeconds: number;
  /** Moving seconds into the run the effort began and ended. */
  startSeconds: number;
  endSeconds: number;
  startMeters: number;
  paceSecondsPerKm: number;
  avgHeartRate: number | null;
}

/**
 * For each candidate distance no longer than the run, the fastest window of
 * exactly that length. Two pointers over the cumulative distance: for every
 * possible start sample, advance the end until the window is long enough,
 * then interpolate the instant it became exactly long enough. Linear in the
 * number of samples per distance.
 *
 * Windows start on a sample, not between them. At a 10m filter that means
 * the true optimum can begin up to ten metres — a couple of seconds — before
 * the one found, which is well inside what GPS itself resolves. A run 20m
 * short of 5K gets no 5K effort: an effort at a distance is an effort over
 * that whole distance.
 */
export function computeBestEfforts(
  streams: ActivityStreams,
  distances: readonly BestEffortDistance[]
): BestEffort[] {
  const { distance, time } = streams;
  const n = distance.length;
  const total = totalDistanceMeters(streams);
  const efforts: BestEffort[] = [];

  for (const candidate of distances) {
    const target = candidate.meters;
    if (target <= 0 || target > total - distance[0]) continue;

    let best: { elapsed: number; startIndex: number; endIndex: number; endTime: number } | null = null;
    let j = 0;
    for (let i = 0; i < n; i++) {
      while (j < n && distance[j] - distance[i] < target) j++;
      if (j >= n) break;
      // The window closes somewhere on the leg (j-1, j]; interpolate the
      // instant it reached exactly `target`.
      let endTime: number;
      if (j === 0 || distance[j] - distance[i] === target) {
        endTime = time[j];
      } else {
        const leg = distance[j] - distance[j - 1];
        const fraction = leg > 0 ? (target - (distance[j - 1] - distance[i])) / leg : 1;
        endTime = time[j - 1] + fraction * (time[j] - time[j - 1]);
      }
      const elapsed = endTime - time[i];
      if (elapsed <= 0) continue;
      if (!best || elapsed < best.elapsed) {
        best = { elapsed, startIndex: i, endIndex: j, endTime };
      }
    }

    if (!best) continue;
    efforts.push({
      distanceMeters: bestEffortDistanceKey(target),
      label: candidate.label,
      elapsedSeconds: Math.round(best.elapsed * 10) / 10,
      startSeconds: Math.round(time[best.startIndex] * 10) / 10,
      endSeconds: Math.round(best.endTime * 10) / 10,
      startMeters: Math.round(distance[best.startIndex]),
      paceSecondsPerKm: Math.round((best.elapsed / target) * 1000 * 10) / 10,
      avgHeartRate: meanOver(streams.heartRate, best.startIndex, best.endIndex),
    });
  }

  return efforts;
}
