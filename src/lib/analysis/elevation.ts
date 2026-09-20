import { accumulateElevationGain, smoothAltitudeProfile } from "@/lib/scoring/gps-track";
import type { ActivityStreams } from "./streams";

/**
 * Elevation over the run, from the altitude stream.
 *
 * The series is cleaned with the same despike-and-smooth stages the stored
 * elevation gain was banked from (gps-track.ts), so the profile drawn on the
 * activity page and the per-split climb figures are the same trace as the
 * run's own total — not a noisier re-reading of it that disagrees by 50m.
 */
export interface ElevationAnalysis {
  gainMeters: number;
  lossMeters: number;
  minAltitudeMeters: number;
  maxAltitudeMeters: number;
  /** Steepest kilometre-scale grade climbed, as a percentage of distance; null when the run had no sustained climb. */
  steepestGradePercent: number | null;
}

/**
 * The altitude channel with gaps interpolated and the trace smoothed, aligned
 * one-to-one with the stream's samples. Null when fewer than two fixes carried
 * a usable altitude — a device without a barometer or with altitude disabled
 * has no profile, not a flat one.
 */
export function smoothedAltitudeSeries(streams: ActivityStreams): number[] | null {
  const raw = streams.altitude;
  if (!raw) return null;
  const known: number[] = [];
  for (let i = 0; i < raw.length; i++) if (raw[i] !== null) known.push(i);
  if (known.length < 2) return null;

  const filled: number[] = new Array(raw.length);
  // Ends: hold the nearest known value. Gaps: interpolate by distance, since
  // that is the axis terrain varies along.
  for (let i = 0; i < known[0]; i++) filled[i] = raw[known[0]] as number;
  for (let k = 0; k < known.length - 1; k++) {
    const a = known[k];
    const b = known[k + 1];
    const va = raw[a] as number;
    const vb = raw[b] as number;
    filled[a] = va;
    const span = streams.distance[b] - streams.distance[a];
    for (let i = a + 1; i < b; i++) {
      const f = span > 0 ? (streams.distance[i] - streams.distance[a]) / span : (i - a) / (b - a);
      filled[i] = va + (vb - va) * f;
    }
  }
  const lastKnown = known[known.length - 1];
  for (let i = lastKnown; i < raw.length; i++) filled[i] = raw[lastKnown] as number;

  return smoothAltitudeProfile(filled);
}

/** Climb and descent over samples [from, to] of an already-smoothed series. */
export function gainAndLossOver(series: number[], from: number, to: number): { gain: number; loss: number } {
  const slice = series.slice(Math.max(0, from), Math.min(series.length, to + 1));
  if (slice.length < 2) return { gain: 0, loss: 0 };
  return {
    gain: Math.round(accumulateElevationGain(slice) * 10) / 10,
    loss: Math.round(accumulateElevationGain(slice.map((v) => -v)) * 10) / 10,
  };
}

/** Distance over which the steepest-grade figure is measured. Short enough to find the hill, long enough that a single noisy leg cannot read as a 40% wall. */
const GRADE_WINDOW_METERS = 500;

export function analyzeElevation(
  streams: ActivityStreams,
  smoothed: number[] | null = smoothedAltitudeSeries(streams)
): ElevationAnalysis | null {
  if (!smoothed || smoothed.length < 2) return null;

  const { gain, loss } = gainAndLossOver(smoothed, 0, smoothed.length - 1);
  let min = Infinity;
  let max = -Infinity;
  for (const v of smoothed) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  let steepest: number | null = null;
  let j = 0;
  for (let i = 0; i < smoothed.length; i++) {
    while (j < smoothed.length && streams.distance[j] - streams.distance[i] < GRADE_WINDOW_METERS) j++;
    if (j >= smoothed.length) break;
    const run = streams.distance[j] - streams.distance[i];
    const rise = smoothed[j] - smoothed[i];
    if (run <= 0 || rise <= 0) continue;
    const grade = (rise / run) * 100;
    if (steepest === null || grade > steepest) steepest = grade;
  }

  return {
    gainMeters: gain,
    lossMeters: loss,
    minAltitudeMeters: Math.round(min),
    maxAltitudeMeters: Math.round(max),
    steepestGradePercent: steepest !== null ? Math.round(steepest * 10) / 10 : null,
  };
}
