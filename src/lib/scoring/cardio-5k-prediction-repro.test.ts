import { describe, expect, it } from "vitest";
import {
  blendPredictedBenchmark,
  effectiveStoredPrediction,
  sessionCountsAsQuality,
  personalEasyEffortBaselineEF,
  terrainAdjustedSessionEF,
  isDirectBenchmarkDistance,
} from "./cardio-predictions";
import {
  computeWindowedTier2Seconds,
  personalizeRiegelKFromWindow,
  type HistorySession,
} from "./cardio/race-prediction";
import { BENCHMARK_DISTANCE_METERS } from "./cardio-benchmarks";
import { computeBodyBenchmarkEquivalentSeconds } from "./adapters";
import type { SessionType } from "@/types";

interface LoggedRun {
  startedAt: string;
  distanceMeters: number;
  durationSeconds: number;
  avgHR?: number | null;
  sessionType: SessionType | null;
}

/** Faithful replay of the prediction half of `POST /api/activities/recompute`. */
function replayRunPrediction(runs: LoggedRun[], now: Date) {
  let stored: number | null = null;
  let storedK: number | null = null;
  let lastRunAt: string | null = null;
  let lastQualityAt: string | null = null;
  const priorSessions: HistorySession[] = [];

  for (const run of runs) {
    const startedMs = new Date(run.startedAt).getTime();
    const decayedPrior =
      stored != null
        ? effectiveStoredPrediction(stored, lastRunAt, lastQualityAt, new Date(run.startedAt))
        : null;

    const windowCutoff = startedMs - 90 * 24 * 60 * 60 * 1000;
    const windowSessions = priorSessions.filter(
      (s) => new Date(s.startedAt).getTime() >= windowCutoff
    );

    const personalizedK = personalizeRiegelKFromWindow(windowSessions, storedK);
    const baselineEF = personalEasyEffortBaselineEF("run", windowSessions, personalizedK ?? undefined);

    const equivalent = computeBodyBenchmarkEquivalentSeconds(
      "run",
      {
        distance_meters: run.distanceMeters,
        duration_seconds: run.durationSeconds,
        avg_heart_rate: run.avgHR,
      },
      personalizedK ?? undefined
    );
    if (equivalent === null) continue;

    const sequential = blendPredictedBenchmark(decayedPrior, equivalent, {
      sessionType: run.sessionType,
      thisSessionEF: terrainAdjustedSessionEF(run.distanceMeters, run.durationSeconds, run.avgHR),
      baselineEF,
      isDirectBenchmarkDistance: isDirectBenchmarkDistance(
        run.distanceMeters,
        BENCHMARK_DISTANCE_METERS.run
      ),
    });
    stored = computeWindowedTier2Seconds("run", sequential, windowSessions);
    storedK = personalizedK;
    lastRunAt = run.startedAt;
    if (sessionCountsAsQuality(decayedPrior, equivalent) || lastQualityAt == null) {
      lastQualityAt = run.startedAt;
    }

    priorSessions.push({
      distanceMeters: run.distanceMeters,
      durationSeconds: run.durationSeconds,
      avgHR: run.avgHR ?? undefined,
      sessionType: run.sessionType ?? undefined,
      startedAt: run.startedAt,
    });
  }

  return {
    storedSeconds: stored,
    riegelK: storedK,
    /** What a reader of the row gets after decay is honoured at read time. */
    effectiveSeconds:
      stored == null ? null : effectiveStoredPrediction(stored, lastRunAt, lastQualityAt, now),
    lastRunAt,
    lastQualityAt,
  };
}

const day = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-03-01T09:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * day).toISOString();

/**
 * A sub-19-minute 5k runner's realistic recent log: several 5-10km runs at
 * 3:45-4:00/km plus a couple of longer easy runs. Every one of these is
 * faster than 21:00 5k-equivalent pace, so no honest reading of this history
 * can produce a 25:00 prediction.
 */
const REALISTIC_RUNS: LoggedRun[] = [
  { startedAt: daysAgo(40), distanceMeters: 8000, durationSeconds: 8 * 235, avgHR: 168, sessionType: "tempo" },
  { startedAt: daysAgo(35), distanceMeters: 16000, durationSeconds: 16 * 300, avgHR: 141, sessionType: "long" },
  { startedAt: daysAgo(30), distanceMeters: 10000, durationSeconds: 10 * 240, avgHR: 171, sessionType: "tempo" },
  { startedAt: daysAgo(24), distanceMeters: 6000, durationSeconds: 6 * 228, avgHR: 174, sessionType: "threshold" },
  { startedAt: daysAgo(18), distanceMeters: 18000, durationSeconds: 18 * 310, avgHR: 139, sessionType: "long" },
  { startedAt: daysAgo(12), distanceMeters: 5000, durationSeconds: 5 * 226, avgHR: 176, sessionType: "tempo" },
  { startedAt: daysAgo(6), distanceMeters: 10000, durationSeconds: 10 * 237, avgHR: 172, sessionType: "tempo" },
];

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

describe("predicted 5k from a realistic sub-19 training log", () => {
  it("lands near 18:30, not 25:00", () => {
    const result = replayRunPrediction(REALISTIC_RUNS, NOW);
    // eslint-disable-next-line no-console
    console.log("stored", mmss(result.storedSeconds!), "effective", mmss(result.effectiveSeconds!), "k", result.riegelK);
    expect(result.storedSeconds).not.toBeNull();
    expect(result.storedSeconds!).toBeGreaterThan(17 * 60);
    expect(result.storedSeconds!).toBeLessThan(19.5 * 60);
    expect(result.effectiveSeconds!).toBeLessThan(19.5 * 60);
  });
});
