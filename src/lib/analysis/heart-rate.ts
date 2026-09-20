import { timeAtDistance, totalDistanceMeters, totalSeconds, type ActivityStreams } from "./streams";

/**
 * Heart rate over the run: time in each zone, and whether the heart rate
 * drifted upward for the same pace as the run went on.
 */
export interface HrZone {
  /** 0 is below zone 1 (recovery); 1-5 are the training zones. */
  zone: number;
  label: string;
  minBpm: number;
  /** Null for the open-topped top zone. */
  maxBpm: number | null;
  seconds: number;
  /** Share of the run's heart-rate-covered time, 0-1. */
  fraction: number;
}

/**
 * Which zone model the boundaries came from.
 *
 *  - "reserve": heart-rate reserve (Karvonen) — each zone floor is resting +
 *    fraction × (max − resting), at 50/60/70/80/90%. Needs both resting and
 *    max HR on the profile, and is the better model when both are known:
 *    two athletes with the same max but resting rates of 45 and 70 do not
 *    share a zone 2.
 *  - "percent_max": the same fractions of max HR alone, when that is all the
 *    profile has.
 *
 * Deliberately self-contained rather than reading the scoring engine's zone
 * profile: that model is being reworked, and what the athlete sees on a run
 * should not shift under them every time scoring is recalibrated.
 */
export type HrZoneModel = "reserve" | "percent_max";

/** Zone floors as a fraction of the intensity range, zones 1 through 5. */
export const HR_ZONE_FRACTIONS = [0.5, 0.6, 0.7, 0.8, 0.9] as const;

export interface HeartRateAnalysis {
  avgBpm: number;
  maxBpm: number;
  minBpm: number;
  /** Fraction of samples that carried a reading, 0-1. Below ~0.5 the zone split is more gap than signal. */
  coverage: number;
  zones: HrZone[] | null;
  zoneModel: HrZoneModel | null;
  /**
   * Aerobic decoupling: how much the pace-to-heart-rate ratio fell from the
   * first half of the run to the second, as a percentage. Positive means the
   * heart worked harder for the same speed later on — heat, dehydration, or
   * an effort above what the aerobic system could hold. Under 5% is the usual
   * "aerobically fit for this duration" reading. Null when the run is too
   * short or too sparsely covered for the comparison to mean anything.
   */
  driftPercent: number | null;
}

export interface HrProfileInput {
  restingHr: number | null | undefined;
  maxHr: number | null | undefined;
}

const ZONE_LABELS = ["Recovery", "Zone 1", "Zone 2", "Zone 3", "Zone 4", "Zone 5"] as const;

/** Runs shorter than this have no meaningful "second half" to measure drift over. */
const MIN_DRIFT_SECONDS = 20 * 60;
/** Each half needs at least this much of its samples covered by a reading. */
const MIN_DRIFT_COVERAGE = 0.5;

interface ZoneBounds {
  model: HrZoneModel;
  /** Lower bound of zones 1..5, ascending. Below the first is zone 0. */
  floors: number[];
}

export function zoneBounds(profile: HrProfileInput): ZoneBounds | null {
  const maxHr = profile.maxHr;
  if (!maxHr || maxHr <= 0) return null;
  const restingHr = profile.restingHr;
  if (restingHr && restingHr > 0 && maxHr > restingHr) {
    const reserve = maxHr - restingHr;
    return {
      model: "reserve",
      floors: HR_ZONE_FRACTIONS.map((f) => Math.round(restingHr + f * reserve)),
    };
  }
  return {
    model: "percent_max",
    floors: HR_ZONE_FRACTIONS.map((f) => Math.round(maxHr * f)),
  };
}

function zoneOf(bpm: number, floors: number[]): number {
  let zone = 0;
  for (let k = 0; k < floors.length; k++) if (bpm >= floors[k]) zone = k + 1;
  return zone;
}

export function analyzeHeartRate(streams: ActivityStreams, profile: HrProfileInput): HeartRateAnalysis | null {
  const hr = streams.heartRate;
  if (!hr) return null;

  let sum = 0;
  let count = 0;
  let max = -Infinity;
  let min = Infinity;
  for (const v of hr) {
    if (v === null) continue;
    sum += v;
    count++;
    if (v > max) max = v;
    if (v < min) min = v;
  }
  if (count === 0) return null;

  const bounds = zoneBounds(profile);
  let zones: HrZone[] | null = null;
  if (bounds) {
    // Each sample's reading is taken to describe the leg that ended at it, so
    // its zone earns the leg's duration. Legs with no reading earn nothing —
    // they are gaps, not zone time.
    const seconds = new Array<number>(6).fill(0);
    let covered = 0;
    for (let i = 1; i < hr.length; i++) {
      const v = hr[i];
      if (v === null) continue;
      const leg = streams.time[i] - streams.time[i - 1];
      seconds[zoneOf(v, bounds.floors)] += leg;
      covered += leg;
    }
    zones = seconds.map((s, zone) => ({
      zone,
      label: ZONE_LABELS[zone],
      minBpm: zone === 0 ? 0 : bounds.floors[zone - 1],
      maxBpm: zone === 5 ? null : bounds.floors[zone] - 1,
      seconds: Math.round(s),
      fraction: covered > 0 ? Math.round((s / covered) * 1000) / 1000 : 0,
    }));
  }

  return {
    avgBpm: Math.round(sum / count),
    maxBpm: max,
    minBpm: min,
    coverage: Math.round((count / hr.length) * 100) / 100,
    zones,
    zoneModel: bounds?.model ?? null,
    driftPercent: computeDrift(streams),
  };
}

/** Speed divided by heart rate over samples (from, to] — the efficiency factor, per half. */
function efficiencyOver(streams: ActivityStreams, from: number, to: number): number | null {
  const hr = streams.heartRate;
  if (!hr) return null;
  let hrSum = 0;
  let hrSeconds = 0;
  let seconds = 0;
  for (let i = Math.max(1, from + 1); i <= to && i < hr.length; i++) {
    const leg = streams.time[i] - streams.time[i - 1];
    seconds += leg;
    const v = hr[i];
    if (v === null) continue;
    hrSum += v * leg;
    hrSeconds += leg;
  }
  if (seconds <= 0 || hrSeconds / seconds < MIN_DRIFT_COVERAGE) return null;
  const meters = streams.distance[to] - streams.distance[from];
  const elapsed = streams.time[to] - streams.time[from];
  if (meters <= 0 || elapsed <= 0) return null;
  const speed = meters / elapsed;
  const avgHr = hrSum / hrSeconds;
  return avgHr > 0 ? speed / avgHr : null;
}

function computeDrift(streams: ActivityStreams): number | null {
  if (totalSeconds(streams) - streams.time[0] < MIN_DRIFT_SECONDS) return null;
  const total = totalDistanceMeters(streams);
  const halfMeters = streams.distance[0] + (total - streams.distance[0]) / 2;
  const halfTime = timeAtDistance(streams, halfMeters);
  if (halfTime === null) return null;

  // The sample index the halfway point falls on.
  let mid = 0;
  while (mid < streams.distance.length - 1 && streams.distance[mid + 1] <= halfMeters) mid++;
  const last = streams.distance.length - 1;
  const first = efficiencyOver(streams, 0, mid);
  const second = efficiencyOver(streams, mid, last);
  if (first === null || second === null || first <= 0) return null;
  return Math.round(((first - second) / first) * 1000) / 10;
}
