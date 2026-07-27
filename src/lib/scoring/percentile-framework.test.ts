import { describe, expect, it } from "vitest";
import {
  PERCENTILE_TO_SCORE,
  scoreForPercentile,
  percentileForScore,
  nextStandardsTierTarget,
} from "./percentile-framework";

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

describe("percentileForScore — inverse of scoreForPercentile (Slice C standards-based comparison)", () => {
  it("round-trips every named anchor point exactly", () => {
    for (const [percentile, score] of Object.entries(PERCENTILE_TO_SCORE)) {
      expect(percentileForScore(score)).toBeCloseTo(Number(percentile), 5);
    }
  });

  it("round-trips a value in the tail (beyond the 99th percentile)", () => {
    const score = scoreForPercentile(99.5);
    expect(percentileForScore(score)).toBeCloseTo(99.5, 1);
  });

  it("round-trips a value below the 5th percentile", () => {
    const score = scoreForPercentile(0);
    expect(percentileForScore(score)).toBeCloseTo(0, 1);
  });

  it("clamps at the ceiling instead of returning Infinity/NaN", () => {
    expect(percentileForScore(999)).toBe(99.9);
    expect(Number.isFinite(percentileForScore(999))).toBe(true);
  });

  it("clamps at the floor for a score of 0", () => {
    expect(percentileForScore(0)).toBe(0);
  });

  it("is monotonically increasing with score", () => {
    const scores = [0, 50, 125, 250, 475, 725, 850, 925, 970, 999];
    const percentiles = scores.map(percentileForScore);
    for (let i = 1; i < percentiles.length; i++) {
      expect(percentiles[i]).toBeGreaterThanOrEqual(percentiles[i - 1]);
    }
  });
});

describe("nextStandardsTierTarget", () => {
  it("returns the next tier and points needed for a mid-tier score", () => {
    const target = nextStandardsTierTarget(500);
    expect(target).toEqual({ label: "Advanced", pointsToClose: 725 - 500 });
  });

  it("returns null once already in the top tier", () => {
    expect(nextStandardsTierTarget(950)).toBeNull();
  });

  it("returns the first tier above a very low score", () => {
    const target = nextStandardsTierTarget(10);
    expect(target?.label).toBe("Intermediate");
  });
});
