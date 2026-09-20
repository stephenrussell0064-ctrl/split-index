import { describe, expect, it } from "vitest";
import { syntheticStreams } from "./fixtures";
import { computeSplits, METERS_PER_MILE, summarizePace } from "./splits";

describe("computeSplits", () => {
  it("cuts an even-paced run into equal kilometres", () => {
    const streams = syntheticStreams({ lengthMeters: 5000, pace: 300 });
    const splits = computeSplits(streams, 1000);

    expect(splits).toHaveLength(5);
    for (const s of splits) {
      expect(s.distanceMeters).toBe(1000);
      expect(s.elapsedSeconds).toBeCloseTo(300, 0);
      expect(s.paceSecondsPerKm).toBeCloseTo(300, 0);
      expect(s.isPartial).toBe(false);
    }
    expect(splits[4].cumulativeSeconds).toBeCloseTo(1500, 0);
  });

  it("reports a faster kilometre where the run was faster", () => {
    // 5:00/km except the third kilometre at 4:00/km.
    const streams = syntheticStreams({
      lengthMeters: 5000,
      pace: (m) => (m > 2000 && m <= 3000 ? 240 : 300),
    });
    const splits = computeSplits(streams, 1000);
    expect(splits[2].elapsedSeconds).toBeCloseTo(240, 0);
    expect(splits[1].elapsedSeconds).toBeCloseTo(300, 0);
    expect(splits[3].elapsedSeconds).toBeCloseTo(300, 0);
  });

  it("includes a final partial split and marks it", () => {
    const streams = syntheticStreams({ lengthMeters: 3400, pace: 300 });
    const splits = computeSplits(streams, 1000);
    expect(splits).toHaveLength(4);
    expect(splits[3].isPartial).toBe(true);
    expect(splits[3].distanceMeters).toBe(400);
    expect(splits[3].elapsedSeconds).toBeCloseTo(120, 0);
    // Pace is still per-km, not the raw time of a 400m stub.
    expect(splits[3].paceSecondsPerKm).toBeCloseTo(300, 0);
  });

  it("drops a final stub too short to be a split", () => {
    const streams = syntheticStreams({ lengthMeters: 3040, pace: 300 });
    expect(computeSplits(streams, 1000)).toHaveLength(3);
  });

  it("cuts per mile when asked", () => {
    const streams = syntheticStreams({ lengthMeters: 5000, pace: 300 });
    const splits = computeSplits(streams, METERS_PER_MILE);
    expect(splits).toHaveLength(4);
    expect(splits[0].elapsedSeconds).toBeCloseTo(300 * 1.609344, 0);
    expect(splits[3].isPartial).toBe(true);
  });

  it("carries per-split heart rate, cadence and climb", () => {
    const streams = syntheticStreams({
      lengthMeters: 2000,
      pace: 300,
      heartRate: (s) => (s < 300 ? 140 : 160),
      cadence: () => 176,
      // Flat first km, a 30m climb over the second.
      altitude: (m) => (m <= 1000 ? 50 : 50 + ((m - 1000) / 1000) * 30),
    });
    const [first, second] = computeSplits(streams, 1000);
    expect(first.avgHeartRate).toBeCloseTo(140, -1);
    expect(second.avgHeartRate).toBeCloseTo(160, -1);
    expect(first.avgCadence).toBe(176);
    expect(first.elevationGainMeters).toBeCloseTo(0, 0);
    expect(second.elevationGainMeters).toBeGreaterThan(25);
    expect(second.elevationGainMeters).toBeLessThan(35);
  });

  it("gives null sensor fields when the run carried no sensor data", () => {
    const [split] = computeSplits(syntheticStreams({ lengthMeters: 1000, pace: 300 }), 1000);
    expect(split.avgHeartRate).toBeNull();
    expect(split.avgCadence).toBeNull();
    expect(split.elevationGainMeters).toBeNull();
  });
});

describe("summarizePace", () => {
  it("recognises a negative split", () => {
    const streams = syntheticStreams({ lengthMeters: 6000, pace: (m) => (m <= 3000 ? 320 : 280) });
    const summary = summarizePace(streams, computeSplits(streams, 1000))!;
    expect(summary.shape).toBe("negative");
    expect(summary.firstHalfSeconds).toBeCloseTo(960, -1);
    expect(summary.secondHalfSeconds).toBeCloseTo(840, -1);
    expect(summary.halfDeltaSeconds).toBeLessThan(0);
    expect(summary.fastestSplitIndex).toBeGreaterThan(3);
    expect(summary.slowestSplitIndex).toBeLessThanOrEqual(3);
  });

  it("reads an even run as even with near-zero variability", () => {
    const streams = syntheticStreams({ lengthMeters: 4000, pace: 300 });
    const summary = summarizePace(streams, computeSplits(streams, 1000))!;
    expect(summary.shape).toBe("even");
    expect(summary.variabilityPercent).toBeLessThan(1);
  });

  it("has no fastest split with fewer than two complete splits", () => {
    const streams = syntheticStreams({ lengthMeters: 1500, pace: 300 });
    const summary = summarizePace(streams, computeSplits(streams, 1000))!;
    expect(summary.fastestSplitIndex).toBeNull();
    expect(summary.variabilityPercent).toBeNull();
  });
});
