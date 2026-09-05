import type { SportType } from "@/types";

export function formatDuration(seconds: number): string {
  // Round to whole seconds first — some callers pass a benchmark-equivalent
  // time carrying floating-point noise (e.g. 433.3706000000000024), which
  // would otherwise leak into the displayed string verbatim.
  const rounded = Math.round(seconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function formatPace(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${s.toString().padStart(2, "0")}/km`;
}

/** Cyclists think in speed (km/h), not pace (min/km) — same stored seconds-per-km number, just inverted for display. */
export function formatSpeed(secondsPerKm: number): string {
  if (secondsPerKm <= 0) return "—";
  return `${(3600 / secondsPerKm).toFixed(1)} km/h`;
}

export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

/** mm:ss for a per-unit-distance pace, without the unit suffix. */
function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * How far each sport's pace is quoted over. This is the convention
 * `sportMetricLabel` in scoring-display.ts already DECLARES ("pace per 100m"
 * for swimming, "split / 500m" for the ergs) — it just had no formatter
 * implementing it, so every surface rendered min/km regardless and swimming
 * was quoted in units no swimmer uses.
 *
 * Sports absent from this map are quoted per kilometre, which is right for
 * running and walking and is the only sensible fallback for anything new.
 */
const PACE_DISTANCE_METERS: Partial<Record<SportType, number>> = {
  swimming: 100,
  rowing: 500,
  ski_erg: 500,
};

/**
 * The session's speed in the units that sport is actually spoken in.
 *
 * ONE definition, shared by every surface that renders a pace, so a swim does
 * not read as 4:36/100m in one place and 46:00/km in another. Callers pass
 * whichever of the two stored columns they have: `avgSplitSeconds` (the ergs'
 * own per-500m column) or `avgPaceSecondsPerKm`. Rowing and ski-erg populate
 * only the former, everything else only the latter, but both are accepted
 * from either sport rather than assuming — a manually logged or imported
 * session can arrive with the other one filled in.
 *
 * Returns null when there is nothing to show, so callers can omit the metric
 * rather than render a dash.
 */
export function formatSportPace(
  sport: SportType,
  input: { avgPaceSecondsPerKm?: number | null; avgSplitSeconds?: number | null }
): string | null {
  const paceUnitMeters = PACE_DISTANCE_METERS[sport];

  // The ergs' own stored split column is already per 500m — use it directly
  // rather than round-tripping through a per-km number.
  if (paceUnitMeters === 500 && input.avgSplitSeconds && input.avgSplitSeconds > 0) {
    return `${clock(input.avgSplitSeconds)}/500m`;
  }

  const secondsPerKm = input.avgPaceSecondsPerKm;
  if (!secondsPerKm || secondsPerKm <= 0) return null;

  // Cyclists think in speed, not pace — same number, inverted.
  if (sport === "outdoor_cycling") return formatSpeed(secondsPerKm);

  if (paceUnitMeters === undefined) return formatPace(secondsPerKm);
  return `${clock(secondsPerKm * (paceUnitMeters / 1000))}/${paceUnitMeters}m`;
}

/**
 * Split Index scores are computed internally on a 0–1000 scale (all
 * calibration, tests, and stored history stay in that space — rescaling
 * there would mean re-deriving every anchor/threshold in this codebase).
 * This is the single rescale-to-display boundary: divide by 10 for the
 * user-facing 0–100 scale, decimals only where the result isn't a whole
 * number (user feedback: "rescale all scores from 0-1000 to 0-100, using
 * decimals where required").
 */
const DISPLAY_SCALE = 10;

export function formatIndex(value: number): string {
  const rescaled = value / DISPLAY_SCALE;
  return Number.isInteger(rescaled) ? rescaled.toLocaleString() : rescaled.toFixed(1);
}

export function formatTrend(value: number): string {
  const rescaled = value / DISPLAY_SCALE;
  const sign = rescaled >= 0 ? "+" : "";
  return `${sign}${rescaled.toFixed(1)}`;
}

export function formatWeight(kg: number): string {
  return `${kg.toFixed(1)} kg`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
