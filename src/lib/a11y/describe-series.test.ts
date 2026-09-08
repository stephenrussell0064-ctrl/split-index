import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  describeComparison,
  describeDistribution,
  describeSeries,
} from "./describe-series";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * N7 item 1 — the sentence a screen reader gets instead of the picture.
 *
 * Charts had `role="img"` with labels like "Index trend chart with 20 data
 * points". That names the picture. WCAG 1.1.1 asks for an alternative serving
 * the equivalent PURPOSE, and the purpose of a trend chart is which way the
 * number went, by how much, over what period.
 *
 * The sentence is a pure function so it can be tested properly. The wrapper is
 * checked by reading source, which is weaker and says so — no React testing
 * library here.
 */

const P = (at: string, value: number) => ({ at, value });

describe("describeSeries", () => {
  it("says where it started, where it ended and which way it went", () => {
    const s = describeSeries("Split Index", [P("1 Jan", 400), P("1 Feb", 448)]);
    expect(s).toContain("up");
    expect(s).toContain("400");
    expect(s).toContain("448");
    expect(s).toContain("+48");
  });

  it("signs a fall correctly", () => {
    const s = describeSeries("Split Index", [P("1 Jan", 448), P("1 Feb", 400)]);
    expect(s).toContain("down");
    expect(s).toContain("-48");
    expect(s).not.toContain("+");
  });

  /**
   * A single point is a reading, not a trend. Calling it "unchanged" would be a
   * claim about a period that has not happened.
   */
  it("does not describe one point as a trend", () => {
    const s = describeSeries("Recovery", [P("Monday", 72)]);
    expect(s).toContain("single reading");
    expect(s).not.toContain("unchanged");
    expect(s).not.toMatch(/\bup\b|\bdown\b/);
  });

  it("says so when there is nothing yet", () => {
    expect(describeSeries("Load", [])).toContain("no data");
  });

  /**
   * The case that makes the range clause worth having: endpoints identical, and
   * a real dip in between. Without it the sentence is true and useless.
   */
  it("mentions the range when the line moved and came back", () => {
    const s = describeSeries("Split", [P("a", 400), P("b", 310), P("c", 400)]);
    expect(s).toContain("unchanged at 400");
    expect(s).toContain("310");
  });

  it("stays quiet about range when the endpoints already bound it", () => {
    // A monotonic rise: min and max ARE the endpoints, so repeating them adds
    // length and no information.
    const s = describeSeries("Split", [P("a", 400), P("b", 420), P("c", 448)]);
    expect(s).not.toContain("Ranged between");
  });

  it("does not print a trailing .0 on whole numbers", () => {
    expect(describeSeries("Split", [P("a", 400), P("b", 448)])).not.toContain("400.0");
  });

  it("does not divide by anything when the line is flat", () => {
    // A flat series has zero delta; an earlier shape of this computed a
    // percentage and produced NaN.
    const s = describeSeries("Split", [P("a", 400), P("b", 400), P("c", 400)]);
    expect(s).not.toContain("NaN");
    expect(s).toContain("unchanged at 400");
  });
});

describe("describeDistribution — a pie has no direction", () => {
  /**
   * `describeSeries` answers "which way did it go", which is the wrong question
   * for a donut. What a sighted reader takes from one is the ORDER OF SIZE, so
   * that is what the sentence leads with — and it is the one thing a
   * screen-reader user cannot get from the visual.
   */
  it("reads largest share first, not chart order", () => {
    const s = describeDistribution("Time in zones", [
      { name: "Zone 1", value: 10 },
      { name: "Zone 2", value: 60 },
      { name: "Zone 3", value: 30 },
    ]);
    expect(s.indexOf("Zone 2")).toBeLessThan(s.indexOf("Zone 3"));
    expect(s.indexOf("Zone 3")).toBeLessThan(s.indexOf("Zone 1"));
  });

  it("gives shares, because the raw units differ by caller", () => {
    const s = describeDistribution("Sessions", [
      { name: "Easy", value: 3 },
      { name: "Hard", value: 1 },
    ]);
    expect(s).toContain("Easy 75%");
    expect(s).toContain("Hard 25%");
  });

  it("drops empty bands rather than reading a list of zeroes", () => {
    const s = describeDistribution("Sessions", [
      { name: "Easy", value: 5 },
      { name: "Tempo", value: 0 },
    ]);
    expect(s).not.toContain("Tempo");
  });

  it("says so when nothing is logged, without dividing by zero", () => {
    expect(describeDistribution("Sessions", [])).toContain("nothing logged");
    const allZero = describeDistribution("Sessions", [{ name: "Easy", value: 0 }]);
    expect(allZero).toContain("nothing logged");
    expect(allZero).not.toContain("NaN");
  });
});

