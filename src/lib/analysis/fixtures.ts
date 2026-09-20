import type { CadenceSample, GpsPoint, HrReading, PauseInterval } from "@/lib/scoring/gps-track";
import { buildActivityStreams, type ActivityStreams } from "./streams";

/**
 * Synthetic tracks for the analysis tests. A fix every `spacingMeters` due
 * north from a fixed origin, at a pace that may vary along the run, with an
 * optional altitude profile and sensor readings. Shared by every test file in
 * this directory so they all describe the same runner.
 */
export const ORIGIN_LAT = 51.5;
export const ORIGIN_LNG = -0.12;
/** Degrees of latitude per metre — close enough over a few kilometres that haversine reads back what was put in to within a fraction of a metre. */
export const DEG_PER_METER = 1 / 111_194.93;

export interface SyntheticRun {
  lengthMeters: number;
  /** Seconds per km at a given distance into the run. Constant pace when a number. */
  pace: number | ((meters: number) => number);
  spacingMeters?: number;
  /** Altitude at a given distance. Omit for no altitude channel. */
  altitude?: (meters: number) => number;
  /** Heart rate at a given elapsed second. Omit for no readings. */
  heartRate?: (seconds: number) => number;
  /** Cadence at a given elapsed second. */
  cadence?: (seconds: number) => number;
  startTime?: number;
}

export interface SyntheticTrack {
  points: GpsPoint[];
  hrReadings: HrReading[];
  cadenceSamples: CadenceSample[];
  pauses: PauseInterval[];
}

export function syntheticTrack(run: SyntheticRun): SyntheticTrack {
  const spacing = run.spacingMeters ?? 10;
  const start = run.startTime ?? 1_700_000_000_000;
  const paceAt = typeof run.pace === "number" ? () => run.pace as number : run.pace;
  const count = Math.round(run.lengthMeters / spacing) + 1;

  const points: GpsPoint[] = [];
  let elapsedMs = 0;
  for (let i = 0; i < count; i++) {
    const meters = i * spacing;
    if (i > 0) elapsedMs += (paceAt(meters) / 1000) * spacing * 1000;
    points.push({
      latitude: ORIGIN_LAT + meters * DEG_PER_METER,
      longitude: ORIGIN_LNG,
      accuracy: 5,
      altitude: run.altitude ? run.altitude(meters) : null,
      altitudeAccuracy: run.altitude ? 2 : undefined,
      time: start + Math.round(elapsedMs),
    });
  }

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const hrReadings: HrReading[] = run.heartRate
    ? Array.from({ length: totalSeconds + 1 }, (_, s) => ({ bpm: Math.round(run.heartRate!(s)), time: start + s * 1000 }))
    : [];
  const cadenceSamples: CadenceSample[] = run.cadence
    ? Array.from({ length: totalSeconds + 1 }, (_, s) => ({ spm: Math.round(run.cadence!(s)), time: start + s * 1000 }))
    : [];

  return { points, hrReadings, cadenceSamples, pauses: [] };
}

export function syntheticStreams(run: SyntheticRun, pauses: PauseInterval[] = []): ActivityStreams {
  const track = syntheticTrack(run);
  const streams = buildActivityStreams({ ...track, pauses });
  if (!streams) throw new Error("synthetic track produced no streams");
  return streams;
}
