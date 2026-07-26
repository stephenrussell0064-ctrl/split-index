import { describe, expect, it } from "vitest";
import { riegelPredictions, sportRacePredictions, walkPacePredictions } from "./cardio-activity";

/** Race ladders for row/ski/swim/walk (user feedback: only running had one). */
describe("sportRacePredictions", () => {
  it("returns a prediction for each of row's ladder distances", () => {
    const result = sportRacePredictions("row", 2000, 420);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(["500", "1000", "2000", "5000", "10000"]);
  });

  it("returns a prediction for each of ski's ladder distances", () => {
    const result = sportRacePredictions("ski", 2000, 450);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(["500", "1000", "2000", "5000"]);
  });

  it("returns a prediction for each of swim's ladder distances", () => {
    const result = sportRacePredictions("swim", 400, 380);
    expect(result).not.toBeNull();
    expect(Object.keys(result!)).toEqual(["100", "200", "400", "800", "1500"]);
  });

  it("the session's own distance maps back to (approximately) its own time", () => {
    const result = sportRacePredictions("row", 2000, 420);
    expect(result!["2000"]).toBeCloseTo(420, 5);
  });

  it("longer distances predict a slower time, shorter a faster one (monotonic in distance)", () => {
    const result = sportRacePredictions("row", 2000, 420)!;
    expect(result["500"]).toBeLessThan(result["1000"]);
    expect(result["1000"]).toBeLessThan(result["2000"]);
    expect(result["2000"]).toBeLessThan(result["5000"]);
    expect(result["5000"]).toBeLessThan(result["10000"]);
  });

  it("returns null for invalid input", () => {
    expect(sportRacePredictions("row", 0, 420)).toBeNull();
    expect(sportRacePredictions("row", 2000, 0)).toBeNull();
  });
});

describe("walkPacePredictions", () => {
  it("scales linearly (no Riegel exponent) — double the distance is double the time", () => {
    const result = walkPacePredictions(1000, 600); // 10:00/km pace
    expect(result).not.toBeNull();
    expect(result!["1000"]).toBeCloseTo(600, 5);
    expect(result!["5000"]).toBeCloseTo(3000, 5);
    expect(result!["10000"]).toBeCloseTo(6000, 5);
    // Exactly double the distance (5000 -> 10000) is exactly double the time.
    expect(result!["10000"]).toBeCloseTo(result!["5000"] * 2, 5);
  });

  it("returns null for invalid input", () => {
    expect(walkPacePredictions(0, 600)).toBeNull();
    expect(walkPacePredictions(1000, 0)).toBeNull();
  });
});

describe("riegelPredictions (running, unchanged) sanity", () => {
  it("still covers the standard running ladder", () => {
    const result = riegelPredictions(5000, 1200);
    expect(result).not.toBeNull();
    // Object.keys reorders pure-integer-looking keys numerically first
    // (JS spec, not app behavior) — "21097.5" isn't integer-like, so it
    // sorts after the integer keys regardless of insertion order.
    expect(new Set(Object.keys(result!))).toEqual(new Set(["1500", "5000", "10000", "21097.5", "42195"]));
  });
});

/**
 * Personalized k threading (user feedback: 10k/half/marathon predictions off
 * a real 5k "seem slightly faster than i think i may be able to achieve" —
 * root cause was the ladder always using the flat "intermediate" experience
 * tier (k=1.06), silently ignoring this athlete's own personalized Riegel
 * exponent already computed and stored elsewhere in the app).
 */
describe("riegelPredictions / sportRacePredictions — personalized k override", () => {
  it("uses the personalized k instead of the experience-tier default when provided", () => {
    const flat = riegelPredictions(5000, 1105, "intermediate")!; // k=1.06 default
    const personalized = riegelPredictions(5000, 1105, "intermediate", 1.10)!;
    // A higher k penalizes longer distances more — same 5k input, slower long-distance output.
    expect(personalized["42195"]).toBeGreaterThan(flat["42195"]);
    expect(personalized["21097.5"]).toBeGreaterThan(flat["21097.5"]);
  });

  it("falls back to the experience-tier default when no personalized k is given", () => {
    const withNull = riegelPredictions(5000, 1105, "intermediate", null)!;
    const withUndefined = riegelPredictions(5000, 1105, "intermediate")!;
    expect(withNull["42195"]).toBeCloseTo(withUndefined["42195"], 5);
  });

  it("sportRacePredictions also honors a personalized k", () => {
    const flat = sportRacePredictions("row", 2000, 420, "intermediate")!;
    const personalized = sportRacePredictions("row", 2000, 420, "intermediate", 1.10)!;
    expect(personalized["10000"]).toBeGreaterThan(flat["10000"]);
  });
});
