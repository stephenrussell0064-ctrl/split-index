import { describe, expect, it } from "vitest";
import { livePredictionLadder } from "./cardio-activity";

/**
 * Live in-run score/time prediction ladder (user feedback: "based off the
 * current pace, heart rate you are able to extrapolate a score prediction
 * for set distances").
 */
describe("livePredictionLadder", () => {
  it("returns 5K/10K/Half/Marathon entries for running, monotonically slower/scoring lower as distance increases at a steady pace", () => {
    // 3km in 15min = 5:00/km pace, no HR data.
    const result = livePredictionLadder("run", 3000, 900, null, "male");
    expect(result).not.toBeNull();
    expect(result!.map((e) => e.label)).toEqual(["5K", "10K", "Half Marathon", "Marathon"]);
    // Riegel projects LONGER distances as taking relatively MORE time per km
    // (fatigue curve), so pace-equivalent score should decrease as distance grows.
    for (let i = 1; i < result!.length; i++) {
      expect(result![i].seconds).toBeGreaterThan(result![i - 1].seconds);
      expect(result![i].score).toBeLessThanOrEqual(result![i - 1].score);
    }
  });

  it("returns null for a sport with no defined live ladder (e.g. row)", () => {
    expect(livePredictionLadder("row", 2000, 480, null, "male")).toBeNull();
  });

  it("returns null with no distance/duration yet (start of a run)", () => {
    expect(livePredictionLadder("run", 0, 0, null, "male")).toBeNull();
  });

  it("a lower avgHR (easier effort at the same pace) never scores worse than a higher one", () => {
    const easier = livePredictionLadder("run", 3000, 900, 140, "male", { restingHR: 50, maxHR: 190 });
    const harder = livePredictionLadder("run", 3000, 900, 175, "male", { restingHR: 50, maxHR: 190 });
    expect(easier).not.toBeNull();
    expect(harder).not.toBeNull();
    expect(easier![0].score).toBeGreaterThanOrEqual(harder![0].score);
  });
});
