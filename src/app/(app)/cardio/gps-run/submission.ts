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
  /**
   * Heart rate and cadence from before an interruption, as totals.
   *
   * `hrReadings` is React state and does not survive the WebView being
   * reclaimed, so a rejoined run's readings cover only the part after the
   * rejoin. Averaging those alone reported the last ten minutes of a
   * ninety-minute run as the whole session's average heart rate — a scoring
   * input, and a plausible-looking number.
   *
   * Null for a run that was never interrupted, and for one recovered from a
   * record written before these were carried.
   */
  priorTotals?: {
    hrSum: number;
    hrCount: number;
    hrMax: number;
    cadenceSum: number;
    cadenceCount: number;
  } | null;
  segments: RunSegment[];
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

  /*
    Fold in whatever was recorded before an interruption. Weighted by count,
    not averaged with the post-rejoin average — eighty minutes and ten minutes
    are not two equal halves, and treating them as such would swap one wrong
    number for a subtler one.
  */
  const prior = input.priorTotals ?? null;
  const hrCount = bpm.length + (prior?.hrCount ?? 0);
  const hrSum = bpm.reduce((sum, b) => sum + b, 0) + (prior?.hrSum ?? 0);
  const avgHeartRate = hrCount > 0 ? Math.round(hrSum / hrCount) : undefined;
  const maxHeartRate = hrCount > 0 ? Math.max(...bpm, prior?.hrMax ?? 0) : undefined;

  const cadenceCount = input.cadenceReadings.length + (prior?.cadenceCount ?? 0);
  const cadenceSum =
    input.cadenceReadings.reduce((sum, c) => sum + c, 0) + (prior?.cadenceSum ?? 0);
  const avgCadence = cadenceCount > 0 ? Math.round(cadenceSum / cadenceCount) : undefined;

  return {
    sport: input.sport,
    started_at: input.startedAtIso,
    duration_seconds: input.summary.durationSeconds,
    distance_meters: input.summary.distanceMeters,
    elevation_meters: input.summary.elevationGainMeters ?? undefined,
    avg_pace_seconds_per_km: input.summary.avgPaceSecondsPerKm ?? undefined,
    avg_heart_rate: avgHeartRate,
    max_heart_rate: maxHeartRate,
    avg_cadence: avgCadence,
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
