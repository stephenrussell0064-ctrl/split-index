/**
 * Everything a finished live erg session sends to POST /api/activities, as a
 * pure function of what was recorded — the same shape as the GPS run's
 * submission.ts, for the same reason: the page has two routes to this
 * payload (Stop, and accepting a session recovered after a kill) and they
 * must not read different state.
 */
import type { HrReading, PauseInterval } from "@/lib/scoring/gps-track";
import { isPaused } from "@/lib/scoring/gps-track";
import { estimateSessionEnergy, type EnergyEstimate, type LiveSport } from "@/lib/scoring/energy";
import type { SessionType } from "@/types";

export interface ErgSubmissionInput {
  sport: LiveSport;
  sessionType: SessionType;
  startedAt: number;
  endedAt: number;
  /** Every pause, with any open one already closed at `endedAt`. */
  pauses: readonly PauseInterval[];
  hrReadings: readonly HrReading[];
  hrSource: "ble" | "airpods" | null;
  profile: { weightKg: number | null; age: number | null; sex: "male" | "female" };
  /** Off the erg's own monitor, typed at the finish. Null when not entered. */
  distanceMeters: number | null;
  /** The plan session this was started from, when it was. */
  hpeSessionId: string | null;
}

export interface ErgSummary {
  movingSeconds: number;
  avgHr: number | null;
  maxHr: number | null;
  energy: EnergyEstimate;
  /** Readings taken while moving — what the averages and the calories are built from. */
  movingReadings: HrReading[];
}

export function pausedSeconds(pauses: readonly PauseInterval[], endedAt: number): number {
  return pauses.reduce((s, p) => s + Math.max(0, ((p.endTime ?? endedAt) - p.startTime) / 1000), 0);
}

export function summariseErgSession(input: Omit<ErgSubmissionInput, "distanceMeters" | "hpeSessionId" | "sessionType">): ErgSummary {
  const movingSeconds = Math.max(0, Math.round((input.endedAt - input.startedAt) / 1000 - pausedSeconds(input.pauses, input.endedAt)));
  const movingReadings = input.hrReadings.filter((r) => !isPaused(r.time, input.pauses));
  const bpm = movingReadings.map((r) => r.bpm);
  return {
    movingSeconds,
    avgHr: bpm.length > 0 ? Math.round(bpm.reduce((s, v) => s + v, 0) / bpm.length) : null,
    maxHr: bpm.length > 0 ? Math.max(...bpm) : null,
    energy: estimateSessionEnergy({
      sport: input.sport,
      readings: movingReadings,
      movingSeconds,
      endTime: input.endedAt,
      profile: input.profile,
    }),
    movingReadings,
  };
}

/** A rowing split per 500m from distance and moving time, the convention the erg's own monitor uses. */
export function splitSecondsPer500(distanceMeters: number, movingSeconds: number): number | null {
  if (!(distanceMeters > 0) || !(movingSeconds > 0)) return null;
  return movingSeconds / (distanceMeters / 500);
}

export function buildErgActivityPayload(input: ErgSubmissionInput): Record<string, unknown> {
  const summary = summariseErgSession(input);
  const split =
    input.sport === "rowing" && input.distanceMeters != null
      ? splitSecondsPer500(input.distanceMeters, summary.movingSeconds)
      : null;
  return {
    sport: input.sport,
    started_at: new Date(input.startedAt).toISOString(),
    duration_seconds: Math.max(1, summary.movingSeconds),
    ...(input.distanceMeters != null && input.distanceMeters > 0 ? { distance_meters: Math.round(input.distanceMeters) } : {}),
    ...(split != null ? { avg_split_seconds: Math.round(split * 100) / 100 } : {}),
    ...(summary.avgHr != null ? { avg_heart_rate: summary.avgHr } : {}),
    ...(summary.maxHr != null ? { max_heart_rate: summary.maxHr } : {}),
    session_type: input.sessionType,
    source: "live",
    // Recorded, not typed. The distance off the monitor is the one field
    // entered by hand, when it was.
    logging_effort: {
      entry: "live",
      fields_touched: input.distanceMeters != null ? 2 : 1,
      seconds_to_save: 0,
    },
    live_session: {
      calories_kcal: Math.round(summary.energy.kcal),
      calories_method: summary.energy.method,
      calories_assumed_profile: summary.energy.assumed,
      hr_samples: summary.movingReadings.length,
      hr_source: input.hrSource,
      paused_seconds: Math.round(pausedSeconds(input.pauses, input.endedAt)),
    },
    ...(input.hpeSessionId ? { hpe_session_id: input.hpeSessionId } : {}),
  };
}
