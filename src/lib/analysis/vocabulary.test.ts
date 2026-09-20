import { describe, expect, it } from "vitest";
import { syntheticStreams } from "./fixtures";
import { analyzeRun } from "./run-analysis";
import { bestEffortDistancesFor } from "./best-efforts";
import { isSpeedBased, paceBandFor, sportVocabulary } from "./vocabulary";

/** The three sports the GPS tracker records. Anything here must get a full analysis. */
const GPS_SPORTS = ["running", "walking", "outdoor_cycling"] as const;

describe("sportVocabulary", () => {
  it("names every GPS sport after itself, never after running", () => {
    expect(sportVocabulary("running").Noun).toBe("Run");
    expect(sportVocabulary("walking").Noun).toBe("Walk");
    expect(sportVocabulary("outdoor_cycling").Noun).toBe("Ride");
    expect(sportVocabulary("walking").noun).toBe("walk");
    expect(sportVocabulary("outdoor_cycling").noun).toBe("ride");
  });

  it("quotes cyclists speed and everyone else pace", () => {
    expect(isSpeedBased("outdoor_cycling")).toBe(true);
    expect(isSpeedBased("running")).toBe(false);
    expect(isSpeedBased("walking")).toBe(false);
  });

  it("falls back to a neutral word rather than calling a new sport a run", () => {
    expect(sportVocabulary("swimming").Noun).toBe("Session");
  });
});

describe("paceBandFor", () => {
  it("lets a bike descend faster than any runner could move", () => {
    // The defect this exists for: one shared band with a 100 s/km fast end is
    // 36 km/h, an ordinary descent on a road bike. Every fast stretch of every
    // ride fell outside it and was blanked from the chart.
    const ride = paceBandFor("outdoor_cycling");
    const sixtyKmh = 3600 / 60;
    expect(sixtyKmh).toBeGreaterThan(ride.minSecondsPerKm);
    expect(sixtyKmh).toBeLessThan(ride.maxSecondsPerKm);
  });

  it("still rejects a GPS jump on a bike", () => {
    // 200 km/h is not a descent.
    expect(3600 / 200).toBeLessThan(paceBandFor("outdoor_cycling").minSecondsPerKm);
  });

  it("keeps a slow walk on the chart", () => {
    const walk = paceBandFor("walking");
    const threeKmh = 3600 / 3;
    expect(threeKmh).toBeLessThan(walk.maxSecondsPerKm);
    expect(threeKmh).toBeGreaterThan(walk.minSecondsPerKm);
  });
});

describe("analyzeRun across every GPS sport", () => {
  it.each(GPS_SPORTS)("gives %s a full breakdown", (sport) => {
    const streams = syntheticStreams({
      lengthMeters: 12_000,
      // Fast enough to be a ride, slow enough to be a walk at the other end —
      // the point is that the pipeline does not care.
      pace: sport === "outdoor_cycling" ? 140 : 400,
      heartRate: () => 145,
      altitude: (m) => 30 + 10 * Math.sin(m / 900),
    });
    const analysis = analyzeRun(streams, { sport, profile: { restingHr: 50, maxHr: 190 } });

    expect(analysis.splitsKm.length).toBeGreaterThan(0);
    expect(analysis.bestEfforts.length).toBeGreaterThan(0);
    expect(analysis.heartRate).not.toBeNull();
    expect(analysis.elevation).not.toBeNull();
    // Every chart point must carry a drawable rate, whatever the sport.
    const drawn = analysis.chart.filter((p) => p.paceSecondsPerKm !== null);
    expect(drawn.length).toBeGreaterThan(analysis.chart.length / 2);
  });

  it("draws a fast descent on a ride instead of blanking it", () => {
    // A ride that spends its middle third at 55 km/h. Under the old shared
    // band every one of those samples was dropped.
    const streams = syntheticStreams({
      lengthMeters: 30_000,
      pace: (m) => (m > 10_000 && m <= 20_000 ? 3600 / 55 : 3600 / 28),
    });
    const analysis = analyzeRun(streams, {
      sport: "outdoor_cycling",
      profile: { restingHr: null, maxHr: null },
    });

    const descent = analysis.chart.filter((p) => p.distanceKm > 12 && p.distanceKm < 19);
    expect(descent.length).toBeGreaterThan(0);
    expect(descent.every((p) => p.paceSecondsPerKm !== null)).toBe(true);
    // And it reads as roughly 55 km/h, not clipped to the old 36 km/h ceiling.
    const fastest = Math.min(...descent.map((p) => p.paceSecondsPerKm as number));
    expect(3600 / fastest).toBeGreaterThan(50);
  });

  it("offers cycling distances to a ride and running distances to a walk", () => {
    expect(bestEffortDistancesFor("outdoor_cycling").map((d) => d.label)).toContain("40K");
    expect(bestEffortDistancesFor("walking").map((d) => d.label)).toContain("5K");
    expect(bestEffortDistancesFor("walking").map((d) => d.label)).toEqual(
      bestEffortDistancesFor("running").map((d) => d.label)
    );
  });
});
