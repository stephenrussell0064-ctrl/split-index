import { describe, expect, it } from "vitest";
import { computeRaceRecords } from "./race-records";

describe("computeRaceRecords", () => {
  it("picks the fastest logged effort within tolerance of each standard distance", () => {
    const records = computeRaceRecords([
      { distanceMeters: 5000, durationSeconds: 1110, startedAt: "2026-01-01", sessionType: "race" },
      { distanceMeters: 5100, durationSeconds: 1080, startedAt: "2026-03-01", sessionType: "training" },
      { distanceMeters: 10000, durationSeconds: 2400, startedAt: "2026-02-01", sessionType: "race" },
    ]);

    const fiveK = records.find((r) => r.label === "5K");
    expect(fiveK?.bestSeconds).toBe(1080);
    expect(fiveK?.isRace).toBe(false);

    const tenK = records.find((r) => r.label === "10K");
    expect(tenK?.bestSeconds).toBe(2400);
    expect(tenK?.isRace).toBe(true);
  });

  it("excludes activities whose distance drifts more than 10% from a standard distance", () => {
    const records = computeRaceRecords([
      { distanceMeters: 6500, durationSeconds: 1500, startedAt: "2026-01-01" },
    ]);
    expect(records).toHaveLength(0);
  });

  it("ignores rows missing distance or duration", () => {
    const records = computeRaceRecords([
      { distanceMeters: null, durationSeconds: 1200, startedAt: "2026-01-01" },
      { distanceMeters: 5000, durationSeconds: null, startedAt: "2026-01-01" },
      { distanceMeters: 5000, durationSeconds: 0, startedAt: "2026-01-01" },
    ]);
    expect(records).toHaveLength(0);
  });

  it("returns records sorted by standard distance ascending", () => {
    const records = computeRaceRecords([
      { distanceMeters: 42195, durationSeconds: 14400, startedAt: "2026-01-01" },
      { distanceMeters: 5000, durationSeconds: 1100, startedAt: "2026-01-01" },
      { distanceMeters: 21097, durationSeconds: 6600, startedAt: "2026-01-01" },
    ]);
    expect(records.map((r) => r.label)).toEqual(["5K", "Half Marathon", "Marathon"]);
  });
});
