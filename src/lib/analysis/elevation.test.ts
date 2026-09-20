import { describe, expect, it } from "vitest";
import { syntheticStreams } from "./fixtures";
import { analyzeElevation, smoothedAltitudeSeries } from "./elevation";

describe("analyzeElevation", () => {
  it("is null without an altitude channel", () => {
    expect(analyzeElevation(syntheticStreams({ lengthMeters: 1000, pace: 300 }))).toBeNull();
  });

  it("banks a clean hill as gain on the way up and loss on the way down", () => {
    // Flat, then a 40m climb over 1km, then back down over the next km, then flat.
    const streams = syntheticStreams({
      lengthMeters: 4000,
      pace: 300,
      altitude: (m) => {
        if (m <= 1000) return 100;
        if (m <= 2000) return 100 + ((m - 1000) / 1000) * 40;
        if (m <= 3000) return 140 - ((m - 2000) / 1000) * 40;
        return 100;
      },
    });
    const analysis = analyzeElevation(streams)!;
    expect(analysis.gainMeters).toBeGreaterThan(36);
    expect(analysis.gainMeters).toBeLessThan(42);
    expect(analysis.lossMeters).toBeGreaterThan(36);
    expect(analysis.lossMeters).toBeLessThan(42);
    expect(analysis.minAltitudeMeters).toBe(100);
    expect(analysis.maxAltitudeMeters).toBeGreaterThanOrEqual(138);
    // A 4% grade climbed for a kilometre.
    expect(analysis.steepestGradePercent).toBeGreaterThan(3);
    expect(analysis.steepestGradePercent).toBeLessThan(5);
  });

  it("reads a flat run as flat", () => {
    const analysis = analyzeElevation(syntheticStreams({ lengthMeters: 3000, pace: 300, altitude: () => 55 }))!;
    expect(analysis.gainMeters).toBe(0);
    expect(analysis.lossMeters).toBe(0);
    expect(analysis.steepestGradePercent).toBeNull();
  });

  it("interpolates across gaps in the altitude channel", () => {
    const streams = syntheticStreams({ lengthMeters: 1000, pace: 300, altitude: (m) => 10 + m / 100 });
    const withGap = { ...streams, altitude: streams.altitude!.map((v, i) => (i > 20 && i < 40 ? null : v)) };
    const series = smoothedAltitudeSeries(withGap)!;
    expect(series).toHaveLength(streams.time.length);
    expect(series[30]).toBeGreaterThan(series[20]);
    expect(series[30]).toBeLessThan(series[40]);
  });
});