describe("describeComparison — who is ahead, and is the gap moving", () => {
  const a = { label: "You", data: [{ at: "Jan", value: 400 }, { at: "Feb", value: 460 }] };
  const b = { label: "Rachel", data: [{ at: "Jan", value: 420 }, { at: "Feb", value: 430 }] };

  it("names who ends ahead", () => {
    expect(describeComparison([a, b])).toContain("You ahead at the end");
  });

  /**
   * The question a comparison chart actually answers. Two separate trend
   * sentences would give both athletes' movement and never say the thing the
   * reader is looking for.
   */
  it("says whether the gap opened or closed", () => {
    // 20 apart in January, 30 apart in February.
    expect(describeComparison([a, b])).toContain("widening");
    const closing = describeComparison([
      { label: "You", data: [{ at: "Jan", value: 400 }, { at: "Feb", value: 425 }] },
      { label: "Rachel", data: [{ at: "Jan", value: 450 }, { at: "Feb", value: 430 }] },
    ]);
    expect(closing).toContain("narrowing");
  });

  it("handles a dead heat without claiming somebody won", () => {
    const level = describeComparison([
      { label: "You", data: [{ at: "Jan", value: 400 }, { at: "Feb", value: 440 }] },
      { label: "Rachel", data: [{ at: "Jan", value: 410 }, { at: "Feb", value: 440 }] },
    ]);
    expect(level).toContain("Level at the end");
    expect(level).not.toContain("ahead");
  });

  it("refuses to compare when only one athlete has history", () => {
    expect(describeComparison([a, { label: "Rachel", data: [] }])).toContain(
      "Not enough history"
    );
  });
});

describe("charts expose their data, not only a name", () => {
  const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
  const read = (rel: string) =>
    stripComments(readFileSync(`${ROOT}/${rel}`, "utf8"));

  /** Charts converted to ChartFigure, so each emits a table and a summary. */
  const CONVERTED = [
    "src/components/analytics/charts.tsx",
    "src/components/analytics/trend-panel.tsx",
    "src/components/analytics/moving-average-chart.tsx",
    "src/components/analytics/volume-chart.tsx",
    "src/components/analytics/fatigue-recovery-chart.tsx",
    "src/components/analytics/projection-chart.tsx",
    "src/components/analytics/acwr-trend-chart.tsx",
    "src/components/analytics/interference-detail.tsx",
    "src/components/dashboard/engine-lab-trend-card.tsx",
    "src/components/analytics/training-zones-chart.tsx",
    "src/components/analytics/intensity-distribution.tsx",
    "src/components/social/compare-chart.tsx",
  ];

  /**
   * Empty, and that is the point of keeping it.
   *
   * It held `training-zones-chart`, `intensity-distribution` and
   * `compare-chart` — the three categorical charts, where `describeSeries` did
   * not fit because a donut has no direction and a two-athlete comparison has
   * no single "the" value. Each has its own sentence now:
   * `describeDistribution` leads with the order of size, and
   * `describeComparison` says who is ahead and whether the gap is moving.
   *
   * The list stays so that a chart added without a data equivalent has
   * somewhere to be declared, with a reason, rather than quietly not appearing
   * in CONVERTED.
   */
  const NO_DATA_EQUIVALENT_YET: Record<string, string> = {};

  it.each(CONVERTED)("%s renders a data equivalent", (file) => {
    const code = read(file);
    expect(code).toContain("<ChartFigure");
    expect(code).toContain("summary=");
    expect(code).toContain("columns=");
    expect(code).toContain("rows=");
  });

  it("puts the table outside the role=img subtree", () => {
    /*
      The trap this guards. `role="img"` makes its whole subtree presentational,
      so a table nested inside it is invisible to a screen reader — the fix
      would render, look right, and do nothing. In ChartFigure the two are
      siblings, and they must stay siblings.
    */
    const fig = read("src/components/analytics/chart-figure.tsx");
    const imgOpen = fig.indexOf('role="img"');
    const imgClose = fig.indexOf("</div>", imgOpen);
    const table = fig.indexOf("<table");
    expect(imgOpen).toBeGreaterThan(-1);
    expect(table).toBeGreaterThan(imgClose);
  });

  it("keeps the data equivalent in the accessibility tree", () => {
    const fig = read("src/components/analytics/chart-figure.tsx");
    // sr-only, never hidden or aria-hidden — those remove it from the tree,
    // which is the one thing that would make this whole change cosmetic.
    expect(fig).toContain('className="sr-only"');
    expect(fig).not.toContain("aria-hidden");
    expect(fig).not.toMatch(/\bhidden\b(?!.*sr-only)/);
  });

  it("gives every table a caption and column headers", () => {
    const fig = read("src/components/analytics/chart-figure.tsx");
    expect(fig).toContain("<caption>");
    expect(fig).toContain('scope="col"');
    // The first cell of each row is the row's identity, so a screen reader can
    // say "week 3, load 412" rather than reading a bare number.
    expect(fig).toContain('scope="row"');
  });

  it("caps a long series rather than reading out a year of dates", () => {
    const fig = read("src/components/analytics/chart-figure.tsx");
    expect(fig).toContain("MAX_ROWS");
    expect(fig).toMatch(/slice\(0, MAX_ROWS\)/);
  });

  /**
   * The regression this prevents: reverting a chart to a bare `role="img"`
   * wrapper. That was the state the finding described — a name and no data —
   * and it looks entirely reasonable in a diff.
   */
  it("leaves no chart with only a label", () => {
    const offenders: string[] = [];
    for (const file of [...CONVERTED, ...Object.keys(NO_DATA_EQUIVALENT_YET)]) {
      const code = read(file);
      if (code.includes('role="img"') && !code.includes("<ChartFigure")) {
        offenders.push(file);
      }
    }
    expect(
      offenders,
      "these name the chart without exposing its values — the exact state N7 " +
        "item 1 describes:\n  " + offenders.join("\n  ")
    ).toEqual([]);
  });

  it("keeps every uncovered chart documented with a reason", () => {
    for (const [file, reason] of Object.entries(NO_DATA_EQUIVALENT_YET)) {
      expect(reason.length, `${file} has no reason recorded`).toBeGreaterThan(40);
      // And it must still exist, or the entry is stale.
      expect(() => read(file), `${file} is gone`).not.toThrow();
    }
  });
});
