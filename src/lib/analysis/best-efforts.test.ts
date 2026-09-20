import { describe, expect, it } from "vitest";
import { syntheticStreams } from "./fixtures";
import { bestEffortDistancesFor, bestEffortLabel, computeBestEfforts } from "./best-efforts";

const RUN = bestEffortDistancesFor("running");

describe("computeBestEfforts", () => {
  it("finds every standard distance the run is long enough for, and no longer", () => {
    const streams = syntheticStreams({ lengthMeters: 5000, pace: 300 });
    const efforts = computeBestEfforts(streams, RUN);
    expect(efforts.map((e) => e.label)).toEqual(["400m", "800m", "1K", "1 mile", "3K", "5K"]);
  });

  it("reads an even-paced run's efforts straight off the pace", () => {
    const streams = syntheticStreams({ lengthMeters: 10_000, pace: 300 });
    const byLabel = Object.fromEntries(computeBestEfforts(streams, RUN).map((e) => [e.label, e]));
    expect(byLabel["1K"].elapsedSeconds).toBeCloseTo(300, 0);
    expect(byLabel["5K"].elapsedSeconds).toBeCloseTo(1500, 0);
    expect(byLabel["10K"].elapsedSeconds).toBeCloseTo(3000, 0);
    expect(byLabel["1 mile"].elapsedSeconds).toBeCloseTo(482.8, 0);
    expect(byLabel["1K"].paceSecondsPerKm).toBeCloseTo(300, 0);
  });

  it("finds the fast stretch in the middle of a run, not the first kilometre", () => {
    // Easy 5:30/km with a 4:00/km kilometre from 3.2km to 4.2km.
    const streams = syntheticStreams({
      lengthMeters: 8000,
      pace: (m) => (m > 3200 && m <= 4200 ? 240 : 330),
    });
    const oneK = computeBestEfforts(streams, RUN).find((e) => e.label === "1K")!;
    expect(oneK.elapsedSeconds).toBeCloseTo(240, 0);
    expect(oneK.startMeters).toBeGreaterThanOrEqual(3190);
    expect(oneK.startMeters).toBeLessThanOrEqual(3210);
  });

  it("never credits a distance the run did not fully cover", () => {
    const streams = syntheticStreams({ lengthMeters: 4980, pace: 300 });
    expect(computeBestEfforts(streams, RUN).some((e) => e.label === "5K")).toBe(false);
  });

  it("uses cycling distances for a ride", () => {
    expect(bestEffortDistancesFor("outdoor_cycling").map((d) => d.label)).toContain("40K");
    expect(bestEffortDistancesFor("outdoor_cycling").map((d) => d.label)).not.toContain("1 mile");
  });

  it("carries the heart rate of the effort window", () => {
    const streams = syntheticStreams({
      lengthMeters: 3000,
      pace: 300,
      heartRate: (s) => (s >= 600 ? 170 : 140),
    });
    const efforts = computeBestEfforts(streams, RUN);
    expect(efforts.find((e) => e.label === "3K")!.avgHeartRate).toBeGreaterThan(140);
    expect(efforts.find((e) => e.label === "3K")!.avgHeartRate).toBeLessThan(170);
  });
});

describe("bestEffortLabel", () => {
  it("names the stored whole-metre keys the way the list does", () => {
    expect(bestEffortLabel("running", 1609)).toBe("1 mile");
    expect(bestEffortLabel("running", 21098)).toBe("Half marathon");
    expect(bestEffortLabel("running", 42195)).toBe("Marathon");
    expect(bestEffortLabel("running", 7500)).toBe("7.5K");
  });
});
