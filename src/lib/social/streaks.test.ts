import { describe, expect, it } from "vitest";
import { computeTrainingStreak } from "./streaks";
import { computeStreakMetrics } from "@/lib/retention/streak-utils";

/**
 * ONE STREAK, NOT TWO.
 *
 * The dashboard and the social surfaces each had their own implementation, and
 * they disagreed every single morning — the dashboard said "6 day streak" while
 * the athlete's own public profile said none, because one of them ended the
 * streak the moment today had no session in it and the other did not. They also
 * bucketed days in different time zones.
 *
 * These tests pin the agreement rather than either implementation, so the two
 * cannot drift apart again without something going red.
 */

const DAY = 86400000;
const ZONE = "Europe/London";

/** ISO timestamps for `days` consecutive days ending `endingDaysAgo` days back. */
function sessions(from: Date, days: number, endingDaysAgo = 0): string[] {
  return Array.from({ length: days }, (_, i) =>
    new Date(from.getTime() - (endingDaysAgo + i) * DAY).toISOString()
  );
}

describe("the social streak is the dashboard streak", () => {
  const now = new Date("2026-09-10T09:00:00Z");

  it("agrees when the athlete has already trained today", () => {
    const dates = sessions(now, 5);
    expect(computeTrainingStreak(dates, now, ZONE)).toBe(
      computeStreakMetrics(dates, now, ZONE).streak
    );
  });

  it("keeps the streak alive on a rest day, which is the whole disagreement", () => {
    // Six days up to yesterday, nothing today. The old social implementation
    // counted back from TODAY and broke immediately, returning 0 — so at 8am
    // an athlete on a six-day run was told on one screen that they had one and
    // on another that they did not.
    const dates = sessions(now, 6, 1);
    expect(computeTrainingStreak(dates, now, ZONE)).toBe(6);
    expect(computeStreakMetrics(dates, now, ZONE).streak).toBe(6);
  });

  it("still reports zero once the gap is real", () => {
    // Nothing yesterday and nothing today: the streak is genuinely over, and
    // "today is a rest day" must not paper over the day before it as well.
    const dates = sessions(now, 4, 2);
    expect(computeTrainingStreak(dates, now, ZONE)).toBe(0);
  });

  it("returns zero for an athlete with no sessions at all", () => {
    expect(computeTrainingStreak([], now, ZONE)).toBe(0);
  });

  it("counts the athlete's own days, not UTC days", () => {
    /*
      21:30 in Los Angeles on the 9th is 04:30 UTC on the 10th. Bucketing by
      UTC — which the old implementation did, via `iso.slice(0, 10)` — files
      that evening session under the wrong date, and every evening trainer west
      of Greenwich had their streak counted against a day boundary seven or
      eight hours ahead of the one they live in.
    */
    const la = "America/Los_Angeles";
    const reference = new Date("2026-09-10T20:00:00-07:00");
    const eveningSessions = [
      "2026-09-10T21:30:00-07:00",
      "2026-09-09T21:30:00-07:00",
      "2026-09-08T21:30:00-07:00",
    ];
    expect(computeTrainingStreak(eveningSessions, reference, la)).toBe(3);
  });
});
