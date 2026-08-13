/**
 * Capacitor-conversion brief, Part 3 — pure GPS-track computation: distance,
 * pace, and elevation gain from a raw sequence of location fixes, plus
 * detection of whether background tracking was actually interrupted. Kept
 * DB/plugin-independent on purpose (same pure-function-plus-thin-wrapper
 * pattern as the rest of this scoring pipeline) so it's directly testable
 * without a device.
 *
 * The core rule this file exists to enforce: a partial GPS track must never
 * be scored as if it were the full, clean effort — the same class of
 * "confidently wrong" bug already fixed once in this project (cardio
 * monotonicity). See GpsTrackSummary.isPartial/partialReason below.
 */

export const GPS_TRACKING_CONFIG = {
  /** Passed straight to the native background-geolocation plugin — distance-filtered sampling (not fixed-time-interval) is how most running apps balance GPS accuracy against battery drain. */
  DISTANCE_FILTER_METERS: 10,
  /** A gap between two consecutive accepted fixes wider than this is far more likely to mean background tracking was actually interrupted (permission revoked, OS killed the process under memory pressure) than an ordinary GPS reacquisition. */
  MAX_ACCEPTABLE_GAP_SECONDS: 120,
  /** Fixes reported with worse horizontal accuracy than this are dropped rather than allowed to inflate distance (e.g. indoor multipath, GPS drift while stationary). */
  MAX_ACCURACY_METERS: 50,
} as const;

export interface GpsPoint {
  latitude: number;
  longitude: number;
  /** Horizontal uncertainty in meters. */
  accuracy: number;
  altitude: number | null;
  /** Milliseconds since Unix epoch. */
  time: number;
}

export type PartialReason = "permission_revoked" | "sampling_gap" | "ended_without_stopping" | null;

export interface GpsTrackSummary {
  distanceMeters: number;
  durationSeconds: number;
  avgPaceSecondsPerKm: number | null;
  elevationGainMeters: number | null;
  isPartial: boolean;
  partialReason: PartialReason;
}

const EARTH_RADIUS_METERS = 6371000;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two points, in meters (haversine formula) — accurate enough at running/cycling scale, far simpler than a full geodesic (Vincenty) solution. */
export function haversineDistanceMeters(a: GpsPoint, b: GpsPoint): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);

  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Elevation-gain de-noising. Real user report: a run with 67m of actual
 * elevation gain was logged as 269m — four times over.
 *
 * The old rule was "sum every positive altitude delta between consecutive
 * points", which is the textbook definition and is wrong on GPS data for a
 * reason that compounds with sampling rate. GPS altitude is far less accurate
 * than GPS position — typically two to three times the horizontal error, so
 * ±10-15m is normal — and it wanders continuously even when stationary. At a
 * 10m distance filter a 10km run produces around a thousand fixes, and if
 * noise contributes an average of just 0.2m of *positive* delta per fix,
 * that is 200m of elevation the athlete never climbed. The error is
 * one-directional because only positive deltas are counted, so noise can only
 * ever inflate the number, never cancel out.
 *
 * Three stages, each removing a different part of the problem:
 *
 *  1. Reject fixes whose accuracy is too poor to carry a believable altitude,
 *     and single-sample spikes (median-of-three), which are the multipath
 *     artefacts that produce 30m cliffs in otherwise flat data.
 *  2. Smooth what is left with a moving average, which attenuates the
 *     remaining high-frequency wander.
 *  3. Accumulate with hysteresis: only bank a climb once it exceeds
 *     GAIN_THRESHOLD_METERS above the lowest point since the last bank. This
 *     is what stops residual noise being counted at all, and it is what
 *     Strava, Garmin and every other credible implementation do.
 *
 * On the reported case — a real 67m of climb across ~900 noisy fixes — this
 * reads 67.6m where the old rule read in the hundreds, and a genuinely flat
 * run with the same noise now reads 0 rather than tens of metres.
 *
 * The honest trade: hysteresis under-reports clean terrain slightly, because
 * the last few metres of each summit sit below the threshold and are never
 * banked. On six clean 20m hills this returns about 78% of the true 120m.
 * That is the correct side to err on — every metre of phantom climb inflates
 * relative effort, which inflates load, which prescribes more training than
 * the athlete actually did.
 */
