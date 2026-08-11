import { describe, expect, it } from "vitest";
import { daysUntilDate } from "./date";

describe("daysUntilDate", () => {
  const now = new Date("2026-08-11T15:42:00Z"); // arbitrary time-of-day, mid-afternoon UTC

  it("returns null for a missing or empty date", () => {
    expect(daysUntilDate(null, now)).toBeNull();
    expect(daysUntilDate(undefined, now)).toBeNull();
    expect(daysUntilDate("", now)).toBeNull();
  });

  it("returns null for an invalid date string rather than NaN", () => {
    expect(daysUntilDate("not-a-date", now)).toBeNull();
  });

  it("returns 0 for today, regardless of what time of day 'now' is", () => {
    expect(daysUntilDate("2026-08-11", now)).toBe(0);
    expect(daysUntilDate("2026-08-11", new Date("2026-08-11T00:00:01Z"))).toBe(0);
    expect(daysUntilDate("2026-08-11", new Date("2026-08-11T23:59:59Z"))).toBe(0);
  });

  it("returns 1 for tomorrow and -1 for yesterday", () => {
    expect(daysUntilDate("2026-08-12", now)).toBe(1);
    expect(daysUntilDate("2026-08-10", now)).toBe(-1);
  });

  it("counts a date weeks out correctly, including across a month boundary", () => {
    expect(daysUntilDate("2026-09-01", now)).toBe(21); // Aug 11 -> Sep 1
  });

  it("never drifts with the time-of-day 'now' is called at (UTC-normalized on both sides)", () => {
    const earlyInDay = daysUntilDate("2026-12-25", new Date("2026-08-11T00:00:01Z"));
    const lateInDay = daysUntilDate("2026-12-25", new Date("2026-08-11T23:59:59Z"));
    expect(earlyInDay).toBe(lateInDay);
  });
});
