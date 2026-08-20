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

  // An athlete whose longest run is 20 km was being shown a half-marathon PR
  // of their raw 20 km time (20 km is only 5.2% short of 21.0975 km, so it
  // cleared the old symmetric tolerance band). A distance never covered has
  // no record.
  it("gives no half-marathon record to an athlete who has never run one", () => {
    const records = computeRaceRecords([
      { distanceMeters: 20000, durationSeconds: 6060, startedAt: "2026-01-01" },
    ]);
    expect(records.find((r) => r.label === "Half Marathon")).toBeUndefined();
  });

  it("gives no record at any distance the athlete has only ever run short of", () => {
    const records = computeRaceRecords([
      { distanceMeters: 5000, durationSeconds: 1080, startedAt: "2026-01-01", sessionType: "race" },
      { distanceMeters: 10000, durationSeconds: 2280, startedAt: "2026-02-01", sessionType: "race" },
    ]);
    expect(records.map((r) => r.label)).toEqual(["5K", "10K"]);
  });

  it("never reports a time faster than one the athlete actually ran", () => {
    // Riegel would project this 10K onto a ~1:41 half; the ladder must not.
    const records = computeRaceRecords([
      { distanceMeters: 10000, durationSeconds: 2700, startedAt: "2026-01-01" },
    ]);
    for (const r of records) {
      expect(r.bestSeconds).toBe(2700);
      expect(r.distanceMeters).toBe(10000);
    }
  });

  it("still counts an effort that ran past the distance, at its full duration", () => {
    const records = computeRaceRecords([
      { distanceMeters: 22000, durationSeconds: 7200, startedAt: "2026-01-01" },
    ]);
    const half = records.find((r) => r.label === "Half Marathon");
    expect(half?.bestSeconds).toBe(7200);
  });

  it("prefers a genuinely faster over-distance effort to a shorter, quicker one", () => {
    const records = computeRaceRecords([
      { distanceMeters: 20000, durationSeconds: 3600, startedAt: "2026-01-01" },
      { distanceMeters: 21097, durationSeconds: 5400, startedAt: "2026-02-01" },
    ]);
    const half = records.find((r) => r.label === "Half Marathon");
    expect(half?.bestSeconds).toBe(5400);
    expect(half?.achievedAt).toBe("2026-02-01");
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
