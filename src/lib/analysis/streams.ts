import {
  ELEVATION_CONFIG,
  cumulativeTrackDistances,
  movingMillis,
  type CadenceSample,
  type GpsPoint,
  type HrReading,
  type PauseInterval,
} from "@/lib/scoring/gps-track";

/**
 * Activity streams — the per-sample record of a GPS session that every piece
 * of run analysis (splits, best efforts, heart-rate zones, elevation profile,
 * the pace chart) is computed from.
 *
 * Until these existed a GPS run kept only its summary. Distance, duration,
 * average pace, total climb and average heart rate were stored; the thousand
 * fixes and every heart-rate reading behind them were thrown away on submit.
 * That is why the activity page could not show a single kilometre split.
 *
 * The shape is Strava's "streams" idea: parallel arrays, one entry per
 * accepted fix, indexed together. Arrays rather than an array of objects
 * because the key names would otherwise be most of the stored bytes, and
 * because every consumer walks the whole series anyway.
 *
 * What is and is not here, and why:
 *
 *  - `time` is MOVING seconds since the first fix, not wall-clock. Paused
 *    stretches are removed exactly as they are from the saved duration
 *    (movingMillis), so a pace computed between any two samples is a pace
 *    the athlete actually ran.
 *  - `distance` is the same cumulative total the live HUD and the saved
 *    distance were built from (cumulativeTrackDistances): same accuracy
 *    filter, same pause rule. A split boundary found here lands where the
 *    on-screen kilometre ticked over.
 *  - There are NO coordinates. The route polyline already exists for drawing
 *    the run, trimmed at both ends before storage so it never starts at the
 *    athlete's door. A time-stamped position series would undo that, and
 *    nothing in the analysis needs where the athlete was — only how far along
 *    the run they were, and when.
 *  - Sensor channels (altitude, heart rate, cadence) are per-sample nullable
 *    and null as a whole when the device produced nothing, so "no barometer"
 *    and "no chest strap" render as absent sections rather than flat zero
 *    lines.
 */
export interface ActivityStreams {
  /** Moving seconds since the start, one per sample, strictly increasing. */
  time: number[];
  /** Cumulative moving distance in metres, one per sample, non-decreasing. */
  distance: number[];
  /** Altitude in metres per sample, null where the fix carried no usable altitude; null as a whole when none did. */
  altitude: (number | null)[] | null;
  /** Heart rate in bpm per sample, aligned from the sensor's own timestamps; null as a whole when no monitor was paired. */
  heartRate: (number | null)[] | null;
  /** Cadence in steps/min per sample; null as a whole when the step counter was not running. */
  cadence: (number | null)[] | null;
}

export const STREAM_CONFIG = {
  /**
   * Hard ceiling on samples, set by the request body limit rather than by
   * taste. A sample serialises to roughly 30 bytes across the five channels,
   * MAX_REQUEST_BODY_BYTES is 256KB, and the route polyline and the rest of
   * the activity payload travel in the same body — so 3000 samples (~96KB)
   * leaves comfortable headroom where 6000 would not.
   *
   * At a 10m distance filter this is full resolution out to 30km; beyond
   * that the series is decimated UNIFORMLY, never truncated. A stream that
   * stopped at 30km of a 100km ultra would put every split and best effort
   * after that point in the bin, whereas halving the resolution costs only
   * the precision with which a best-effort window can start (20m, about four
   * seconds, on a 60km run) — which is documented on computeBestEfforts and
   * is inside what GPS itself resolves.
   */
  MAX_SAMPLES: 3000,
  /**
   * A sensor reading further than this from the fix it is being matched to
   * belongs to no fix at all. Heart-rate straps report about once a second
   * and a fix arrives every few seconds at running pace, so the normal case
   * is several readings per fix; this only decides what happens across a
   * dropout.
   */
  SENSOR_MATCH_WINDOW_MS: 15_000,
  /** Fewer usable fixes than this and there is no series to analyse. */
  MIN_SAMPLES: 2,
} as const;

export interface BuildStreamsInput {
  /** The run's raw fixes, in any order. */
  points: GpsPoint[];
  /** The run's pauses, with any open pause already closed. */
  pauses: readonly PauseInterval[];
  hrReadings: readonly HrReading[];
  cadenceSamples: readonly CadenceSample[];
}

interface TimedValue {
  time: number;
  value: number;
}

/**
 * Lays a sensor series against the fix timeline. For each fix, the mean of
 * every reading since the previous fix; failing that, the nearest reading
 * within SENSOR_MATCH_WINDOW_MS; failing that, null. Averaging within the
 * gap rather than taking the last reading is what keeps a 1Hz strap from
 * aliasing against a 0.3Hz GPS — the per-sample value is the heart rate over
 * that leg, which is what a per-leg pace is being compared against.
 */
