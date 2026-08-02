import { describe, expect, it } from "vitest";
import { buildTodayPlan } from "./today-plan";
import type { ReadinessResult } from "./readiness";
import type { InterferenceReport } from "./interference";
import type { StoredPredictedBenchmark } from "./predicted-benchmark";

function readiness(overrides: Partial<ReadinessResult> = {}): ReadinessResult {
  return {
    readiness: 80,
    overallAcwr: 1.0,
    gymAcwr: 1.0,
    cardioAcwr: 1.0,
    gymElevated: false,
    cardioElevated: false,
    reason: "Fully ready.",
    ...overrides,
  };
}

const calibratingInterference: InterferenceReport = {
  strengthToCardio: {
    calibrating: true,
    sampleCount: 1,
    minSamples: 5,
    primarySport: null,
    totalQualifyingSessions: 1,
    decayByDay: [],
    summary: "Gathering data.",
  },
  cardioToStrength: {
    calibrating: true,
    sampleCount: 1,
    minSamples: 5,
    highCardioAvgStrengthComponent: null,
    lowCardioAvgStrengthComponent: null,
    deltaPct: null,
    summary: "Gathering data.",
  },
};

describe("buildTodayPlan", () => {
  it("suggests a hard session on a high-readiness day", () => {
    const plan = buildTodayPlan(readiness({ readiness: 85 }), calibratingInterference, null);
    expect(plan.suggestedIntensity).toBe("hard");
    expect(plan.deloadNudge).toBeNull();
  });

  it("suggests moderate effort at mid readiness", () => {
    const plan = buildTodayPlan(readiness({ readiness: 55 }), calibratingInterference, null);
    expect(plan.suggestedIntensity).toBe("moderate");
  });

  it("suggests easy/recovery at low readiness", () => {
    const plan = buildTodayPlan(readiness({ readiness: 20 }), calibratingInterference, null);
    expect(plan.suggestedIntensity).toBe("easy");
  });

  it("has no target pace label when there's no stored prediction", () => {
    const plan = buildTodayPlan(readiness(), calibratingInterference, null);
    expect(plan.targetPaceLabel).toBeNull();
  });

  it("has no target pace label while the prediction is still calibrating", () => {
    const benchmark: StoredPredictedBenchmark = { benchmarkSeconds: 1200, sampleCount: 2, riegelK: null };
    const plan = buildTodayPlan(readiness(), calibratingInterference, benchmark);
    expect(plan.targetPaceLabel).toBeNull();
  });

  it("builds a target pace label from a real, non-calibrating prediction", () => {
    const benchmark: StoredPredictedBenchmark = { benchmarkSeconds: 1233, sampleCount: 6, riegelK: 1.06 };
    const plan = buildTodayPlan(readiness(), calibratingInterference, benchmark);
    expect(plan.targetPaceLabel).toMatch(/5K/);
    expect(plan.targetPaceLabel).toMatch(/20:33/);
  });

  it("does not suggest a deload when readiness is high, even with real interference cost", () => {
    const interference: InterferenceReport = {
      ...calibratingInterference,
      strengthToCardio: {
        calibrating: false,
        sampleCount: 6,
        minSamples: 5,
        primarySport: "running",
        totalQualifyingSessions: 6,
        decayByDay: [{ daysSinceStrength: 1, sampleCount: 3, efDeltaPct: -10, hrDeltaBpm: 6 }],
        summary: "Strength sessions cost you...",
      },
    };
    const plan = buildTodayPlan(readiness({ readiness: 85 }), interference, null);
    expect(plan.deloadNudge).toBeNull();
  });

  it("suggests a deload only when BOTH readiness is low AND interference shows real cost — the combined signal neither feature could give alone", () => {
    const interference: InterferenceReport = {
      ...calibratingInterference,
      strengthToCardio: {
        calibrating: false,
        sampleCount: 6,
        minSamples: 5,
        primarySport: "running",
        totalQualifyingSessions: 6,
        decayByDay: [{ daysSinceStrength: 1, sampleCount: 3, efDeltaPct: -10, hrDeltaBpm: 6 }],
        summary: "Strength sessions cost you...",
      },
    };
    const plan = buildTodayPlan(readiness({ readiness: 25 }), interference, null);
    expect(plan.deloadNudge).toMatch(/deload/i);
  });

  it("does not suggest a deload when readiness is low but interference is still calibrating (no real signal yet)", () => {
    const plan = buildTodayPlan(readiness({ readiness: 25 }), calibratingInterference, null);
    expect(plan.deloadNudge).toBeNull();
  });
});
