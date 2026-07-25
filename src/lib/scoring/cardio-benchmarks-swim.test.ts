import { describe, expect, it } from "vitest";
import { timeToScore } from "./cardio-benchmarks";

/**
 * Part E (scoring-calibration-rewrite): new draft swim 400m anchor table —
 * lowest confidence of any table in this brief, needs review against real
 * swimmers' times before fully trusting.
 */
describe("timeToScore — swim (Part E draft anchors)", () => {
  it("matches the new draft male anchors", () => {
    expect(timeToScore("swim", 240, "male")).toBeCloseTo(925, 0); // 4:00
    expect(timeToScore("swim", 285, "male")).toBeCloseTo(725, 0); // 4:45
    expect(timeToScore("swim", 315, "male")).toBeCloseTo(475, 0); // 5:15
    expect(timeToScore("swim", 420, "male")).toBeCloseTo(250, 0); // 7:00
    expect(timeToScore("swim", 540, "male")).toBeCloseTo(125, 0); // 9:00
  });

  it("still applies the female multiplier (1.073) on top", () => {
    const male = timeToScore("swim", 315, "male");
    const female = timeToScore("swim", 315, "female");
    expect(female).toBeGreaterThan(male);
  });
});