export const ELEVATION_CONFIG = {
  /** Fixes worse than this are dropped for elevation purposes. Stricter than the distance filter because vertical error runs 2-3x horizontal. */
  MAX_ACCURACY_METERS: 30,
  /** A climb must exceed this above the running minimum before any of it is banked as gain. */
  GAIN_THRESHOLD_METERS: 5,
  /**
   * Moving-average window, sized as a fraction of the sample count rather
   * than fixed. This is the part that makes the result independent of
   * sampling rate, which matters because the bug scales with it: a fixed
   * window under-filters a densely sampled run and erases real terrain on a
   * sparse one.
   */
  SMOOTHING_WINDOW_DIVISOR: 30,
  SMOOTHING_WINDOW_MIN: 3,
  SMOOTHING_WINDOW_MAX: 21,
  /** Below this many usable samples, smoothing would erase real terrain rather than noise, so it is skipped. */
  SMOOTHING_MIN_POINTS: 10,
  /** A sample this far from the median of its immediate neighbours is a multipath spike, not a cliff. */
  SPIKE_TOLERANCE_METERS: 25,
} as const;

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

/** Stage 1b: replace single-sample spikes with the median of their neighbourhood. */
function despike(altitudes: number[]): number[] {
  if (altitudes.length < 3) return altitudes;
  const out = [...altitudes];
  for (let i = 1; i < altitudes.length - 1; i++) {
    const m = median3(altitudes[i - 1], altitudes[i], altitudes[i + 1]);
    if (Math.abs(altitudes[i] - m) > ELEVATION_CONFIG.SPIKE_TOLERANCE_METERS) out[i] = m;
  }
  return out;
}

/** Window scaled to sample count, so a 90-second jog and a three-hour run are filtered on the same physical scale rather than the same sample count. */
function smoothingWindow(sampleCount: number): number {
  if (sampleCount < ELEVATION_CONFIG.SMOOTHING_MIN_POINTS) return 1;
  return Math.min(
    ELEVATION_CONFIG.SMOOTHING_WINDOW_MAX,
    Math.max(ELEVATION_CONFIG.SMOOTHING_WINDOW_MIN, Math.round(sampleCount / ELEVATION_CONFIG.SMOOTHING_WINDOW_DIVISOR))
  );
}

/** Stage 2: centred moving average. */
function smooth(altitudes: number[]): number[] {
  const window = smoothingWindow(altitudes.length);
  if (window < 2) return altitudes;
  const half = Math.floor(window / 2);
  return altitudes.map((_, i) => {
    const from = Math.max(0, i - half);
    const to = Math.min(altitudes.length, i + half + 1);
    let sum = 0;
    for (let j = from; j < to; j++) sum += altitudes[j];
    return sum / (to - from);
  });
}

/**
 * Total climb from a sequence of location fixes, in meters. Returns null when
 * no point in the sequence carries a usable altitude reading — null means "not
 * measured", never zero, so a device without a barometer or with altitude
 * disabled is never reported as having run on the flat.
 *
 * Exposed standalone so the live tracking UI can show a running total, not
 * just the final one, and shared with the uploaded-GPX path so there is one
 * definition of "elevation gain" in the app.
 */
export function elevationGainMeters(points: GpsPoint[]): number | null {
  const altitudes = points
    .filter(
      (p) =>
        p.altitude !== null &&
        Number.isFinite(p.altitude) &&
        // Accuracy is optional in the sense that a synthetic or imported point
        // may report 0; only a genuinely bad reading is rejected.
        (!Number.isFinite(p.accuracy) || p.accuracy <= ELEVATION_CONFIG.MAX_ACCURACY_METERS)
    )
    .map((p) => p.altitude as number);

  if (altitudes.length === 0) return null;
  if (altitudes.length === 1) return 0;

  const series = smooth(despike(altitudes));

  // Hysteresis. `floor` tracks the lowest point since the last bank, so a
  // climb is measured from the bottom of the dip that preceded it rather than
  // from wherever the previous sample happened to land.
  let gain = 0;
  let floorAltitude = series[0];
  for (const altitude of series) {
    if (altitude > floorAltitude + ELEVATION_CONFIG.GAIN_THRESHOLD_METERS) {
      gain += altitude - floorAltitude;
      floorAltitude = altitude;
    } else if (altitude < floorAltitude) {
      floorAltitude = altitude;
    }
  }

  return Math.round(gain * 10) / 10;
}

