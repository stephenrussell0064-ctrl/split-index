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
  let elevationGainMeters = 0;
  let hasElevation = false;
  let largestGapSeconds = 0;

  for (let i = 1; i < accepted.length; i++) {
    const prev = accepted[i - 1];
    const curr = accepted[i];

    distanceMeters += haversineDistanceMeters(prev, curr);

    const gapSeconds = (curr.time - prev.time) / 1000;
    if (gapSeconds > largestGapSeconds) largestGapSeconds = gapSeconds;

    if (prev.altitude !== null && curr.altitude !== null) {
      hasElevation = true;
      const delta = curr.altitude - prev.altitude;
      if (delta > 0) elevationGainMeters += delta;
    }
  }

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
    elevationGainMeters: hasElevation ? Math.round(elevationGainMeters * 10) / 10 : null,
    isPartial: partialReason !== null,
    partialReason,
  };
}

export const PARTIAL_REASON_LABEL: Record<NonNullable<PartialReason>, string> = {
  permission_revoked: "Location permission was turned off mid-run",
  sampling_gap: "Tracking was interrupted for part of this run",
  ended_without_stopping: "This run wasn't stopped normally — it may be incomplete",
};
