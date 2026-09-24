import { describe, expect, it } from "vitest";
import {
  bucketTone,
  cardioToStrengthVerdict,
  classifyDelta,
  recoveryDay,
  strengthToCardioVerdict,
} from "./interference-advice";
import type { CardioToStrengthFinding, DayBucketStat, StrengthToCardioFinding } from "./interference";

const bucket = (day: number, n: number, ef: number | null): DayBucketStat => ({
  daysSinceStrength: day,
  sampleCount: n,
  efDeltaPct: ef,
  hrDeltaBpm: null,
});

function s2c(overrides: Partial<StrengthToCardioFinding> = {}): StrengthToCardioFinding {
  return {
    calibrating: false,
    lowConfidence: false,
    sampleCount: 6,
    minSamples: 3,
    primarySport: "running",
    totalQualifyingSessions: 10,
    decayByDay: [bucket(0, 0, null), bucket(1, 4, -5.2), bucket(2, 2, -1.1), bucket(3, 0, null)],
    summary: "engine sentence",
    weeklyFallback: null,
    ...overrides,
  };
}

function c2s(overrides: Partial<CardioToStrengthFinding> = {}): CardioToStrengthFinding {
  return {
    calibrating: false,
    lowConfidence: false,
    sampleCount: 8,
    minSamples: 3,
    highCardioAvgStrengthComponent: 580,
    lowCardioAvgStrengthComponent: 612,
    deltaPct: -5.2,
    summary: "engine sentence",
    ...overrides,
  };
}

describe("classifyDelta", () => {
  it("uses the engine's 3% line for 'no cost' and 8% for 'real'", () => {
    expect(classifyDelta(null)).toBe("learning");
    expect(classifyDelta(0)).toBe("none");
    expect(classifyDelta(-2.9)).toBe("none");
    expect(classifyDelta(2.9)).toBe("none");
    expect(classifyDelta(3)).toBe("helps");
    expect(classifyDelta(-3)).toBe("small");
    expect(classifyDelta(-7.9)).toBe("small");
    expect(classifyDelta(-8)).toBe("real");
    expect(classifyDelta(-20)).toBe("real");
  });

  it("colours an empty bucket as empty, never as a verdict", () => {
    expect(bucketTone(bucket(2, 0, null))).toBe("empty");
    expect(bucketTone(bucket(2, 3, null))).toBe("empty");
    expect(bucketTone(bucket(1, 3, -9))).toBe("real");
  });
});

describe("strengthToCardioVerdict", () => {
  it("turns a −5% day-after finding into a small-cost verdict with a rest-days instruction", () => {
    const v = strengthToCardioVerdict(s2c());
    expect(v.verdict).toBe("small");
    expect(v.deltaPct).toBe(-5.2);
    expect(v.headlineDay).toBe(1);
    expect(v.recoversByDay).toBe(2);
    expect(v.sentence).toMatch(/running is about 5\.2% less efficient the day after lifting, back to normal by day 2/);
    expect(v.advice).toMatch(/2 days after/);
  });

  it("calls a −10% finding a real cost and tells the athlete to move key sessions", () => {
    const v = strengthToCardioVerdict(
      s2c({ decayByDay: [bucket(0, 0, null), bucket(1, 5, -10), bucket(2, 3, -6), bucket(3, 2, -1)] })
    );
    expect(v.verdict).toBe("real");
    expect(v.recoversByDay).toBe(3);
    expect(v.advice).toMatch(/at least 3 days after lifting/);
  });

  it("says 'no cost' plainly, without a 'yet'", () => {
    const v = strengthToCardioVerdict(s2c({ decayByDay: [bucket(1, 5, -1)] }));
    expect(v.verdict).toBe("none");
    expect(v.sentence).toMatch(/holds up after lifting/);
    expect(v.sentence).not.toMatch(/yet/);
  });

  it("reports a help as a help", () => {
    const v = strengthToCardioVerdict(s2c({ decayByDay: [bucket(1, 5, 4)] }));
    expect(v.verdict).toBe("helps");
    expect(v.sentence).toMatch(/4% more efficient/);
  });

  it("falls back to the weekly comparison while day-level pairs are still thin", () => {
    const v = strengthToCardioVerdict(
      s2c({
        calibrating: true,
        decayByDay: [],
        weeklyFallback: {
          weeksWithStrengthAvgEF: 4.8,
          weeksWithoutStrengthAvgEF: 5.0,
          deltaPct: -4,
          sampleCountWithStrength: 3,
          sampleCountWithoutStrength: 3,
          summary: "weekly sentence",
        },
      })
    );
    expect(v.verdict).toBe("small");
    expect(v.sentence).toMatch(/weeks where you lifted/);
    expect(v.headlineDay).toBeNull();
  });

  it("is 'learning' with nothing to compare, and passes the engine's own instruction through as advice", () => {
    const v = strengthToCardioVerdict(s2c({ calibrating: true, decayByDay: [], summary: "log a rested run" }));
    expect(v.verdict).toBe("learning");
    expect(v.deltaPct).toBeNull();
    expect(v.advice).toBe("log a rested run");
  });

  it("carries the sample size and the low-confidence flag through unchanged", () => {
    const v = strengthToCardioVerdict(s2c({ lowConfidence: true, sampleCount: 2 }));
    expect(v.lowConfidence).toBe(true);
    expect(v.sampleCount).toBe(2);
    expect(v.minSamples).toBe(3);
  });
});

describe("recoveryDay", () => {
  it("is the first later day with data that sits under the no-cost line", () => {
    expect(recoveryDay([bucket(1, 3, -6), bucket(2, 2, -4), bucket(3, 2, -1)], 1)).toBe(3);
  });
  it("ignores empty buckets and never looks backwards", () => {
    expect(recoveryDay([bucket(0, 2, 0), bucket(1, 3, -6), bucket(2, 0, null)], 1)).toBeNull();
  });
});

describe("cardioToStrengthVerdict", () => {
  it("names a small cost after a heavy cardio stretch", () => {
    const v = cardioToStrengthVerdict(c2s());
    expect(v.verdict).toBe("small");
    expect(v.sentence).toMatch(/5\.2% lower after a heavier 7-day cardio stretch/);
    expect(v.advice).toMatch(/lighter cardio week/);
  });

  it("names a real cost and tells the athlete to lift early in the week", () => {
    const v = cardioToStrengthVerdict(c2s({ deltaPct: -11 }));
    expect(v.verdict).toBe("real");
    expect(v.advice).toMatch(/early in the week/);
  });

  it("is 'learning' while calibrating", () => {
    const v = cardioToStrengthVerdict(c2s({ calibrating: true, deltaPct: null, summary: "log more gym" }));
    expect(v.verdict).toBe("learning");
    expect(v.advice).toBe("log more gym");
  });
});
