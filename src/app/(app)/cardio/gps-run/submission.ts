import {
  buildRoutePolyline,
  isPaused,
  summarizeFartlekSegments,
  summarizeIntervalSegments,
  type GpsPoint,
  type GpsTrackSummary,
  type HrReading,
  type PauseInterval,
  type RunSegment,
} from "@/lib/scoring/gps-track";
import type { SessionType } from "@/types";

/**
 * Everything a finished GPS session sends to POST /api/activities, built as a
 * pure function of the track it came from.
 *
 * Extracted out of the tracking page because of the bug it exists to prevent.
 * The page has two ways to reach this payload — the athlete pressing stop, and
 * the athlete accepting a session recovered after the app was killed — and the
 * two do NOT share a source of points. A recovered run's fixes come back from
 * `recoverOrphanedSession()`; they are not, and cannot be, in the component's
 * `livePoints` state, because the component mounted fresh after the kill. The
 * previous code read that state unconditionally, so the recovery path posted a
 * run with no route and no start coordinate (and therefore no temperature
 * lookup, which feeds scoring) while cheerfully reporting the full distance
 * from the summary sitting next to it.
 *
 * Taking the points as an argument is what makes that class of mistake
 * impossible to make silently, and testable without a device.
 */
export interface GpsSubmissionInput {
  sport: string;
  sessionType: SessionType;
  /** ISO timestamp the run began. */
  startedAtIso: string;
  /** The authoritative numbers: distance, duration, pace, climb, partial-ness. Computed from the full raw track by summarizeGpsTrack — never from the route polyline below. */
  summary: GpsTrackSummary;
  /** The run's raw fixes. For a recovered session these are the RECOVERED points, not the live ones. */
  points: GpsPoint[];
  /** The run's pauses, with any open pause already closed. */
  pauses: readonly PauseInterval[];
  hrReadings: HrReading[];
  cadenceReadings: number[];
  segments: RunSegment[];
}

function mean(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/** Interval/fartlek session types reduce their marked hard/easy segments into the same structured fields the manual form collects. */
function segmentFields(input: GpsSubmissionInput): Record<string, number | undefined> {
  if (input.sessionType === "interval") {
    const seg = summarizeIntervalSegments(input.points, input.hrReadings, input.segments);
    if (!seg) return {};
    return {
      interval_reps: seg.reps,
      interval_work_distance_meters: seg.workDistanceMeters,
      interval_work_seconds: seg.workSecondsPerRep,
      interval_rest_seconds: seg.restSeconds,
      interval_work_avg_hr: seg.workAvgHr ?? undefined,
    };
  }
  if (input.sessionType === "fartlek") {
    const seg = summarizeFartlekSegments(input.points, input.hrReadings, input.segments);
    if (!seg) return {};
    return {
      fartlek_on_distance_meters: seg.onDistanceMeters,
      fartlek_on_seconds: seg.onSeconds,
      fartlek_on_avg_hr: seg.onAvgHr ?? undefined,
    };
  }
  return {};
}

export function buildGpsActivityPayload(input: GpsSubmissionInput): Record<string, unknown> {
  // Fixes recorded while paused are receiver drift around a standing athlete,
  // not route and not climb, so the drawn line never sees them.
  const movingPoints = input.points.filter((p) => !isPaused(p.time, input.pauses));
  const startPoint = input.points[0];
  const bpm = input.hrReadings.map((r) => r.bpm);

  return {
    sport: input.sport,
    started_at: input.startedAtIso,
    duration_seconds: input.summary.durationSeconds,
    distance_meters: input.summary.distanceMeters,
    elevation_meters: input.summary.elevationGainMeters ?? undefined,
    avg_pace_seconds_per_km: input.summary.avgPaceSecondsPerKm ?? undefined,
    avg_heart_rate: mean(bpm),
    max_heart_rate: bpm.length > 0 ? Math.max(...bpm) : undefined,
    avg_cadence: mean(input.cadenceReadings),
    session_type: input.sessionType,
    source: "gps",
    is_partial_track: input.summary.isPartial,
    // Starting coordinates only — used server-side to auto-fetch the
    // temperature at run time (no manual entry needed for GPS runs). Never
    // persisted as their own column, just consumed once.
    start_latitude: startPoint?.latitude,
    start_longitude: startPoint?.longitude,
    // The run's shape, simplified for storage — this is what lets the logbook
    // draw the route back. Raw fixes are deliberately not sent: a 10km run is
    // ~1000 of them and the drawn difference is invisible.
    //
    // Sent whole, ends included. The server removes the first and last 200m
    // before storing it (the privacy zone — see applyRoutePrivacyZone), and
    // deliberately not here: the guarantee that no route is ever written
    // starting at an athlete's front door has to hold for every client that
    // ever posts to that endpoint, including builds already on phones.
    route: buildRoutePolyline(movingPoints) ?? undefined,
    ...segmentFields(input),
  };
}