function alignSensor(fixTimes: number[], readings: readonly TimedValue[]): (number | null)[] | null {
  const sorted = readings
    .filter((r) => Number.isFinite(r.value) && Number.isFinite(r.time))
    .sort((a, b) => a.time - b.time);
  if (sorted.length === 0) return null;

  const out: (number | null)[] = new Array(fixTimes.length).fill(null);
  let cursor = 0;
  let any = false;

  for (let i = 0; i < fixTimes.length; i++) {
    const windowStart = i === 0 ? fixTimes[0] - STREAM_CONFIG.SENSOR_MATCH_WINDOW_MS : fixTimes[i - 1];
    const windowEnd = fixTimes[i];

    while (cursor < sorted.length && sorted[cursor].time <= windowStart) cursor++;

    let sum = 0;
    let count = 0;
    let j = cursor;
    while (j < sorted.length && sorted[j].time <= windowEnd) {
      sum += sorted[j].value;
      count++;
      j++;
    }

    if (count > 0) {
      out[i] = Math.round(sum / count);
      any = true;
      continue;
    }

    // Nothing in the gap — take whichever neighbouring reading is closest,
    // if it is close enough to plausibly describe this instant.
    const before = cursor > 0 ? sorted[cursor - 1] : null;
    const after = cursor < sorted.length ? sorted[cursor] : null;
    const candidates = [before, after].filter((r): r is TimedValue => r !== null);
    let best: TimedValue | null = null;
    for (const c of candidates) {
      if (Math.abs(c.time - windowEnd) > STREAM_CONFIG.SENSOR_MATCH_WINDOW_MS) continue;
      if (!best || Math.abs(c.time - windowEnd) < Math.abs(best.time - windowEnd)) best = c;
    }
    if (best) {
      out[i] = Math.round(best.value);
      any = true;
    }
  }

  return any ? out : null;
}

/** The altitude a fix can be trusted for, by the same rules elevation gain applies (gps-track.ts elevationGainMeters). */
function usableAltitude(p: GpsPoint): number | null {
  if (p.altitude === null || !Number.isFinite(p.altitude)) return null;
  if (Number.isFinite(p.accuracy) && p.accuracy > ELEVATION_CONFIG.MAX_ACCURACY_METERS) return null;
  if (typeof p.altitudeAccuracy === "number" && Number.isFinite(p.altitudeAccuracy) && p.altitudeAccuracy < 0) {
    return null;
  }
  return Math.round(p.altitude * 10) / 10;
}

/** Uniform decimation to at most `max` samples, always keeping the first and the last. */
function decimate<T>(series: T[], max: number): T[] {
  if (series.length <= max) return series;
  const step = (series.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(series[Math.round(i * step)]);
  return out;
}

/**
 * Builds the streams for a finished session. Returns null when there is not
 * enough of a track to analyse — a stream of one fix has no pace in it.
 *
 * Pure: no plugin, no storage, no clock. The tracking page hands it the same
 * points, pauses and sensor readings it hands summarizeGpsTrack, so the
 * series here and the summary numbers on the activity agree by construction.
 */
export function buildActivityStreams(input: BuildStreamsInput): ActivityStreams | null {
  const sorted = [...input.points]
    .filter((p) => Number.isFinite(p.time))
    .sort((a, b) => a.time - b.time);
  if (sorted.length < STREAM_CONFIG.MIN_SAMPLES) return null;

  // Same origin the saved duration counts from (summarizeGpsTrack uses the
  // earliest fix, accepted or not), so the last sample's time is the run's
  // duration.
  const origin = sorted[0].time;
  const cumulative = cumulativeTrackDistances(sorted, input.pauses);

  const fixTimes: number[] = [];
  const time: number[] = [];
  const distance: number[] = [];
  const altitude: (number | null)[] = [];
  let lastTime = -1;

  for (const { point, meters } of cumulative) {
    const t = Math.round(movingMillis(origin, point.time, input.pauses) / 100) / 10;
    // Two fixes inside the same tenth of a second describe the same instant;
    // the second adds nothing and would give a zero-length leg downstream.
    if (t <= lastTime) continue;
    lastTime = t;
    fixTimes.push(point.time);
    time.push(t);
    distance.push(Math.round(meters * 10) / 10);
    altitude.push(usableAltitude(point));
  }

  if (time.length < STREAM_CONFIG.MIN_SAMPLES) return null;

  const heartRate = alignSensor(
    fixTimes,
    input.hrReadings.map((r) => ({ time: r.time, value: r.bpm }))
  );
  const cadence = alignSensor(
    fixTimes,
    input.cadenceSamples.map((c) => ({ time: c.time, value: c.spm }))
  );
  const hasAltitude = altitude.some((a) => a !== null);

  const keep = decimate(
    time.map((_, i) => i),
    STREAM_CONFIG.MAX_SAMPLES
  );

  return {
    time: keep.map((i) => time[i]),
    distance: keep.map((i) => distance[i]),
    altitude: hasAltitude ? keep.map((i) => altitude[i]) : null,
    heartRate: heartRate ? keep.map((i) => heartRate[i]) : null,
    cadence: cadence ? keep.map((i) => cadence[i]) : null,
  };
}

function numericSeries(value: unknown, length: number): number[] | null {
  if (!Array.isArray(value) || value.length !== length) return null;
  const out: number[] = [];
  for (const v of value) {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return null;
    out.push(n);
  }
  return out;
}

function nullableSeries(value: unknown, length: number, min: number, max: number): (number | null)[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || value.length !== length) return null;
  const out: (number | null)[] = [];
  let any = false;
  for (const v of value) {
    if (v === null || v === undefined) {
      out.push(null);
      continue;
    }
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      out.push(null);
      continue;
    }
    out.push(n);
    any = true;
  }
  return any ? out : null;
}

