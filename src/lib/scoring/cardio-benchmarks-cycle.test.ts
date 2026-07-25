import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Part F (scoring-calibration-rewrite): new draft cycle 20k anchor table —
 * low confidence, built from speed-band descriptions rather than a
 * percentile table. Draft only; needs review before fully trusting.
 */
describe("timeToScore — cycle (Part F draft anchors)", () => {
  it("matches the new draft male anchors", () => {
    expect(timeToScore("cycle", 1800, "male")).toBeCloseTo(925, 0); // 30:00, ~40km/h
    expect(timeToScore("cycle", 2040, "male")).toBeCloseTo(725, 0); // 34:00, ~35km/h
    expect(timeToScore("cycle", 2400, "male")).toBeCloseTo(475, 0); // 40:00, ~30km/h
    expect(timeToScore("cycle", 3000, "male")).toBeCloseTo(250, 0); // 50:00, ~24km/h
    expect(timeToScore("cycle", 3780, "male")).toBeCloseTo(125, 0); // 63:00, ~19km/h
  });

  it("still applies the female multiplier (1.219) on top", () => {
    const male = timeToScore("cycle", 2400, "male");
    const female = timeToScore("cycle", 2400, "female");
    expect(female).toBeGreaterThan(male);
  });
});
