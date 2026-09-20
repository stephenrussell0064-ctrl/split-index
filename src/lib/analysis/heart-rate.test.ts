import { describe, expect, it } from "vitest";
import { syntheticStreams } from "./fixtures";
import { analyzeHeartRate } from "./heart-rate";

describe("analyzeHeartRate", () => {
  it("is null with no heart-rate channel", () => {
    expect(analyzeHeartRate(syntheticStreams({ lengthMeters: 1000, pace: 300 }), { restingHr: 50, maxHr: 190 })).toBeNull();
  });

  it("uses heart-rate reserve zones when resting and max HR are both known", () => {
    const streams = syntheticStreams({ lengthMeters: 3000, pace: 300, heartRate: () => 150 });
    const analysis = analyzeHeartRate(streams, { restingHr: 50, maxHr: 190 })!;
    expect(analysis.zoneModel).toBe("reserve");
    expect(analysis.avgBpm).toBe(150);
    expect(analysis.maxBpm).toBe(150);
    // Reserve of 140: zone 3 starts at 50 + 0.7 × 140 = 148, zone 4 at 162.
    const zone3 = analysis.zones!.find((z) => z.zone === 3)!;
    expect(zone3.minBpm).toBe(148);
    expect(zone3.maxBpm).toBe(161);
    expect(zone3.fraction).toBeCloseTo(1, 2);
    expect(analysis.zones!.reduce((sum, z) => sum + z.fraction, 0)).toBeCloseTo(1, 2);
  });

  it("falls back to percent-of-max zones with only a max HR", () => {
    const streams = syntheticStreams({ lengthMeters: 3000, pace: 300, heartRate: () => 150 });
    const analysis = analyzeHeartRate(streams, { restingHr: null, maxHr: 200 })!;
    expect(analysis.zoneModel).toBe("percent_max");
    // 150 is 75% of 200: zone 3 (70-80%).
    expect(analysis.zones!.find((z) => z.zone === 3)!.fraction).toBeCloseTo(1, 2);
  });

  it("has no zones at all without a max HR, but still reports the numbers", () => {
    const streams = syntheticStreams({ lengthMeters: 3000, pace: 300, heartRate: () => 150 });
    const analysis = analyzeHeartRate(streams, { restingHr: null, maxHr: null })!;
    expect(analysis.zones).toBeNull();
    expect(analysis.zoneModel).toBeNull();
    expect(analysis.avgBpm).toBe(150);
  });

  it("splits zone time in proportion to the time spent there", () => {
    // Half the run at 150, half at 170 — zone 3 (148-161) and zone 4 (162-175) on a 50/190 reserve.
    const streams = syntheticStreams({ lengthMeters: 6000, pace: 300, heartRate: (s) => (s < 900 ? 150 : 170) });
    const analysis = analyzeHeartRate(streams, { restingHr: 50, maxHr: 190 })!;
    expect(analysis.zones!.find((z) => z.zone === 3)!.fraction).toBeCloseTo(0.5, 1);
    expect(analysis.zones!.find((z) => z.zone === 4)!.fraction).toBeCloseTo(0.5, 1);
  });

  it("measures upward drift when the heart rate rises at a constant pace", () => {
    // 40 minutes at 5:00/km, HR 140 for the first half and 154 for the second: 10% decoupling.
    const streams = syntheticStreams({ lengthMeters: 8000, pace: 300, heartRate: (s) => (s < 1200 ? 140 : 154) });
    const analysis = analyzeHeartRate(streams, { restingHr: 50, maxHr: 190 })!;
    expect(analysis.driftPercent).toBeGreaterThan(8);
    expect(analysis.driftPercent).toBeLessThan(11);
  });

  it("does not compute drift for a short run", () => {
    const streams = syntheticStreams({ lengthMeters: 2000, pace: 300, heartRate: () => 150 });
    expect(analyzeHeartRate(streams, { restingHr: 50, maxHr: 190 })!.driftPercent).toBeNull();
  });
});
