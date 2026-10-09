import {
  cumulativeTrackDistances,
  movingMillis,
  type GpsPoint,
  type HrReading,
  type PauseInterval,
} from "@/lib/scoring/gps-track";

/**
 * Per-kilometre splits of a GPS track, for the voice callouts during a run
 * (user feedback: "for GPS runs and exercises I want it to call out the
 * splits every 1km with how many km you are in").
 *
 * Pure and device-free, like the rest of the track maths. Built on the same
 * cumulative distance the HUD's distance tile is built on, so a callout of
 * "3 kilometres" can never fire while the screen still reads 2.97 — the two
 * numbers are the same number.
 */
export interface KilometreSplit {
  /** 1 for the first kilometre, 2 for the second, and so on. */
  km: number;
  /** Moving seconds this kilometre took. */
  splitSeconds: number;
  /** Moving seconds from the start of the run to the end of this kilometre. */
  elapsedSeconds: number;
  /**
   * Mean heart rate over this kilometre, from the readings timestamped inside
   * it. Null when no monitor was connected or nothing was read during the
   * kilometre — never zero, which is a number a synthesiser would read out.
   */
  avgHr: number | null;
}

const METERS_PER_SPLIT = 1000;

/**
 * Every whole kilometre completed so far, in order.
 *
 * A kilometre boundary almost never lands exactly on a fix — at a 10m
 * distance filter it lands somewhere inside a ten-metre leg — so the crossing
 * instant is interpolated along the leg that contains it rather than snapped
 * to the fix after it. Snapping would bias every split slow by up to one
 * leg's worth of time and make "last kilometre" jitter by a few seconds from
 * one split to the next for no real reason.
 *
 * `startedAt` is the run's clock origin (the instant Start was pressed), the
 * same origin the HUD's elapsed clock counts from, so the "total" spoken with
 * each split matches the number on screen. Paused time is excluded from both
 * the elapsed and the split, exactly as it is from the on-screen clock.
 */
export function kilometreSplits(
  points: GpsPoint[],
  pauses: readonly PauseInterval[],
  startedAt: number,
  /** Heart-rate readings from the run so far, in any order. Optional: a run without a monitor has none. */
  hrReadings: readonly HrReading[] = []
): KilometreSplit[] {
  const cumulative = cumulativeTrackDistances(points, pauses);
  const splits: KilometreSplit[] = [];
  let previousElapsed = 0;
  let previousCrossedAt = startedAt;

  for (let i = 1; i < cumulative.length; i++) {
    const prev = cumulative[i - 1];
    const curr = cumulative[i];
    const legMeters = curr.meters - prev.meters;
    if (legMeters <= 0) continue;

    let boundary = (splits.length + 1) * METERS_PER_SPLIT;
    while (boundary <= curr.meters) {
      const fraction = (boundary - prev.meters) / legMeters;
      const crossedAt = prev.point.time + fraction * (curr.point.time - prev.point.time);
      const elapsedSeconds = movingMillis(startedAt, crossedAt, pauses) / 1000;
      splits.push({
        km: splits.length + 1,
        splitSeconds: elapsedSeconds - previousElapsed,
        elapsedSeconds,
        avgHr: averageHrBetween(hrReadings, previousCrossedAt, crossedAt),
      });
      previousElapsed = elapsedSeconds;
      previousCrossedAt = crossedAt;
      boundary += METERS_PER_SPLIT;
    }
  }

  return splits;
}

/**
 * Mean of the readings whose timestamp falls inside (from, to]. Wall-clock
 * bounds, not moving-time bounds: a reading taken during a pause inside the
 * kilometre still describes the athlete's heart during that kilometre, and
 * resting at a crossing is part of what the number should reflect.
 */
function averageHrBetween(readings: readonly HrReading[], from: number, to: number): number | null {
  let sum = 0;
  let count = 0;
  for (const r of readings) {
    if (r.time > from && r.time <= to && r.bpm > 0) {
      sum += r.bpm;
      count++;
    }
  }
  return count > 0 ? Math.round(sum / count) : null;
}

/** "5 minutes 12 seconds", "1 hour 3 minutes 40 seconds", "48 seconds" — words, because a synthesiser reads "5:12" as five-twelve or as a time of day. */
export function spokenDuration(totalSeconds: number): string {
  const rounded = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const seconds = rounded % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? "hour" : "hours"}`);
  if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? "minute" : "minutes"}`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  return parts.join(" ");
}

/**
 * What is read aloud when a kilometre completes: how many kilometres are in,
 * how long the last one took, and the running total. The first kilometre's
 * split IS the total, so it is said once rather than twice.
 */
export function splitAnnouncement(
  split: KilometreSplit,
  options: {
    /**
     * Say the kilometre's average heart rate after the times. Off by default
     * so the existing callouts are unchanged; the GPS screen offers it as its
     * own switch, because a number read into your ear every kilometre is
     * something you choose, not something a connected strap imposes.
     */
    includeHeartRate?: boolean;
  } = {}
): string {
  const distance = `${split.km} ${split.km === 1 ? "kilometre" : "kilometres"}`;
  const heartRate =
    options.includeHeartRate && split.avgHr != null ? ` Average heart rate ${split.avgHr}.` : "";
  if (split.km === 1) {
    return `${distance}. ${spokenDuration(split.splitSeconds)}.${heartRate}`;
  }
  return `${distance}. Last kilometre ${spokenDuration(split.splitSeconds)}. Total ${spokenDuration(split.elapsedSeconds)}.${heartRate}`;
}
