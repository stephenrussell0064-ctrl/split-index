import { describe, expect, it } from "vitest";
import { livePredictionLadder } from "./cardio-activity";

/**
 * Live in-run score/time prediction ladder (user feedback: "based off the
 * current pace, heart rate you are able to extrapolate a score prediction
 * for set distances").
 */
describe("livePredictionLadder", () => {
  it("returns 5K/10K/Half/Marathon entries for running, monotonically slower as distance increases at a steady pace", () => {
    // 3km in 15min = 5:00/km pace, no HR data.
    const result = livePredictionLadder("run", 3000, 900, null, "male");
    expect(result).not.toBeNull();
    expect(result!.map((e) => e.label)).toEqual(["5K", "10K", "Half Marathon", "Marathon"]);
    // Riegel projects LONGER distances as taking relatively MORE time per km
    // (fatigue curve).
    for (let i = 1; i < result!.length; i++) {
      expect(result![i].seconds).toBeGreaterThan(result![i - 1].seconds);
    }
  });

  it("scores every rung as the fitness its time represents — the same score, not a collapse toward zero on the long rungs (user report: a 4:02 marathon showed 0.1)", () => {
    // A run pacing for a 4:02 marathon: 10km in 57:20.
    const result = livePredictionLadder("run", 10000, 3440, null, "male");
    expect(result).not.toBeNull();
    const marathon = result!.find((e) => e.label === "Marathon")!;
    // A four-hour-plus marathon — the exact projection is the fitness
    // pipeline's business, the score under it is this test's.
    expect(marathon.seconds).toBeGreaterThan(4 * 3600);
    // Well inside the scored band, nowhere near zero.
    expect(marathon.score).toBeGreaterThan(100);
    // Every rung is the same fitness projected to a different distance, so
    // the score under each one is the same score.
    for (const entry of result!) {
      expect(entry.score).toBeCloseTo(result![0].score, 3);
    }
  });

  it("gives a rung the score that saving a run of exactly that time and distance would get", () => {
    const fromTenK = livePredictionLadder("run", 10000, 3440, null, "male")!;
    const marathon = fromTenK.find((e) => e.label === "Marathon")!;
    // A run OF the predicted marathon, scored the same way, lands on the same number.
    const fromMarathon = livePredictionLadder("run", 42195, marathon.seconds, null, "male")!;
    expect(fromMarathon[0].score).toBeCloseTo(marathon.score, 3);
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
