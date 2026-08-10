import { describe, expect, it } from "vitest";
import {
  projectToDistance,
  parseCardioTargetKey,
  buildCardioTargetKey,
  DISTANCE_LADDER,
} from "./cardio-custom-distance";
import { riegelEquivalentSeconds, RIEGEL_K } from "./cardio-predictions";

const BENCHMARK_SPORTS = ["run", "walk", "row", "swim", "cycle", "ski"] as const;

describe("projectToDistance", () => {
  it("Riegel-projects a running time to a longer distance, matching the shared Riegel helper exactly", () => {
    const fiveKSeconds = 25 * 60; // 25:00 5K
    const projected = projectToDistance("run", fiveKSeconds, 5000, 10000);
    expect(projected).toBeCloseTo(riegelEquivalentSeconds(fiveKSeconds, 5000, 10000, RIEGEL_K), 5);
    // A 10K necessarily takes longer than 2x the 5K time (fatigue curve), not exactly 2x.
    expect(projected).toBeGreaterThan(fiveKSeconds * 2);
  });

  it("uses a personalized k when given, differing from the default", () => {
    const fiveKSeconds = 25 * 60;
    const defaultProjection = projectToDistance("run", fiveKSeconds, 5000, 10000, null);
    const personalizedProjection = projectToDistance("run", fiveKSeconds, 5000, 10000, 1.1);
    expect(personalizedProjection).not.toBeCloseTo(defaultProjection, 1);
  });

  it("scales walking linearly (no fatigue curve) rather than with the Riegel exponent", () => {
    const oneKSeconds = 10 * 60; // 10:00/km pace
    const projected = projectToDistance("walk", oneKSeconds, 1000, 5000);
    expect(projected).toBeCloseTo(oneKSeconds * 5, 5); // exactly 5x for 5x the distance
  });

  it("returns the canonical time unchanged when the target distance equals the canonical one", () => {
    const seconds = 480;
    expect(projectToDistance("row", seconds, 2000, 2000)).toBeCloseTo(seconds, 5);
  });

  it("is defensive against non-positive inputs", () => {
    expect(projectToDistance("run", 0, 5000, 10000)).toBe(0);
    expect(projectToDistance("run", 300, 0, 10000)).toBe(300);
  });
});

describe("buildCardioTargetKey / parseCardioTargetKey round-trip", () => {
  it("uses the plain sport string at the canonical distance (backward compatible with existing rows)", () => {
    expect(buildCardioTargetKey("run", 5000, 5000)).toBe("run");
    const parsed = parseCardioTargetKey("run", BENCHMARK_SPORTS);
    expect(parsed).toEqual({ sport: "run", customMeters: null });
  });

  it("encodes a custom distance distinctly from the canonical key", () => {
    const key = buildCardioTargetKey("run", 10000, 5000);
    expect(key).toBe("run_10000");
    expect(key).not.toBe(buildCardioTargetKey("run", 5000, 5000));
    const parsed = parseCardioTargetKey(key, BENCHMARK_SPORTS);
    expect(parsed).toEqual({ sport: "run", customMeters: 10000 });
  });

  it("round-trips every distance in the curated ladder for every sport that has one", () => {
    for (const [sport, options] of Object.entries(DISTANCE_LADDER)) {
      for (const option of options!) {
        const canonical = options![0].meters; // arbitrary canonical stand-in for this test
        const key = buildCardioTargetKey(sport as "run", option.meters, canonical);
        const parsed = parseCardioTargetKey(key, BENCHMARK_SPORTS);
        expect(parsed?.sport).toBe(sport);
      }
    }
  });

  it("returns null for a key that isn't a recognized sport or sport_meters shape", () => {
    expect(parseCardioTargetKey("not-a-sport", BENCHMARK_SPORTS)).toBeNull();
    expect(parseCardioTargetKey("run_notanumber", BENCHMARK_SPORTS)).toBeNull();
  });
});
