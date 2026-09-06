import { computeStreakMetrics } from "@/lib/retention/streak-utils";

/**
 * Consecutive training days, for the social surfaces.
 *
 * ONE DEFINITION, NOT TWO. This used to be its own implementation, and it
 * disagreed with the dashboard's `computeStreakMetrics` in two ways that both
 * bit every single morning:
 *
 *   1. IT ENDED THE STREAK ON A REST DAY. It counted back from TODAY and broke
 *      immediately if today had no session — so at 8am, before anyone has
 *      trained, the dashboard said "6 day streak" and the athlete's own public
 *      profile and the social page said none. The dashboard's version is the
 *      right one: a streak that dies at midnight and revives at lunchtime is
 *      not a streak, and the app's own "log today to keep it" warning only
 *      makes sense if the streak is still alive while you are being warned.
 *
 *   2. IT USED UTC DAYS. `iso.slice(0, 10)` and `toISOString()` bucket by UTC,
 *      so for anyone west of Greenwich an evening session landed on tomorrow's
 *      date and for anyone far enough east a morning one landed on yesterday's.
 *      The dashboard buckets by the athlete's own time zone, which is the only
 *      reading of "consecutive days" that matches what they remember doing.
 *
 * Delegating rather than deleting keeps the social call sites unchanged and
 * makes it impossible for the two to drift apart again.
 */
export function computeTrainingStreak(
  activityDates: string[],
  referenceDate = new Date(),
  /** The athlete's own zone. Omitted falls back to the server's, which is the previous behaviour and no worse. */
  profileTimezone?: string | null
): number {
  if (activityDates.length === 0) return 0;
  return computeStreakMetrics(activityDates, referenceDate, profileTimezone).streak;
}
