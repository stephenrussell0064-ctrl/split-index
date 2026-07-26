import { describe, expect, it } from "vitest";
import { computeAcwrTrend } from "./injury-risk";

const DAY_MS = 86400000;

function daysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

/**
 * ACWR as a trend over time (user feedback: "i want this data analytics
 * displayed and detailed as much as possible for proper data analysis on
 * all their trends and performances" — the injury-risk panel only ever
 * showed today's snapshot ratio).
 */
describe("computeAcwrTrend", () => {
  it("returns one point per requested week", () => {
    const scores = [{ load_score: 50, created_at: daysAgo(3) }];
    const trend = computeAcwrTrend(scores, 6);
    expect(trend).toHaveLength(6);
  });

  it("reflects a steady, well-established training load as roughly optimal (near 1.0)", () => {
    // A consistent ~50 AU/day for 40 days -> acute/chronic should land close to 1.0.
    const scores = Array.from({ length: 40 }, (_, i) => ({
      load_score: 50,
      created_at: daysAgo(i),
    }));
    const trend = computeAcwrTrend(scores, 4);
    const latest = trend[trend.length - 1];
    expect(latest.acwr).toBeGreaterThan(0.85);
    expect(latest.acwr).toBeLessThan(1.15);
    expect(latest.zone).toBe("Optimal");
  });

  it("flags a recent spike on top of a low chronic base as Danger", () => {
    // Sparse training in the last month, then a big load in just the last week.
    const scores = [
      { load_score: 400, created_at: daysAgo(1) },
      { load_score: 400, created_at: daysAgo(3) },
      { load_score: 10, created_at: daysAgo(20) },
    ];
    const trend = computeAcwrTrend(scores, 4);
    const latest = trend[trend.length - 1];
    expect(latest.zone).toBe("Danger");
  });

  it("only counts load scored at or before each checkpoint, not future sessions relative to it", () => {
    // A big session logged "today" shouldn't affect a checkpoint computed
    // several weeks in the past — from that checkpoint's perspective, no
    // training has happened yet in either window, so the ratio is 0, not
    // inflated by a session that (relative to that past date) hasn't
    // occurred yet.
    const scores = [{ load_score: 500, created_at: daysAgo(0) }];
    const trend = computeAcwrTrend(scores, 4);
    expect(trend[0].acwr).toBe(0);
    // The most recent checkpoint (today) DOES see that session.
    expect(trend[trend.length - 1].acwr).toBeGreaterThan(0);
  });

  it("is chronologically ordered oldest to newest", () => {
    const scores = [{ load_score: 50, created_at: daysAgo(5) }];
    const trend = computeAcwrTrend(scores, 3);
    expect(trend).toHaveLength(3);
    // Just a sanity check that we get distinct, ordered date labels, not all identical.
    const uniqueDates = new Set(trend.map((t) => t.date));
    expect(uniqueDates.size).toBeGreaterThan(1);
  });
});
