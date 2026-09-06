import { describe, expect, it } from "vitest";
import { topPercent } from "./rank";
import { percentileForScore } from "@/lib/scoring/percentile-framework";

/**
 * The rank's render layer.
 *
 * `getGlobalRankPercentile` returns "% of the reference population you
 * outperform", already rounded to a whole number. Every surface that shows a
 * rank shows the athlete the complement, and both ends of that subtraction
 * used to produce sentences that were not true.
 */
describe("topPercent — what a rank actually says", () => {
  it("never says 'Top 0%' — nobody is in the top nothing", () => {
    // percentileForScore caps at 99.9, which rounds to 100 for every score
    // from ~950 up. Raw, that rendered "Top 0%".
    expect(Math.round(percentileForScore(950))).toBe(100);
    expect(topPercent(100)).toBe(1);
    expect(topPercent(999)).toBe(1);
  });

  it("never says 'Top 100%' — that is not a rank", () => {
    // Any score at or below the 5th-percentile anchor lands on percentile 0.
    expect(Math.round(percentileForScore(50))).toBe(0);
    expect(topPercent(0)).toBe(99);
    expect(topPercent(-5)).toBe(99);
  });

  it("passes real percentiles through untouched", () => {
    expect(topPercent(50)).toBe(50); // the Intermediate/Semi-Pro boundary
    expect(topPercent(80)).toBe(20); // Semi-Pro/Advanced
    expect(topPercent(95)).toBe(5); // Advanced/Elite
    expect(topPercent(99)).toBe(1); // Elite/World Class
  });

  it("stays monotone — a better score is never shown a worse rank", () => {
    const scores = [0, 125, 250, 475, 725, 850, 925, 999];
    const shown = scores.map((s) => topPercent(Math.round(percentileForScore(s))));
    for (let i = 1; i < shown.length; i++) {
      expect(shown[i]!).toBeLessThanOrEqual(shown[i - 1]!);
    }
  });
});
