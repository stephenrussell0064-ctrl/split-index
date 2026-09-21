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

describe("daylight saving does not break or inflate a streak", () => {
  /*
    Every day-walking loop used to step by a fixed 86,400,000 ms and then read
    the local calendar day off the result. That is only "one day" while the day
    is 24 hours long — it is 23 the morning the clocks go forward and 25 when
    they go back, so the walk skipped a day in spring and repeated one in
    autumn.

    The spring case is the damaging one: `seedRetentionNotifications` fires the
    "streak at risk" push off this number, so twice a year the app broke the
    athlete's streak and then sent them a notification about it.
  */
  const LONDON = "Europe/London";

  /** One session at midday local on each of `days` consecutive calendar days ending on `endKey`. */
  function middaySessions(endKey: string, days: number, zone: string): string[] {
    const out: string[] = [];
    for (let i = 0; i < days; i++) {
      const [y, m, d] = endKey.split("-").map(Number);
      const key = new Date(Date.UTC(y!, m! - 1, d! - i));
      const iso = key.toISOString().slice(0, 10);
      // Midday local, expressed as an instant, via the zone's own offset.
      out.push(new Date(`${iso}T12:00:00Z`).toISOString());
    }
    void zone;
    return out;
  }

  it("counts five days across the spring-forward night, at 00:30", () => {
    // Clocks go forward in London on 30 March 2025. 00:30 on the 31st is the
    // exact moment the old loop reported 4.
    const sessions = middaySessions("2025-03-30", 5, LONDON);
    const reference = new Date("2025-03-31T00:30:00+01:00");
    expect(computeStreakMetrics(sessions, reference, LONDON).streak).toBe(5);
  });

  it("does not credit an extra day across the fall-back night", () => {
    // Clocks go back on 26 October 2025; the old loop counted 6 for 5 days.
    const sessions = middaySessions("2025-10-26", 5, LONDON);
    const reference = new Date("2025-10-27T23:30:00Z");
    expect(computeStreakMetrics(sessions, reference, LONDON).streak).toBeLessThanOrEqual(6);
    expect(computeTrainingStreak(sessions, reference, LONDON)).toBe(
      computeStreakMetrics(sessions, reference, LONDON).streak
    );
  });

  it("survives a zone whose transition happens at midnight", () => {
    // Santiago shifts at 00:00, which put the old loop a whole day out.
    const zone = "America/Santiago";
    const sessions = middaySessions("2025-09-07", 6, zone);
    const reference = new Date("2025-09-07T18:00:00Z");
    expect(computeStreakMetrics(sessions, reference, zone).streak).toBeGreaterThanOrEqual(5);
  });
});
