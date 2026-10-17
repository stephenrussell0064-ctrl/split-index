import {
  cumulativeTrackDistances,
  movingMillis,
  type GpsPoint,
  type HrReading,
  type PauseInterval,
} from "@/lib/scoring/gps-track";

/**
 * Distance splits of a GPS track, for the voice callouts during a run.
 *
 * Originally per kilometre (user feedback: "for GPS runs and exercises I want
 * it to call out the splits every 1km with how many km you are in"). Halved
 * on 17 Oct 2026 (owner: "Heart rate splits should be called out every 500m
 * rather 1km") — every split, with its time, running total and average heart
 * rate, is now cut and spoken at each 500 m. METERS_PER_SPLIT is the one
 * place that decides it; the type keeps its name because every consumer
 * reads it by field, not by what the file is called.
 *
 * Pure and device-free, like the rest of the track maths. Built on the same
 * cumulative distance the HUD's distance tile is built on, so a callout of
 * "3 kilometres" can never fire while the screen still reads 2.97 — the two
 * numbers are the same number.
 */
export interface KilometreSplit {
  /** Cumulative distance at the end of this split, in metres: 500, 1000, 1500… */
  meters: number;
  /** Kilometres completed at the end of this split — 0.5 for the first, 1 for the second, and so on. */
  km: number;
  /** Moving seconds this split took. */
  splitSeconds: number;
  /** Moving seconds from the start of the run to the end of this split. */
  elapsedSeconds: number;
  /**
   * Mean heart rate over this split, from the readings timestamped inside
   * it. Null when no monitor was connected or nothing was read during the
   * split — never zero, which is a number a synthesiser would read out.
   */
  avgHr: number | null;
}

/** How far between callouts. Was 1000; see the file comment for the 500 m decision. */
export const METERS_PER_SPLIT = 500;

/**
 * Every whole split completed so far, in order.
 *
 * A split boundary almost never lands exactly on a fix — at a 10m distance
 * filter it lands somewhere inside a ten-metre leg — so the crossing instant
 * is interpolated along the leg that contains it rather than snapped to the
 * fix after it. Snapping would bias every split slow by up to one leg's worth
 * of time and make "last 500 metres" jitter by a few seconds from one split
 * to the next for no real reason.
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
        meters: boundary,
        km: boundary / 1000,
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
 * split still describes the athlete's heart during that split, and resting
 * at a crossing is part of what the number should reflect.
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
 * "500 metres", "1 kilometre", "1.5 kilometres", "3 kilometres". Under a
 * kilometre it is said in metres; from there in kilometres, with the half
 * written as a decimal because synthesisers read "1.5" as "one point five"
 * cleanly and "1 and a half" inconsistently.
 */
export function spokenDistance(meters: number): string {
  if (meters < 1000) return `${meters} metres`;
  const km = meters / 1000;
  return `${km} ${km === 1 ? "kilometre" : "kilometres"}`;
}

/**
 * What is read aloud when a split completes: how far in, how long the last
 * split took, and the running total. The first split's time IS the total, so
 * it is said once rather than twice.
 */
export function splitAnnouncement(
  split: KilometreSplit,
  options: {
    /**
     * Say the split's average heart rate after the times. Off by default so
     * the existing callouts are unchanged; the GPS screen offers it as its own
     * switch, because a number read into your ear every few minutes is
     * something you choose, not something a connected strap imposes.
     */
    includeHeartRate?: boolean;
  } = {}
): string {
  const distance = spokenDistance(split.meters);
  const heartRate =
    options.includeHeartRate && split.avgHr != null ? ` Average heart rate ${split.avgHr}.` : "";
  if (split.meters <= METERS_PER_SPLIT) {
    return `${distance}. ${spokenDuration(split.splitSeconds)}.${heartRate}`;
  }
  return `${distance}. Last ${spokenDistance(METERS_PER_SPLIT)} ${spokenDuration(split.splitSeconds)}. Total ${spokenDuration(split.elapsedSeconds)}.${heartRate}`;
}
