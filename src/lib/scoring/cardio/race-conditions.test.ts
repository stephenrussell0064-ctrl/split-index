import { describe, expect, it } from "vitest";
import { applyRaceConditionAdjustments } from "./race-conditions";

describe("applyRaceConditionAdjustments", () => {
  it("returns the base time unchanged with no notes when no conditions are provided", () => {
    const result = applyRaceConditionAdjustments({ distanceMeters: 10000, baseSeconds: 2340 });
    expect(result.adjustedSeconds).toBe(2340);
    expect(result.notes).toEqual([]);
  });

  it("adds a real penalty for elevation gain, proportional to the climb", () => {
    const result = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      elevationGainMeters: 213, // the user's own real Dorney-adjacent example
    });
    expect(result.elevationPenaltySeconds).toBeGreaterThan(0);
    expect(result.adjustedSeconds).toBeGreaterThan(2340);
    expect(result.notes.some((n) => n.includes("climbing"))).toBe(true);
  });

  it("ignores temperature at or below the ideal racing temperature", () => {
    const atIdeal = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      forecastTempCelsius: 12,
    });
    const belowIdeal = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      forecastTempCelsius: 5,
    });
    expect(atIdeal.temperaturePenaltySeconds).toBe(0);
    expect(belowIdeal.temperaturePenaltySeconds).toBe(0);
  });

  it("penalizes heat above the ideal temperature, worse for longer races than shorter ones", () => {
    const tenK = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340, // 39:00
      forecastTempCelsius: 27,
    });
    const marathon = applyRaceConditionAdjustments({
      distanceMeters: 42195,
      baseSeconds: 12600, // 3h30
      forecastTempCelsius: 27,
    });
    expect(tenK.temperaturePenaltySeconds).toBeGreaterThan(0);
    // Marathon penalty as a FRACTION of base time should be larger — longer
    // sustained heat exposure costs proportionally more.
    const tenKFraction = tenK.temperaturePenaltySeconds / 2340;
    const marathonFraction = marathon.temperaturePenaltySeconds / 12600;
    expect(marathonFraction).toBeGreaterThan(tenKFraction);
  });

  it("penalizes wind roughly quadratically — doubling the wind speed more than doubles the penalty", () => {
    const light = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      forecastWindKph: 10,
    });
    const strong = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      forecastWindKph: 20,
    });
    expect(strong.windPenaltySeconds).toBeGreaterThan(light.windPenaltySeconds * 2);
  });

  it("caps the wind penalty rather than letting it grow unbounded at extreme speeds", () => {
    const veryWindy = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      forecastWindKph: 100,
    });
    const referenceWindy = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      forecastWindKph: 30,
    });
    expect(veryWindy.windPenaltySeconds).toBe(referenceWindy.windPenaltySeconds);
  });

  it("stacks elevation, temperature, and wind penalties together", () => {
    const combined = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 2340,
      elevationGainMeters: 50,
      forecastTempCelsius: 22,
      forecastWindKph: 15,
    });
    expect(combined.adjustedSeconds).toBe(
      2340 +
        combined.elevationPenaltySeconds +
        combined.temperaturePenaltySeconds +
        combined.windPenaltySeconds
    );
    expect(combined.notes.length).toBe(3);
  });

  it("real-account regression: a flat 10K on a hot, windy day predicts meaningfully slower than the flat 39:00 baseline (user-reported: predicted 39:00, actually ran 40:33)", () => {
    const result = applyRaceConditionAdjustments({
      distanceMeters: 10000,
      baseSeconds: 39 * 60, // the flat, condition-blind prediction that was ~4% too fast
      elevationGainMeters: 0, // "the venue being flat"
      forecastTempCelsius: 25,
      forecastWindKph: 20,
    });
    expect(result.elevationPenaltySeconds).toBe(0); // flat course — no elevation penalty
    expect(result.adjustedSeconds).toBeGreaterThan(39 * 60);
    // Not claiming to exactly reproduce 40:33 (impossible without knowing
    // the actual conditions logged that day) — just meaningfully closer
    // than the flat prediction, which is the honest bar this clears.
    expect(result.adjustedSeconds).toBeLessThan(41 * 60);
  });
});
