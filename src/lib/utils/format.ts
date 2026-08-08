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
