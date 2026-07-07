const DEFAULT_TIMEZONE = "UTC";

/** IANA timezone from the runtime (browser) or UTC on server. */
export function detectBrowserTimezone(): string {
  if (typeof Intl === "undefined" || !Intl.DateTimeFormat) return DEFAULT_TIMEZONE;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

/** Profile timezone when set; otherwise browser/local fallback. */
export function resolveTimezone(profileTimezone?: string | null): string {
  if (profileTimezone && profileTimezone.trim()) return profileTimezone.trim();
  return detectBrowserTimezone();
}

const dateKeyFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getDateKeyFormatter(timeZone: string): Intl.DateTimeFormat {
  let fmt = dateKeyFormatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateKeyFormatterCache.set(timeZone, fmt);
  }
  return fmt;
}

/** yyyy-MM-dd in the user's timezone (not UTC slice). */
export function localDateKeyInTz(iso: string | Date, timeZone: string): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = getDateKeyFormatter(timeZone).formatToParts(d);
  const year = parts.find((p) => p.type === "year")?.value ?? "1970";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/** Midnight (local) for a calendar day in the given timezone, as UTC instant. */
export function startOfLocalDayInTz(dateKey: string, timeZone: string): Date {
  // Noon UTC avoids DST edge when resolving the calendar day in `timeZone`.
  const probe = new Date(`${dateKey}T12:00:00.000Z`);
  const parts = getDateKeyFormatter(timeZone).formatToParts(probe);
  const y = Number(parts.find((p) => p.type === "year")?.value);
  const m = Number(parts.find((p) => p.type === "month")?.value);
  const d = Number(parts.find((p) => p.type === "day")?.value);

  for (let hour = 0; hour < 48; hour++) {
    const candidate = new Date(Date.UTC(y, m - 1, d, hour, 0, 0, 0));
    if (localDateKeyInTz(candidate, timeZone) === dateKey) {
      return candidate;
    }
  }
  return new Date(`${dateKey}T00:00:00.000Z`);
}
