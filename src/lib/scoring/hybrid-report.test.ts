import { describe, expect, it } from "vitest";
import { buildHybridReport } from "./hybrid-report";
import type { TimelineSession } from "./timeline";
import type { StoredPredictedBenchmark } from "./predicted-benchmark";

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `activity-${idCounter}`;
}

function cardio(dayOffset: number, overrides: Partial<TimelineSession> = {}): TimelineSession {
  return {
    activityId: nextId(),
    sport: "running",
    domain: "cardio",
    startedAt: new Date(Date.UTC(2026, 0, 1 + dayOffset, 8)).toISOString(),
    durationSeconds: 2400,
    sessionType: "easy",
    avgHeartRate: 140,
    avgPaceSecondsPerKm: 330,
    loadScore: 40,
    enduranceComponent: 500,
    strengthComponent: null,
    efficiencyFactor: 5.0,
    ...overrides,
  };
}

const PERIOD_START = new Date(Date.UTC(2026, 0, 1)).toISOString();
const GENERATED_AT = new Date(Date.UTC(2026, 0, 31)).toISOString();

describe("buildHybridReport", () => {
  it("computes score trend from the first in-period point to the latest", () => {
    const report = buildHybridReport({
      period: "monthly",
      periodStart: PERIOD_START,
      generatedAt: GENERATED_AT,
      scoreHistory: [
        { splitIndex: 500, recordedAt: new Date(Date.UTC(2025, 11, 20)).toISOString() },
        { splitIndex: 520, recordedAt: new Date(Date.UTC(2026, 0, 5)).toISOString() },
        { splitIndex: 550, recordedAt: new Date(Date.UTC(2026, 0, 30)).toISOString() },
      ],
      sessions: [],
      predictedBenchmark: null,
    });

    expect(report.scoreTrend.startIndex).toBe(520);
    expect(report.scoreTrend.endIndex).toBe(550);
    expect(report.scoreTrend.deltaPct).toBeCloseTo(5.8, 1);
  });

  it("returns nulls for score trend when there's no history at all", () => {
    const report = buildHybridReport({
      period: "monthly",
      periodStart: PERIOD_START,
      generatedAt: GENERATED_AT,
      scoreHistory: [],
      sessions: [],
      predictedBenchmark: null,
    });

    expect(report.scoreTrend.startIndex).toBeNull();
    expect(report.scoreTrend.endIndex).toBeNull();
    expect(report.scoreTrend.deltaPct).toBeNull();
  });

  it("reports a gathering-data interference headline with too little paired history", () => {
    const report = buildHybridReport({
      period: "monthly",
      periodStart: PERIOD_START,
      generatedAt: GENERATED_AT,
      scoreHistory: [],
      sessions: [cardio(1), cardio(2)],
      predictedBenchmark: null,
    });

    expect(report.interferenceHeadline).toMatch(/gathering/i);
  });

  it("has no target pace label when there's no stored prediction", () => {
    const report = buildHybridReport({
      period: "monthly",
      periodStart: PERIOD_START,
      generatedAt: GENERATED_AT,
      scoreHistory: [],
      sessions: [],
      predictedBenchmark: null,
    });

    expect(report.targetPaceLabel).toBeNull();
  });

  it("reuses the existing Tier 2 prediction for the target pace label rather than recalculating", () => {
    const benchmark: StoredPredictedBenchmark = { benchmarkSeconds: 1233, sampleCount: 6, riegelK: 1.06 };
    const report = buildHybridReport({
      period: "monthly",
      periodStart: PERIOD_START,
      generatedAt: GENERATED_AT,
      scoreHistory: [],
      sessions: [],
      predictedBenchmark: benchmark,
    });

    expect(report.targetPaceLabel).toMatch(/5K/);
    expect(report.targetPaceLabel).toMatch(/20:33/);
  });

  it("computes a readiness trend between the period start and generation time", () => {
    const sessions = Array.from({ length: 10 }, (_, i) => cardio(i));
    const report = buildHybridReport({
      period: "monthly",
      periodStart: PERIOD_START,
      generatedAt: GENERATED_AT,
      scoreHistory: [],
      sessions,
      predictedBenchmark: null,
    });

    expect(report.readinessTrend.start).toBeGreaterThanOrEqual(0);
    expect(report.readinessTrend.end).toBeGreaterThanOrEqual(0);
    expect(report.readinessTrend.delta).toBe(report.readinessTrend.end - report.readinessTrend.start);
  });
});
