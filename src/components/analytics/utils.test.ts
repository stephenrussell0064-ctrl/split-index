import { describe, expect, it } from "vitest";
import { buildTrendSeries } from "./utils";
import type { SplitIndexSnapshot } from "@/types";

/**
 * User feedback: "please fix the analytics tab week/month/year toggle
 * function" — it wasn't broken in the sense of not firing (the state
 * update and re-render worked fine), but the "week" branch labeled every
 * point with just a weekday name ("Mon", "Tue", ...) without windowing the
 * input first. A premium user's indexHistory can span up to a year (365
 * days, up to 400 rows) — collapsed to one point per real day but each
 * only labeled by weekday, that's up to 52+ points sharing 7 x-axis labels,
 * which renders as a scrambled, seemingly-broken chart no matter which
 * toggle is selected.
 */
function snapshotAt(daysAgo: number): SplitIndexSnapshot {
  const recorded = new Date(Date.now() - daysAgo * 86400000);
  return {
    recorded_at: recorded.toISOString(),
    split_index: 500 + daysAgo,
    endurance_index: 500,
    strength_index: 500,
  } as SplitIndexSnapshot;
}

describe("buildTrendSeries — week granularity windowing", () => {
  it("only includes points from the last 7 days, not the athlete's entire history", () => {
    // A full year of daily snapshots — realistic for a premium user (up to
    // 365 days / 400 rows fetched on the analytics page).
    const yearOfHistory = Array.from({ length: 365 }, (_, i) => snapshotAt(i));

    const result = buildTrendSeries(yearOfHistory, "week");

    expect(result.length).toBeLessThanOrEqual(7);
  });

  it("never produces duplicate date labels (the actual visible bug — a scrambled x-axis)", () => {
    const yearOfHistory = Array.from({ length: 365 }, (_, i) => snapshotAt(i));

    const result = buildTrendSeries(yearOfHistory, "week");
    const labels = result.map((p) => p.date);

    expect(new Set(labels).size).toBe(labels.length);
  });

  it("a genuinely sparse history (a handful of sessions this week) still renders correctly", () => {
    const thisWeekOnly = [snapshotAt(0), snapshotAt(2), snapshotAt(5)];

    const result = buildTrendSeries(thisWeekOnly, "week");

    expect(result.length).toBe(3);
  });

  it("month and year granularity still produce visibly different bucket counts (toggle actually changes the chart)", () => {
    const yearOfHistory = Array.from({ length: 365 }, (_, i) => snapshotAt(i));

    const monthly = buildTrendSeries(yearOfHistory, "month");
    const yearly = buildTrendSeries(yearOfHistory, "year");

    expect(monthly.length).toBeGreaterThan(yearly.length);
  });
});