/** A single heart-rate reading from a paired BLE device (lib/native/heart-rate.ts), timestamped so it can be matched against GPS points and hard/easy segment windows. */
export interface HrReading {
  bpm: number;
  time: number;
}

/** A user-marked hard ("work") or easy ("rest") window during interval/fartlek tracking — see lib/native/gps-tracking's segment toggle. */
export interface RunSegment {
  type: "hard" | "easy";
  startTime: number;
  endTime: number;
}

export interface IntervalSegmentSummary {
  reps: number;
  workDistanceMeters: number;
  workSecondsPerRep: number;
  restSeconds: number;
  workAvgHr: number | null;
}

export interface FartlekSegmentSummary {
  onDistanceMeters: number;
  onSeconds: number;
  onAvgHr: number | null;
}

function withinWindow<T extends { time: number }>(items: T[], segment: RunSegment): T[] {
  return items.filter((item) => item.time >= segment.startTime && item.time <= segment.endTime);
}

function segmentDistanceMeters(points: GpsPoint[], segment: RunSegment): number {
  const inWindow = withinWindow(points, segment);
  let distance = 0;
  for (let i = 1; i < inWindow.length; i++) {
    distance += haversineDistanceMeters(inWindow[i - 1], inWindow[i]);
  }
  return distance;
}

function averageHr(readings: HrReading[]): number | null {
  if (readings.length === 0) return null;
  return Math.round(readings.reduce((sum, r) => sum + r.bpm, 0) / readings.length);
}

/**
 * Reduces a user-marked hard/easy segment log into the same "structured
 * interval" shape the manual-entry form collects (reps of a uniform work
 * distance/duration, rest between them) — the existing scoring engine
 * (lib/scoring/cardio/interval-scoring.ts) only understands that uniform
 * shape, so a real run's naturally-varying rep lengths are averaged into it
 * rather than requiring a second, GPS-specific scoring path. Returns null
 * when no hard segment was ever marked (nothing to score as structured).
 */
export function summarizeIntervalSegments(
  points: GpsPoint[],
  hrReadings: HrReading[],
  segments: RunSegment[]
): IntervalSegmentSummary | null {
  const hard = segments.filter((s) => s.type === "hard" && s.endTime > s.startTime);
  if (hard.length === 0) return null;
  const easy = segments.filter((s) => s.type === "easy" && s.endTime > s.startTime);

  const totalWorkDistance = hard.reduce((sum, s) => sum + segmentDistanceMeters(points, s), 0);
  const totalWorkSeconds = hard.reduce((sum, s) => sum + (s.endTime - s.startTime) / 1000, 0);
  const totalRestSeconds = easy.reduce((sum, s) => sum + (s.endTime - s.startTime) / 1000, 0);
  const hrValues = hard.flatMap((s) => withinWindow(hrReadings, s));

  return {
    reps: hard.length,
    workDistanceMeters: Math.round((totalWorkDistance / hard.length) * 10) / 10,
    workSecondsPerRep: Math.round(totalWorkSeconds / hard.length),
    restSeconds: easy.length > 0 ? Math.round(totalRestSeconds / easy.length) : 0,
    workAvgHr: averageHr(hrValues),
  };
}

/** Same reduction as `summarizeIntervalSegments`, shaped for the fartlek "on"-piece fields instead (no rep count/rest — fartlek scoring only wants total hard-effort distance/time). */
export function summarizeFartlekSegments(
  points: GpsPoint[],
  hrReadings: HrReading[],
  segments: RunSegment[]
): FartlekSegmentSummary | null {
  const hard = segments.filter((s) => s.type === "hard" && s.endTime > s.startTime);
  if (hard.length === 0) return null;

  const onDistanceMeters = hard.reduce((sum, s) => sum + segmentDistanceMeters(points, s), 0);
  const onSeconds = hard.reduce((sum, s) => sum + (s.endTime - s.startTime) / 1000, 0);
  const hrValues = hard.flatMap((s) => withinWindow(hrReadings, s));

  return {
    onDistanceMeters: Math.round(onDistanceMeters * 10) / 10,
    onSeconds: Math.round(onSeconds),
    onAvgHr: averageHr(hrValues),
  };
}

