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
  /**
   * Vertical uncertainty in meters, as reported by the device (CoreLocation's
   * `verticalAccuracy`, Android's `getVerticalAccuracyMeters`). Optional
   * because imported GPX points and everything recorded before this field
   * existed simply don't carry one.
   *
   * This is the only signal that distinguishes a barometer-aided altitude
   * (good to a metre or two) from a bare GPS fix (±10-15m), and it is the
   * one thing a filter cannot work out for itself: slow, correlated altitude
   * drift looks exactly like gentle terrain from inside the data. A negative
   * value is CoreLocation's way of saying the altitude is meaningless and
   * must be discarded rather than trusted.
   */
  altitudeAccuracy?: number | null;
  /** Milliseconds since Unix epoch. */
  time: number;
}

/**
 * A stretch of a run the athlete explicitly paused. `endTime` is null while a
 * pause is still open — including the case where the app was killed mid-pause,
 * which is why this is persisted alongside the points rather than held in
 * component state.
 *
 * Everything downstream treats a paused stretch as if it never happened: its
 * points don't contribute distance, the leg that straddles it isn't drawn as a
 * straight line across the gap, and its seconds don't count toward duration.
 * Waiting at a traffic light must not become a 400m sprint at 0:30/km pace.
 */
export interface PauseInterval {
  startTime: number;
  /** Null while the pause is still open. */
  endTime: number | null;
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

// ---------------------------------------------------------------------------
// Pause handling
// ---------------------------------------------------------------------------

/**
 * True when `time` falls inside a paused stretch. An open pause (no endTime)
 * swallows everything after it starts.
 *
 * The bounds are exclusive on purpose: a fix timestamped at the exact instant
 * of the pause is the last fix of the run before it, and one timestamped at
 * the resume is the first of the run after — both are real positions the
 * athlete stood at, and discarding them would shorten the recorded route at
 * both ends of every pause. The leg *between* them is still dropped, which is
 * the part that matters.
 */
export function isPaused(time: number, pauses: readonly PauseInterval[]): boolean {
  return pauses.some((p) => time > p.startTime && (p.endTime === null || time < p.endTime));
}

/** Milliseconds of `[from, to]` that were spent paused. Overlapping pauses can't be produced by the UI (one closes before the next opens), so a plain sum is correct here. */
export function pausedMillisBetween(from: number, to: number, pauses: readonly PauseInterval[]): number {
  let total = 0;
  for (const pause of pauses) {
    const start = Math.max(from, pause.startTime);
    const end = Math.min(to, pause.endTime ?? to);
    if (end > start) total += end - start;
  }
  return total;
}

/**
 * Moving time between two instants — wall clock minus whatever was paused.
 * The single definition of "how long was this run", shared by the live HUD's
 * clock, the lock-screen Live Activity, and the saved activity's duration, so
 * a pause can't shorten one and not the others.
 */
export function movingMillis(from: number, to: number, pauses: readonly PauseInterval[] = []): number {
  return Math.max(0, to - from - pausedMillisBetween(from, to, pauses));
}

/**
 * Distance actually covered, in meters. The one definition, used by the live
 * HUD and by the final summary alike.
 *
 * Two things are deliberately excluded. Fixes too inaccurate to believe are
 * dropped (a bad lock while standing still would otherwise register as
 * running). And a leg whose two ends sit on opposite sides of a pause is
 * skipped entirely — the athlete may have walked into a cafe, driven home, or
 * simply stood still while the receiver drifted, and joining those two fixes
 * with a straight line would invent distance they never ran.
 */
export function trackDistanceMeters(points: GpsPoint[], pauses: readonly PauseInterval[] = []): number {
  const usable = points.filter(
    (p) => p.accuracy <= GPS_TRACKING_CONFIG.MAX_ACCURACY_METERS && !isPaused(p.time, pauses)
  );

  let total = 0;
  for (let i = 1; i < usable.length; i++) {
    const prev = usable[i - 1];
    const curr = usable[i];
    // A pause that began after `prev` and ended before `curr` means the two
    // fixes are not consecutive steps of the same effort.
    if (pausedMillisBetween(prev.time, curr.time, pauses) > 0) continue;
    total += haversineDistanceMeters(prev, curr);
  }
  return total;
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
 * Four stages, each removing a different part of the problem:
 *
 *  1. Reject fixes whose accuracy is too poor to carry a believable altitude —
 *     including any the device itself flags as vertically invalid — and
 *     single-sample spikes (median-of-three), which are the multipath
 *     artefacts that produce 30m cliffs in otherwise flat data.
 *  2. Measure how noisy this particular altitude trace is, and
 *  3. smooth it by exactly as much as that measurement calls for, so the
 *     filter is as gentle as the data allows and as strong as it demands.
 *  4. Accumulate by peak prominence: bank a whole valley-to-summit climb once
 *     a descent confirms the summit was real. This is what Strava, Garmin and
 *     every other credible implementation do.
 *
 * ---------------------------------------------------------------------------
 * Second report, and why stages 2-4 changed. An athlete's run with a real 9m
 * of climb was logged as 0.
 *
 * The first fix (see above) used a single flat 5m gate: a climb was banked
 * only once it rose 5m above the lowest point since the last bank. 9m of gain
 * on ordinary rolling ground is not one 9m hill — it is three or four rises of
 * two or three metres each, and every one of them sits under a 5m gate. The
 * gate discarded all of it. That gate was doing two jobs at once, rejecting
 * noise and defining what counts as a hill, and the second job made it far too
 * blunt for the first.
 *
 * The jobs are now split, which is what lets the gate come down safely:
 *
 *  - Noise rejection is the smoothing stage's job, and the window is now
 *    sized from a measurement of the trace's own noise (the robust spread of
 *    its second differences, which cancels terrain slope and so measures
 *    sensor noise alone) rather than from the sample count. A quiet
 *    barometric trace is barely touched, so its small real bumps survive; a
 *    ±6m GPS-only trace is smoothed across a hundred samples, and its noise
 *    collapses. This is the honest part of the separation: real terrain is
 *    spatially wide, sensor noise is per-sample, so a width-based filter can
 *    tell them apart where an amplitude gate never could.
 *  - The gate itself is now a prominence threshold that starts at 2m and
 *    rises, up to the old 5m, only when the device reports that its altitude
 *    genuinely is that uncertain (see GpsPoint.altitudeAccuracy). We are never
 *    more permissive than the previous behaviour on data the hardware admits
 *    is poor.
 *
 * Accumulation is also fixed. The old rule banked only `altitude - floor` at
 * the moment of crossing and then reset the floor there, throwing away every
 * metre above the crossing point — a clean, continuous 9m climb read 5m, and
 * six clean 20m hills read 94m instead of 120m. Banking the full valley-to-
 * summit rise removes that systematic shortfall.
 *
 * Measured against the same fixtures: the reported 9m case now reads 8.4-10.9m
 * across barometric and GPS-grade noise (was 0), six clean 20m hills read
 * 120.0m (was 94m), the original 67m report reads 63m (was 67.6m), and every
 * flat-but-noisy trace — ±1.5m through ±6m, 60 samples through 900 — still
 * reads exactly 0.
 *
 * The honest trade, stated plainly: this cannot reject slow, correlated drift.
 * If a receiver's altitude wanders several metres over several minutes, that
 * wander has genuine prominence and is indistinguishable from gentle terrain
 * by any local method — no window width and no threshold separates them, and
 * a run on flat ground with a badly drifting fix can still bank a handful of
 * phantom metres. The previous code did not solve that either; it merely
 * under-reported everything by enough to hide it, which is precisely what
 * produced the 0. Where the device tells us its vertical fix is that poor, the
 * threshold widens back to 5m and we under-report on purpose, because every
 * metre of phantom climb inflates relative effort, which inflates load, which
 * prescribes more training than the athlete actually did.
 */
export const ELEVATION_CONFIG = {
  /** Fixes with worse horizontal accuracy than this are dropped for elevation purposes. Stricter than the distance filter because vertical error runs 2-3x horizontal. */
  MAX_ACCURACY_METERS: 30,
  /** Prominence a climb must have before it is banked, when the altitude source is not reporting poor vertical accuracy. */
  MIN_GAIN_THRESHOLD_METERS: 2,
  /** Ceiling on that threshold — reached when the device reports vertical uncertainty this bad or worse. The old fixed gate, kept as the worst case rather than the default. */
  MAX_GAIN_THRESHOLD_METERS: 5,
  /**
   * How much altitude noise the smoothing stage aims to leave behind, in
   * meters. A moving average of width w attenuates white noise by sqrt(w), so
   * this target is what converts a measured noise level into a window width.
   * Chosen empirically as the largest value at which every flat-but-noisy
   * fixture still reads exactly 0.
   */
  TARGET_RESIDUAL_METERS: 0.35,
  /** Hard cap on the window. At a 10m distance filter this is ~1.2km of running — beyond it, nothing recoverable is left in the trace anyway. */
  SMOOTHING_WINDOW_MAX: 121,
  /** And never smooth across more than this fraction of the whole track, or a short run's real profile would be averaged away. */
  SMOOTHING_WINDOW_TRACK_DIVISOR: 4,
  /** A sample this far from the median of its immediate neighbours is a multipath spike, not a cliff. */
  SPIKE_TOLERANCE_METERS: 25,
} as const;

function median3(a: number, b: number, c: number): number {
  return Math.max(Math.min(a, b), Math.min(Math.max(a, b), c));
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
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

/**
 * Stage 2: per-sample noise, in meters, estimated from second differences.
 *
 * Second differences (a[i+1] - 2a[i] + a[i-1]) cancel any constant slope, so a
 * long steady climb contributes nothing to this figure and only genuine
 * sample-to-sample jitter does — which is the whole point, because a
 * first-difference estimate would read a steep clean hill as "noisy" and then
 * smooth the hill away. Median absolute value rather than a mean keeps a
 * handful of surviving spikes from dominating; the constants convert that
 * robust spread to a standard deviation (1.4826 for MAD, sqrt(6) for the
 * variance a second difference adds).
 */
function altitudeNoiseMeters(altitudes: number[]): number {
  if (altitudes.length < 5) return 0;
  const curvature: number[] = [];
  for (let i = 1; i < altitudes.length - 1; i++) {
    curvature.push(Math.abs(altitudes[i + 1] - 2 * altitudes[i] + altitudes[i - 1]));
  }
  return (median(curvature) * 1.4826) / Math.sqrt(6);
}

/** Stage 3a: the window width that brings `noise` down to TARGET_RESIDUAL_METERS, bounded so it can neither run away nor eat a short track. */
function smoothingWindow(noiseMeters: number, sampleCount: number): number {
  if (noiseMeters <= ELEVATION_CONFIG.TARGET_RESIDUAL_METERS) return 1;
  const needed = Math.ceil((noiseMeters / ELEVATION_CONFIG.TARGET_RESIDUAL_METERS) ** 2);
  const window = Math.min(
    needed,
    ELEVATION_CONFIG.SMOOTHING_WINDOW_MAX,
    Math.floor(sampleCount / ELEVATION_CONFIG.SMOOTHING_WINDOW_TRACK_DIVISOR)
  );
  if (window < 2) return 1;
  // Odd widths keep the average centred, so the smoothed profile doesn't slide
  // half a sample against the real one.
  return window % 2 === 0 ? window + 1 : window;
}

/** Stage 3b: centred moving average. */
function smooth(altitudes: number[], window: number): number[] {
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
 * Stage 4a: how prominent a climb must be before it counts. Starts at the
 * floor and only widens toward the old 5m gate when the device says its own
 * altitude is that uncertain — the one piece of information a filter cannot
 * recover from the numbers themselves.
 */
function gainThresholdMeters(verticalAccuracies: number[]): number {
  if (verticalAccuracies.length === 0) return ELEVATION_CONFIG.MIN_GAIN_THRESHOLD_METERS;
  return Math.min(
    ELEVATION_CONFIG.MAX_GAIN_THRESHOLD_METERS,
    Math.max(ELEVATION_CONFIG.MIN_GAIN_THRESHOLD_METERS, median(verticalAccuracies))
  );
}

/**
 * Stage 4b: peak-prominence accumulation. Tracks the lowest point since the
 * last bank and the highest point since that low; a climb is banked in full,
 * valley to summit, once the trace has come back down by `threshold` and so
 * confirmed the summit was a summit rather than a wobble. An unconfirmed climb
 * still open when the run ends is banked too — otherwise a run that finishes
 * at the top of a hill would lose its last climb entirely.
 */
function accumulateGain(series: number[], threshold: number): number {
  let gain = 0;
  let valley = series[0];
  let summit = series[0];
  let climbing = false;

  for (const altitude of series) {
    if (altitude > summit) {
      summit = altitude;
      if (summit - valley > threshold) climbing = true;
    }
    // Until a climb is confirmed, a new low simply moves the valley down.
    if (!climbing && altitude < valley) {
      valley = altitude;
      summit = altitude;
    }
    if (climbing && altitude < summit - threshold) {
      gain += summit - valley;
      valley = altitude;
      summit = altitude;
      climbing = false;
    }
  }
  if (climbing) gain += summit - valley;

  return gain;
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
  const usable = points.filter(
    (p) =>
      p.altitude !== null &&
      Number.isFinite(p.altitude) &&
      // Accuracy is optional in the sense that a synthetic or imported point
      // may report 0; only a genuinely bad reading is rejected.
      (!Number.isFinite(p.accuracy) || p.accuracy <= ELEVATION_CONFIG.MAX_ACCURACY_METERS) &&
      // CoreLocation reports a negative vertical accuracy when the altitude it
      // handed over is not a measurement at all. Trusting it would put a
      // fabricated number straight into the athlete's training load.
      !(typeof p.altitudeAccuracy === "number" && Number.isFinite(p.altitudeAccuracy) && p.altitudeAccuracy < 0)
  );

  if (usable.length === 0) return null;
  if (usable.length === 1) return 0;

  const altitudes = despike(usable.map((p) => p.altitude as number));
  const verticalAccuracies = usable
    .map((p) => p.altitudeAccuracy)
    .filter((a): a is number => typeof a === "number" && Number.isFinite(a) && a > 0);

  const series = smooth(altitudes, smoothingWindow(altitudeNoiseMeters(altitudes), altitudes.length));
  const gain = accumulateGain(series, gainThresholdMeters(verticalAccuracies));

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
  /** Stretches the athlete paused. Optional so a session recorded before pause existed — or by the offline fallback page, which has no pause control — summarizes exactly as it always did. */
  pauses?: readonly PauseInterval[];
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

  const pauses = options.pauses ?? [];
  const sorted = [...points].sort((a, b) => a.time - b.time);
  const accepted = sorted.filter(
    (p) => p.accuracy <= GPS_TRACKING_CONFIG.MAX_ACCURACY_METERS && !isPaused(p.time, pauses)
  );

  const distanceMeters = trackDistanceMeters(sorted, pauses);

  let largestGapSeconds = 0;
  for (let i = 1; i < accepted.length; i++) {
    // Time the athlete deliberately paused is not a tracking failure, so it is
    // deducted before deciding whether this looks like an interrupted session.
    const gapSeconds = movingMillis(accepted[i - 1].time, accepted[i].time, pauses) / 1000;
    if (gapSeconds > largestGapSeconds) largestGapSeconds = gapSeconds;
  }

  // Altitude recorded while standing still at a pause is pure receiver drift,
  // never climbing, so elevation sees the same filtered points distance does.
  const elevationGain = elevationGainMeters(accepted);

  const durationSeconds = Math.round(
    movingMillis(sorted[0].time, sorted[sorted.length - 1].time, pauses) / 1000
  );
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
