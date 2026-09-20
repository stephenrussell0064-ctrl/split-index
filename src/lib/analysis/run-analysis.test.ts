import { describe, expect, it } from "vitest";
import { syntheticStreams } from "./fixtures";
import { analyzeRun, CHART_CONFIG } from "./run-analysis";

describe("analyzeRun", () => {
  const streams = syntheticStreams({
    lengthMeters: 10_000,
    pace: (m) => (m <= 5000 ? 310 : 290),
    heartRate: (s) => 135 + s / 60,
    altitude: (m) => 40 + 15 * Math.sin(m / 800),
    cadence: () => 174,
  });
  const analysis = analyzeRun(streams, { sport: "running", profile: { restingHr: 52, maxHr: 188 } });

  it("assembles every section from one stream", () => {
    expect(analysis.totalDistanceMeters).toBeCloseTo(10_000, -1);
    expect(analysis.splitsKm).toHaveLength(10);
    expect(analysis.splitsMile).toHaveLength(7);
    expect(analysis.pace?.shape).toBe("negative");
    expect(analysis.bestEfforts.map((e) => e.label)).toContain("10K");
    expect(analysis.heartRate?.zoneModel).toBe("reserve");
    expect(analysis.elevation).not.toBeNull();
  });

  it("hands the charts a bounded number of points with a rolling pace", () => {
    expect(analysis.chart.length).toBeLessThanOrEqual(CHART_CONFIG.MAX_POINTS);
    expect(analysis.chart[0].distanceKm).toBe(0);
    expect(analysis.chart[analysis.chart.length - 1].distanceKm).toBeCloseTo(10, 1);
    const paces = analysis.chart.map((p) => p.paceSecondsPerKm).filter((p): p is number => p !== null);
    expect(paces.length).toBeGreaterThan(analysis.chart.length / 2);
    // The second half was run at 4:50, the first at 5:10; the chart shows it.
    const late = analysis.chart.filter((p) => p.distanceKm > 6).map((p) => p.paceSecondsPerKm as number);
    const early = analysis.chart.filter((p) => p.distanceKm > 1 && p.distanceKm < 4).map((p) => p.paceSecondsPerKm as number);
    expect(Math.max(...late)).toBeLessThan(Math.min(...early));
    expect(analysis.chart.every((p) => p.heartRate !== null)).toBe(true);
    expect(analysis.chart.every((p) => p.altitude !== null)).toBe(true);
  });

  it("survives a bare stream with no sensors", () => {
    const bare = analyzeRun(syntheticStreams({ lengthMeters: 800, pace: 300 }), {
      sport: "walking",
      profile: { restingHr: null, maxHr: null },
    });
    expect(bare.heartRate).toBeNull();
    expect(bare.elevation).toBeNull();
    expect(bare.splitsKm).toHaveLength(1);
    expect(bare.bestEfforts.map((e) => e.label)).toEqual(["400m", "800m"]);
    expect(bare.chart.every((p) => p.heartRate === null && p.altitude === null)).toBe(true);
  });
});