export interface SummarizeGpsTrackOptions {
  /** True only when the user explicitly pressed "stop" and the app was still alive to record it — false covers both an app-kill recovery path and a still-in-progress session being summarized early. */
  endedCleanly: boolean;
  /** True when the native plugin's callback reported a permission error during the session. */
  permissionRevoked: boolean;
}

/** Builds the final track summary from a raw point buffer — the one place distance/pace/partial-status are computed, so the UI, the activity submission, and any future recovery path all agree on the same number. */
export function summarizeGpsTrack(points: GpsPoint[], options: SummarizeGpsTrackOptions): GpsTrackSummary {
  if (points.length < 2) {
    return {
      distanceMeters: 0,
      durationSeconds: 0,
      avgPaceSecondsPerKm: null,
      elevationGainMeters: null,
      isPartial: true,
      partialReason: options.permissionRevoked ? "permission_revoked" : "ended_without_stopping",
    };
  }

  const sorted = [...points].sort((a, b) => a.time - b.time);
  const accepted = sorted.filter((p) => p.accuracy <= GPS_TRACKING_CONFIG.MAX_ACCURACY_METERS);

  let distanceMeters = 0;
  let largestGapSeconds = 0;

  for (let i = 1; i < accepted.length; i++) {
    const prev = accepted[i - 1];
    const curr = accepted[i];

    distanceMeters += haversineDistanceMeters(prev, curr);

    const gapSeconds = (curr.time - prev.time) / 1000;
    if (gapSeconds > largestGapSeconds) largestGapSeconds = gapSeconds;
  }

  const elevationGain = elevationGainMeters(accepted);

  const durationSeconds = Math.round((sorted[sorted.length - 1].time - sorted[0].time) / 1000);
  const avgPaceSecondsPerKm = distanceMeters > 0 ? durationSeconds / (distanceMeters / 1000) : null;
  const samplingGap = largestGapSeconds > GPS_TRACKING_CONFIG.MAX_ACCEPTABLE_GAP_SECONDS;

  let partialReason: PartialReason = null;
  if (options.permissionRevoked) partialReason = "permission_revoked";
  else if (samplingGap) partialReason = "sampling_gap";
  else if (!options.endedCleanly) partialReason = "ended_without_stopping";

  return {
    distanceMeters: Math.round(distanceMeters * 10) / 10,
    durationSeconds,
    avgPaceSecondsPerKm: avgPaceSecondsPerKm !== null ? Math.round(avgPaceSecondsPerKm * 100) / 100 : null,
    elevationGainMeters: elevationGain,
    isPartial: partialReason !== null,
    partialReason,
  };
}

export const PARTIAL_REASON_LABEL: Record<NonNullable<PartialReason>, string> = {
  permission_revoked: "Location permission was turned off mid-run",
  sampling_gap: "Tracking was interrupted for part of this run",
  ended_without_stopping: "This run wasn't stopped normally — it may be incomplete",
};

// ---------------------------------------------------------------------------
// Route polyline — what gets persisted so a run can be drawn again later
// ---------------------------------------------------------------------------

/**
 * A run's shape, stored on the activity so the logbook can draw it.
 *
 * Deliberately NOT the raw fix sequence. A 10km run is around a thousand
 * fixes; at roughly 40 bytes each that is 40KB of JSONB per activity, read on
 * every logbook page load, to draw a line a few hundred pixels wide where the
 * difference is invisible. Simplified with Ramer-Douglas-Peucker and rounded
 * to five decimal places (about 1.1m, finer than GPS itself resolves), which
 * takes the same run to a few KB.
 *
 * Stored as [lat, lng] pairs rather than objects for the same reason: the key
 * names would otherwise be most of the payload.
 */
