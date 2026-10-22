/**
 * The free-plan limits, and the arithmetic that turns raw counts into
 * "fine / getting close / act now". Pure, so it is tested without a
 * database; the route reads migration 092's function and hands the result
 * here.
 *
 * The limits are Supabase's published free-plan figures as of October 2026.
 * They change occasionally and this file is the one place to update them.
 */

export const FREE_PLAN_LIMITS = {
  /** Monthly active users included on the free plan. */
  monthlyActiveUsers: 50_000,
  /** Database size, bytes (500 MB). */
  databaseBytes: 500 * 1024 * 1024,
  /** File storage, bytes (1 GB). */
  storageBytes: 1024 * 1024 * 1024,
  /** A free project pauses after this many days with no API activity. */
  pauseAfterDays: 7,
} as const;

/** What migration 092's function returns. */
export interface HeadroomRaw {
  database_bytes: number;
  storage_bytes: number;
  storage_objects: number;
  users_total: number;
  users_active_calendar_month: number;
  users_active_30d: number;
  users_onboarded: number;
  activities_total: number;
  last_activity_at: string | null;
  measured_at: string;
}

export type HeadroomLevel = "ok" | "warn" | "critical";

export interface Meter {
  label: string;
  used: number;
  limit: number;
  /** 0–1, uncapped so a breach reads as more than 100%. */
  fraction: number;
  level: HeadroomLevel;
  /** Human-readable "used of limit". */
  display: string;
}

export interface PauseRisk {
  lastActivityAt: string | null;
  quietDays: number | null;
  /** Days left before a free project pauses, or null when unknown. */
  daysUntilPause: number | null;
  level: HeadroomLevel;
  note: string;
}

export interface Headroom {
  measuredAt: string;
  meters: Meter[];
  pause: PauseRisk;
  counts: {
    usersTotal: number;
    usersOnboarded: number;
    usersActive30d: number;
    activitiesTotal: number;
    storageObjects: number;
  };
  limits: typeof FREE_PLAN_LIMITS;
}

/** Supabase emails at 80%; "critical" here is the same line. */
const WARN_AT = 0.5;
const CRITICAL_AT = 0.8;

export function levelFor(fraction: number): HeadroomLevel {
  if (fraction >= CRITICAL_AT) return "critical";
  if (fraction >= WARN_AT) return "warn";
  return "ok";
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function meter(label: string, used: number, limit: number, format: (n: number) => string): Meter {
  const fraction = limit > 0 ? used / limit : 0;
  return {
    label,
    used,
    limit,
    fraction,
    level: levelFor(fraction),
    display: `${format(used)} of ${format(limit)}`,
  };
}

/**
 * Days since the project last saw a sign-in or a save, and how that compares
 * with the seven-day pause. "Quiet" is measured from `now`, which the route
 * passes in so this stays testable.
 */
export function pauseRisk(lastActivityAt: string | null, now: Date, limits = FREE_PLAN_LIMITS): PauseRisk {
  if (!lastActivityAt) {
    return {
      lastActivityAt: null,
      quietDays: null,
      daysUntilPause: null,
      level: "critical",
      note: "No sign-in or save on record at all.",
    };
  }
  const last = new Date(lastActivityAt);
  const quietDays = Math.max(0, (now.getTime() - last.getTime()) / 86_400_000);
  const daysUntilPause = Math.max(0, limits.pauseAfterDays - quietDays);
  const level: HeadroomLevel = quietDays >= 5 ? "critical" : quietDays >= 3 ? "warn" : "ok";
  const whole = Math.floor(quietDays);
  const note =
    quietDays < 1
      ? "Activity today. A free project pauses after seven quiet days."
      : `${whole} quiet day${whole === 1 ? "" : "s"}. Pauses at ${limits.pauseAfterDays} — roughly ${Math.ceil(daysUntilPause)} to go.`;
  return { lastActivityAt, quietDays, daysUntilPause, level, note };
}

export function computeHeadroom(raw: HeadroomRaw, now = new Date(), limits = FREE_PLAN_LIMITS): Headroom {
  const identity = (n: number) => n.toLocaleString("en-GB");
  return {
    measuredAt: raw.measured_at,
    meters: [
      meter("Monthly active users", raw.users_active_calendar_month, limits.monthlyActiveUsers, identity),
      meter("Database", raw.database_bytes, limits.databaseBytes, formatBytes),
      meter("File storage", raw.storage_bytes, limits.storageBytes, formatBytes),
    ],
    pause: pauseRisk(raw.last_activity_at, now, limits),
    counts: {
      usersTotal: raw.users_total,
      usersOnboarded: raw.users_onboarded,
      usersActive30d: raw.users_active_30d,
      activitiesTotal: raw.activities_total,
      storageObjects: raw.storage_objects,
    },
    limits,
  };
}

/** The worst level across the meters and the pause check — the card's headline colour. */
export function overallLevel(headroom: Headroom): HeadroomLevel {
  const rank: Record<HeadroomLevel, number> = { ok: 0, warn: 1, critical: 2 };
  return [...headroom.meters.map((m) => m.level), headroom.pause.level].reduce<HeadroomLevel>(
    (worst, l) => (rank[l] > rank[worst] ? l : worst),
    "ok"
  );
}
