import { describe, expect, it } from "vitest";
import {
  buildPacingPlan,
  clockTime,
  deltaLabel,
  mmss,
  PACING_STRATEGIES,
  segmentSizeKm,
  type PacingStrategy,
} from "./race-pacing";

const STRATEGIES: PacingStrategy[] = ["even", "negative", "fast_start"];

describe("buildPacingPlan", () => {
  it("splits sum to the target time exactly, for every strategy and a spread of targets", () => {
    // The whole point of the card. An athlete runs to the splits; if they add
    // up to something other than the target, the card lies at the finish line.
    for (const strategy of STRATEGIES) {
      for (const total of [1080, 1123, 1200, 1247, 1500, 1801, 2699, 5400, 12_600]) {
        for (const distance of [5, 10, 21.1, 42.2]) {
          const plan = buildPacingPlan(total, distance, strategy);
          const summed = plan.segments.reduce((s, seg) => s + seg.splitS, 0);
          expect(summed, `${strategy} ${total}s over ${distance}km`).toBe(total);
          expect(plan.segments[plan.segments.length - 1]!.cumulativeS).toBe(total);
        }
      }
    }
  });

  it("cumulative times are the running sum of the splits, and strictly increasing", () => {
    for (const strategy of STRATEGIES) {
      const plan = buildPacingPlan(1247, 5, strategy);
      let running = 0;
      let previous = 0;
      for (const seg of plan.segments) {
        running += seg.splitS;
        expect(seg.cumulativeS).toBe(running);
        expect(seg.cumulativeS).toBeGreaterThan(previous);
        previous = seg.cumulativeS;
      }
    }
  });

  it("covers the full distance with contiguous segments", () => {
    const plan = buildPacingPlan(1200, 5, "even");
    expect(plan.segments[0]!.fromKm).toBe(0);
    expect(plan.segments[plan.segments.length - 1]!.toKm).toBeCloseTo(5, 6);
    for (let i = 1; i < plan.segments.length; i += 1) {
      expect(plan.segments[i]!.fromKm).toBeCloseTo(plan.segments[i - 1]!.toKm, 6);
    }
  });

  it("even splits are within a second of each other", () => {
    const plan = buildPacingPlan(1247, 5, "even");
    const splits = plan.segments.map((s) => s.splitS);
    expect(Math.max(...splits) - Math.min(...splits)).toBeLessThanOrEqual(1);
  });

  it("a negative split runs the second half faster than the first", () => {
    const plan = buildPacingPlan(1200, 10, "negative");
    // Equal counts of equal-length segments at each end, so the comparison is
    // like for like even when the segment count is odd.
    const half = Math.floor(plan.segments.length / 2);
    const first = plan.segments.slice(0, half).reduce((s, x) => s + x.splitS, 0);
    const second = plan.segments.slice(plan.segments.length - half).reduce((s, x) => s + x.splitS, 0);
    expect(second).toBeLessThan(first);
    // And monotonically, kilometre by kilometre — a "negative split" that
    // wanders is just noise with a name.
    for (let i = 1; i < plan.segments.length; i += 1) {
      expect(plan.segments[i]!.paceSPerKm).toBeLessThanOrEqual(plan.segments[i - 1]!.paceSPerKm + 0.01);
    }
  });

  it("a hard start opens and closes faster than target, and pays for it in the middle", () => {
    const plan = buildPacingPlan(1200, 5, "fast_start");
    const first = plan.segments[0]!;
    const last = plan.segments[plan.segments.length - 1]!;
    const middle = plan.segments.slice(1, -1);
    expect(first.paceSPerKm).toBeLessThan(plan.targetPaceSPerKm);
    expect(last.paceSPerKm).toBeLessThan(plan.targetPaceSPerKm);
    // The trade has to be visible, not hidden: spending at both ends means the
    // middle is slower than target. If it were not, the card would be
    // promising free time.
    for (const seg of middle) expect(seg.paceSPerKm).toBeGreaterThan(plan.targetPaceSPerKm);
  });

  it("target pace is the target time over the distance, whatever the strategy", () => {
    for (const strategy of STRATEGIES) {
      const plan = buildPacingPlan(1500, 5, strategy);
      expect(plan.targetPaceSPerKm).toBeCloseTo(300, 6);
      expect(plan.totalS).toBe(1500);
    }
  });

  it("keeps the number of rows readable at every common race distance", () => {
    for (const distance of [5, 10, 21.1, 42.2]) {
      const plan = buildPacingPlan(3600, distance, "even");
      expect(plan.segments.length).toBeGreaterThanOrEqual(3);
      expect(plan.segments.length).toBeLessThanOrEqual(8);
    }
  });

  it("survives degenerate input rather than emitting NaN", () => {
    const plan = buildPacingPlan(0, 0, "negative");
    expect(plan.segments.every((s) => Number.isFinite(s.splitS))).toBe(true);
    expect(plan.segments.reduce((s, x) => s + x.splitS, 0)).toBe(plan.totalS);
  });

  it("exposes one metadata entry per strategy", () => {
    expect(PACING_STRATEGIES.map((s) => s.id).sort()).toEqual([...STRATEGIES].sort());
  });
});

describe("formatting", () => {
  it("segmentSizeKm scales with the race", () => {
    expect(segmentSizeKm(5)).toBe(1);
    expect(segmentSizeKm(10)).toBe(2);
    expect(segmentSizeKm(42.2)).toBe(7);
  });

  it("mmss pads seconds", () => {
    expect(mmss(245)).toBe("4:05");
    expect(mmss(60)).toBe("1:00");
  });

  it("clockTime adds hours only when there are hours", () => {
    expect(clockTime(1247)).toBe("20:47");
    expect(clockTime(3661)).toBe("1:01:01");
  });

  it("deltaLabel names the direction", () => {
    expect(deltaLabel(0.2)).toBe("on target");
    expect(deltaLabel(4)).toBe("+4s/km");
    expect(deltaLabel(-3)).toBe("-3s/km");
  });
});