export type RoutePoint = [number, number];

export const ROUTE_CONFIG = {
  /** Simplification tolerance in meters. Below the width of a road, so the drawn line still follows the streets taken. */
  SIMPLIFY_TOLERANCE_METERS: 8,
  /** Hard ceiling on stored points. A route that needs more than this to look right at logbook size does not exist. */
  MAX_POINTS: 400,
  /** Five decimals is ~1.1m at the equator — finer than consumer GPS resolves, so rounding here loses nothing real. */
  COORDINATE_DECIMALS: 5,
} as const;

/** Perpendicular distance from `p` to the line `a`-`b`, in meters. Equirectangular projection: exact enough over the span of one run and far cheaper than a great-circle solution. */
function perpendicularDistanceMeters(p: GpsPoint, a: GpsPoint, b: GpsPoint): number {
  const latRad = toRadians((a.latitude + b.latitude) / 2);
  const mPerDegLat = 111_132;
  const mPerDegLon = 111_320 * Math.cos(latRad);

  const px = (p.longitude - a.longitude) * mPerDegLon;
  const py = (p.latitude - a.latitude) * mPerDegLat;
  const bx = (b.longitude - a.longitude) * mPerDegLon;
  const by = (b.latitude - a.latitude) * mPerDegLat;

  const lengthSq = bx * bx + by * by;
  if (lengthSq === 0) return Math.hypot(px, py);
  // Projection parameter, clamped so a point beyond either end measures to
  // that end rather than to an imaginary extension of the segment.
  const t = Math.max(0, Math.min(1, (px * bx + py * by) / lengthSq));
  return Math.hypot(px - t * bx, py - t * by);
}

/** Ramer-Douglas-Peucker. Iterative rather than recursive so a long run cannot blow the stack. */
export function simplifyRoute(points: GpsPoint[], toleranceMeters: number = ROUTE_CONFIG.SIMPLIFY_TOLERANCE_METERS): GpsPoint[] {
  if (points.length <= 2) return [...points];

  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [start, end] = stack.pop() as [number, number];
    let farthest = -1;
    let farthestDistance = 0;
    for (let i = start + 1; i < end; i++) {
      const d = perpendicularDistanceMeters(points[i], points[start], points[end]);
      if (d > farthestDistance) {
        farthestDistance = d;
        farthest = i;
      }
    }
    if (farthest !== -1 && farthestDistance > toleranceMeters) {
      keep[farthest] = true;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  return points.filter((_, i) => keep[i]);
}

/**
 * Turns a raw fix sequence into the compact form stored on the activity.
 * Returns null when there is nothing worth drawing — one point is a dot, not a
 * route, and storing it would put a map on the logbook with nothing in it.
 */
export function buildRoutePolyline(points: GpsPoint[]): RoutePoint[] | null {
  const usable = points.filter(
    (p) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      (!Number.isFinite(p.accuracy) || p.accuracy <= GPS_TRACKING_CONFIG.MAX_ACCURACY_METERS)
  );
  if (usable.length < 2) return null;

  let simplified = simplifyRoute(usable);
  // Raise the tolerance until it fits rather than truncating: cutting the tail
  // off would draw a route that stops halfway through the run.
  let tolerance: number = ROUTE_CONFIG.SIMPLIFY_TOLERANCE_METERS;
  while (simplified.length > ROUTE_CONFIG.MAX_POINTS && tolerance < 500) {
    tolerance *= 2;
    simplified = simplifyRoute(usable, tolerance);
  }

  const factor = 10 ** ROUTE_CONFIG.COORDINATE_DECIMALS;
  const round = (v: number) => Math.round(v * factor) / factor;
  return simplified.map((p): RoutePoint => [round(p.latitude), round(p.longitude)]);
}

/** Reads a stored route back, tolerating anything malformed rather than throwing inside a render. */
export function parseRoutePolyline(value: unknown): RoutePoint[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const out: RoutePoint[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const lat = Number(entry[0]);
    const lng = Number(entry[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    out.push([lat, lng]);
  }
  return out.length >= 2 ? out : null;
}
