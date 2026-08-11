import { describe, expect, it } from "vitest";
import { startOfWeek, computeWeekProgress, computeProgressTrend, type LoggedSessionMatch, type ProgressSnapshot } from "./training-progress";

describe("startOfWeek", () => {
  it("returns the same Monday for every day in that week", () => {
    // Wednesday 2026-08-12 -> Monday 2026-08-10.
    const monday = startOfWeek(new Date("2026-08-12T15:00:00Z"));
    expect(monday.toISOString().slice(0, 10)).toBe("2026-08-10");
  });

  it("rolls a Sunday back to the Monday that started its own week, not the next one", () => {
    const monday = startOfWeek(new Date("2026-08-16T09:00:00Z")); // Sunday
    expect(monday.toISOString().slice(0, 10)).toBe("2026-08-10");
  });

  it("returns itself for a Monday", () => {
    const monday = startOfWeek(new Date("2026-08-10T00:00:00Z"));
    expect(monday.toISOString().slice(0, 10)).toBe("2026-08-10");
  });
});

describe("computeWeekProgress", () => {
  it("counts logged gym sessions matching the goal's exercise name, case-insensitively", () => {
    const logged: LoggedSessionMatch[] = [
      { goalType: "gym", key: "bench press", loggedAt: "2026-08-10T10:00:00Z" },
      { goalType: "gym", key: "Bench Press", loggedAt: "2026-08-12T10:00:00Z" },
      { goalType: "gym", key: "Squat", loggedAt: "2026-08-11T10:00:00Z" }, // different exercise
    ];
    const progress = computeWeekProgress({ goalType: "gym", targetKey: "Bench Press", weeklySessions: 3 }, logged);
    expect(progress.sessionsLogged).toBe(2);
    expect(progress.sessionsTarget).toBe(3);
    expect(progress.percentComplete).toBe(67);
  });

  it("counts logged cardio sessions matching the goal's sport rather than its (possibly encoded) targetKey", () => {
    const logged: LoggedSessionMatch[] = [
      { goalType: "cardio", key: "run", loggedAt: "2026-08-10T10:00:00Z" },
      { goalType: "cardio", key: "run", loggedAt: "2026-08-11T10:00:00Z" },
    ];
    // targetKey is the encoded custom-distance key, sport is the plain sport.
    const progress = computeWeekProgress({ goalType: "cardio", targetKey: "run_10000", sport: "run", weeklySessions: 2 }, logged);
    expect(progress.sessionsLogged).toBe(2);
    expect(progress.percentComplete).toBe(100);
  });

  it("caps percentComplete at 100 even when the athlete has logged more sessions than planned", () => {
    const logged: LoggedSessionMatch[] = [
      { goalType: "gym", key: "Squat", loggedAt: "d1" },
      { goalType: "gym", key: "Squat", loggedAt: "d2" },
      { goalType: "gym", key: "Squat", loggedAt: "d3" },
    ];
    const progress = computeWeekProgress({ goalType: "gym", targetKey: "Squat", weeklySessions: 2 }, logged);
    expect(progress.sessionsLogged).toBe(3);
    expect(progress.percentComplete).toBe(100);
  });

  it("returns 0% for a goal with no weekly sessions allocated, without dividing by zero", () => {
    const progress = computeWeekProgress({ goalType: "gym", targetKey: "Squat", weeklySessions: 0 }, []);
    expect(progress.percentComplete).toBe(0);
    expect(progress.sessionsLogged).toBe(0);
  });

  it("never counts a different goal's sessions toward this one", () => {
    const logged: LoggedSessionMatch[] = [{ goalType: "cardio", key: "cycle", loggedAt: "d1" }];
    const progress = computeWeekProgress({ goalType: "gym", targetKey: "Squat", weeklySessions: 2 }, logged);
    expect(progress.sessionsLogged).toBe(0);
  });
});

describe("computeProgressTrend", () => {
  it("returns null once the goal is already met — nothing left to project", () => {
    expect(computeProgressTrend([{ date: "2026-07-01", gapFraction: 0.2 }, { date: "2026-08-01", gapFraction: 0 }], 0)).toBeNull();
  });

  it("returns null with fewer than two snapshots", () => {
    expect(computeProgressTrend([{ date: "2026-08-01", gapFraction: 0.2 }], 0.2)).toBeNull();
    expect(computeProgressTrend([], 0.2)).toBeNull();
  });

  it("returns null when the available history spans too few days to trust a rate", () => {
    const snapshots: ProgressSnapshot[] = [
      { date: "2026-08-10", gapFraction: 0.3 },
      { date: "2026-08-12", gapFraction: 0.28 }, // only 2 days of history
    ];
    expect(computeProgressTrend(snapshots, 0.28)).toBeNull();
  });

  it("projects a genuine future date when the gap has been closing at a steady rate", () => {
    const snapshots: ProgressSnapshot[] = [
      { date: "2026-07-01", gapFraction: 0.3 },
      { date: "2026-08-01", gapFraction: 0.15 }, // closed 0.15 over 31 days
    ];
    const trend = computeProgressTrend(snapshots, 0.15, new Date("2026-08-01T00:00:00Z"));
    expect(trend).not.toBeNull();
    expect(trend!.onTrack).toBe(true);
    expect(trend!.projectedDate).not.toBeNull();
    // At ~0.15/31 per day, closing the remaining 0.15 gap takes ~31 more days -> early September.
    expect(trend!.projectedDate!.slice(0, 7)).toBe("2026-09");
  });

  it("flags not-on-track with no projected date when the gap hasn't closed (flat or regressing)", () => {
    const snapshots: ProgressSnapshot[] = [
      { date: "2026-07-01", gapFraction: 0.2 },
      { date: "2026-08-01", gapFraction: 0.25 }, // got worse, not better
    ];
    const trend = computeProgressTrend(snapshots, 0.25);
    expect(trend).not.toBeNull();
    expect(trend!.onTrack).toBe(false);
    expect(trend!.projectedDate).toBeNull();
  });

  it("uses only the oldest and newest snapshot, ignoring noise in between", () => {
    const snapshots: ProgressSnapshot[] = [
      { date: "2026-07-01", gapFraction: 0.3 },
      { date: "2026-07-15", gapFraction: 0.5 }, // a noisy mid-window blip
      { date: "2026-08-01", gapFraction: 0.15 },
    ];
    const trend = computeProgressTrend(snapshots, 0.15, new Date("2026-08-01T00:00:00Z"));
    expect(trend!.onTrack).toBe(true); // net oldest->newest still improved despite the blip
  });
});
