const DEFAULT_TIMEZONE = "UTC";

/** IANA timezone from the runtime (browser) or UTC on server. */
export function detectBrowserTimezone(): string {
  if (typeof Intl === "undefined" || !Intl.DateTimeFormat) return DEFAULT_TIMEZONE;
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIMEZONE;
}

/** Profile timezone when set; otherwise browser/local fallback. */
/**
 * Is this a time zone `Intl` will actually accept?
 *
 * `Intl.DateTimeFormat` THROWS a RangeError on an unknown zone, and this value
 * comes from a request body. `{"timezone":"Not/AZone"}` was enough to make
 * every subsequent dashboard and analytics render throw inside a server
 * component — a permanent 500 on the athlete's own home page, from one POST,
 * with no way back short of editing the database.
 *
 * It is also reachable without malice: `resolvedOptions().timeZone` on an
 * unusual or outdated engine can return a name the server's own ICU build does
 * not know.
 */
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(profileTimezone?: string | null): string {
  const stored = profileTimezone?.trim();
  // Validated on the way OUT as well as on the way in: rows written before the
  // API validated anything are still in the database, and a stored bad value
  // must degrade to a sensible default rather than take the page down.
  if (stored && isValidTimezone(stored)) return stored;
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

/**
 * Move a `YYYY-MM-DD` key by whole calendar days.
 *
 * PURE CALENDAR ARITHMETIC, no instants involved — which is the entire point.
 * Every day-walking loop in this codebase used to do
 * `new Date(reference.getTime() - i * 86400000)` and then read the local
 * calendar day off the result, and subtracting a fixed 86 400 000 ms is only
 * "one day" when the day happens to be 24 hours long. It is 23 on the morning
 * the clocks go forward and 25 when they go back, so the walk skipped a day in
 * spring and repeated one in autumn.
 *
 * Measured before this existed, with five consecutive training days logged:
 * an athlete in London opening the app at 00:30 on 31 March 2025 was told
 * their streak was 4 — and `seedRetentionNotifications` fires the "streak at
 * risk" push off exactly that number, so the app broke their streak and then
 * told them about it. In October the same athlete was credited with a day they
 * had not trained. Santiago, whose transition happens at midnight, was wrong
 * for a whole day.
 *
 * `Date.UTC` is used purely as a calendar calculator here: no zone is
 * consulted, no instant is interpreted, so no DST rule can apply.
 */
export function shiftDateKey(dateKey: string, deltaDays: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + deltaDays));
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
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
