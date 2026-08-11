const DAY_MS = 86_400_000;

/**
 * Whole calendar days from "now" to a "YYYY-MM-DD" date string, computed
 * entirely in UTC on both sides so the result never drifts with the
 * server's local timezone or the moment-of-day `now` happens to be called
 * at (extracted out of /api/training-goals's route.ts during a QA pass —
 * this is the one piece of date math the Training Plan's tapering and
 * feasibility logic both depend on, and it had no test coverage of its
 * own). Returns null for an empty/invalid date string. A past date
 * returns a negative number rather than clamping to 0 — callers decide
 * how to treat "already passed."
 */
export function daysUntilDate(dateStr: string | null | undefined, now: Date = new Date()): number | null {
  if (!dateStr) return null;
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  if (Number.isNaN(target)) return null;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - todayUtc) / DAY_MS);
}
