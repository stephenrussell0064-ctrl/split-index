import { describe, expect, it } from "vitest";
import {
  RIEGEL_K,
  RIEGEL_K_MIN,
  RIEGEL_K_MAX,
  impliedRiegelK,
  personalizedRiegelK,
} from "./cardio-predictions";

/**
 * Part H (scoring-calibration-rewrite): Riegel k personalization. k=1.06 is
 * confirmed as the correct literature-standard population average — not
 * changed here. This covers the new per-user personalization mechanism:
 * an athlete's own realized cross-distance performances nudge their
 * personal k within the literature-supported 1.03-1.10 band.
 */
describe("impliedRiegelK", () => {
  it("solves for k exactly given two real performances at RIEGEL_K itself", () => {
    // Construct a 5k/10k pair that's an exact Riegel projection at k=1.08,
    // then confirm impliedRiegelK recovers 1.08 from just the two times.
    const t5k = 1200; // 20:00
    const t10k = t5k * Math.pow(10000 / 5000, 1.08);
    expect(impliedRiegelK(5000, t5k, 10000, t10k)).toBeCloseTo(1.08, 5);
  });

  it("clamps to the literature-supported band for extreme/noisy pairs", () => {
    // A 10k barely slower than 2x the 5k time implies a very low k (speed bias).
    const kLow = impliedRiegelK(5000, 1200, 10000, 2200);
    expect(kLow).toBeGreaterThanOrEqual(RIEGEL_K_MIN);

    // A 10k much slower than 2x the 5k time implies a very high k (endurance bias).
    const kHigh = impliedRiegelK(5000, 1200, 10000, 3600);
    expect(kHigh).toBeLessThanOrEqual(RIEGEL_K_MAX);
  });

  it("returns null for invalid or same-distance input", () => {
    expect(impliedRiegelK(5000, 1200, 5000, 1200)).toBeNull();
    expect(impliedRiegelK(0, 1200, 10000, 2600)).toBeNull();
    expect(impliedRiegelK(5000, 0, 10000, 2600)).toBeNull();
  });
});

describe("personalizedRiegelK", () => {
  it("starts from the population default (RIEGEL_K) when no personal k is stored yet", () => {
    const result = personalizedRiegelK(null, 1.10);
    expect(result).toBeGreaterThan(RIEGEL_K);
    expect(result).toBeLessThan(1.10);
  });

  it("converges toward the implied k gradually, not snapping to it", () => {
    const afterOne = personalizedRiegelK(RIEGEL_K, 1.10);
    const afterTwo = personalizedRiegelK(afterOne, 1.10);
    expect(afterOne).toBeGreaterThan(RIEGEL_K);
    expect(afterOne).toBeLessThan(1.10);
    expect(afterTwo).toBeGreaterThan(afterOne); // still converging
    expect(afterTwo).toBeLessThan(1.10); // still hasn't snapped
  });

  it("stays within the literature-supported band regardless of input", () => {
    expect(personalizedRiegelK(RIEGEL_K_MAX, RIEGEL_K_MAX)).toBeLessThanOrEqual(RIEGEL_K_MAX);
    expect(personalizedRiegelK(RIEGEL_K_MIN, RIEGEL_K_MIN)).toBeGreaterThanOrEqual(RIEGEL_K_MIN);
  });
});