/**
 * Reads streams back from storage (or from a request body), tolerating
 * anything malformed by returning null rather than throwing inside a render.
 * Length mismatches, non-monotonic time or distance, or a series too short to
 * analyse all read as "no streams" — a broken row costs the athlete the
 * analysis panel, never the page.
 *
 * Per-sample sensor values outside a physical range are nulled individually
 * rather than failing the whole stream: one 0 bpm dropout from a strap should
 * not delete the heart-rate chart.
 */
export function parseActivityStreams(value: unknown): ActivityStreams | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.time)) return null;
  const length = raw.time.length;
  if (length < STREAM_CONFIG.MIN_SAMPLES || length > STREAM_CONFIG.MAX_SAMPLES) return null;

  const time = numericSeries(raw.time, length);
  const distance = numericSeries(raw.distance, length);
  if (!time || !distance) return null;

  for (let i = 1; i < length; i++) {
    if (time[i] <= time[i - 1]) return null;
    if (distance[i] < distance[i - 1]) return null;
  }

  return {
    time,
    distance,
    altitude: nullableSeries(raw.altitude, length, -500, 12_000),
    heartRate: nullableSeries(raw.heartRate, length, 30, 250),
    cadence: nullableSeries(raw.cadence, length, 0, 300),
  };
}

// ---------------------------------------------------------------------------
// Shared lookups on a parsed stream
// ---------------------------------------------------------------------------

/** Index of the last sample whose distance is <= `meters` (binary search). */
export function indexAtDistance(streams: ActivityStreams, meters: number): number {
  let lo = 0;
  let hi = streams.distance.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (streams.distance[mid] <= meters) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Moving seconds at which the run reached `meters`, interpolated along the
 * leg that contains it. A split boundary almost never lands on a fix; at a
 * 10m filter it lands inside a ten-metre leg, and snapping to the fix after
 * it would bias every split slow by up to one leg's worth of time. Null when
 * the run never got that far.
 */
export function timeAtDistance(streams: ActivityStreams, meters: number): number | null {
  const { distance, time } = streams;
  const last = distance.length - 1;
  if (meters < distance[0] || meters > distance[last]) return null;
  const i = indexAtDistance(streams, meters);
  if (i === last || distance[i] === meters) return time[i];
  const leg = distance[i + 1] - distance[i];
  if (leg <= 0) return time[i];
  const fraction = (meters - distance[i]) / leg;
  return time[i] + fraction * (time[i + 1] - time[i]);
}

/** Mean of a nullable channel over samples [from, to] inclusive, or null when none of them carried a value. */
export function meanOver(channel: (number | null)[] | null, from: number, to: number): number | null {
  if (!channel) return null;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, from); i <= Math.min(channel.length - 1, to); i++) {
    const v = channel[i];
    if (v === null) continue;
    sum += v;
    count++;
  }
  return count > 0 ? Math.round(sum / count) : null;
}

/** Max of a nullable channel over samples [from, to] inclusive. */
export function maxOver(channel: (number | null)[] | null, from: number, to: number): number | null {
  if (!channel) return null;
  let best: number | null = null;
  for (let i = Math.max(0, from); i <= Math.min(channel.length - 1, to); i++) {
    const v = channel[i];
    if (v === null) continue;
    if (best === null || v > best) best = v;
  }
  return best;
}

export function totalDistanceMeters(streams: ActivityStreams): number {
  return streams.distance[streams.distance.length - 1];
}

export function totalSeconds(streams: ActivityStreams): number {
  return streams.time[streams.time.length - 1];
}
