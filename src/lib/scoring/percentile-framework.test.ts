import { describe, expect, it } from "vitest";
import { PERCENTILE_TO_SCORE, scoreForPercentile } from "./percentile-framework";

describe("scoreForPercentile", () => {
  it("matches the defined anchor points exactly", () => {
    for (const [percentile, score] of Object.entries(PERCENTILE_TO_SCORE)) {
      expect(scoreForPercentile(Number(percentile))).toBeCloseTo(score, 5);
    }
  });

  it("interpolates between anchor points", () => {
    // Halfway between 50th (475) and 80th (725) percentiles.
    expect(scoreForPercentile(65)).toBeCloseTo(600, 5);
  });

  it("is monotonically increasing with percentile", () => {
    let prev = -Infinity;
    for (let p = 0; p <= 100; p += 1) {
      const score = scoreForPercentile(p);
      expect(score).toBeGreaterThanOrEqual(prev);
      prev = score;
    }
  });

  it("asymptotically approaches but never reaches 999 beyond the 99th percentile", () => {
    expect(scoreForPercentile(99.9)).toBeGreaterThan(925);
    expect(scoreForPercentile(99.9)).toBeLessThan(999);
    expect(scoreForPercentile(99.99)).toBeLessThan(999);
    expect(scoreForPercentile(100)).toBeLessThan(999);
  });

  it("extrapolates gently below the 5th percentile rather than clamping flat", () => {
    expect(scoreForPercentile(0)).toBeLessThan(125);
    expect(scoreForPercentile(0)).toBeGreaterThanOrEqual(0);
  });
});
