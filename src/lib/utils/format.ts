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

export function formatIndex(value: number): string {
  return Math.round(value).toLocaleString();
}

export function formatTrend(value: number): string {
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
}

export function formatWeight(kg: number): string {
  return `${kg.toFixed(1)} kg`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}
