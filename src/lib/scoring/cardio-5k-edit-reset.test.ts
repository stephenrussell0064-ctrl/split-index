/**
 * Regression: editing an already-scored activity must not wipe out the
 * athlete's stored 5k prediction.
 *
 * Real account, real symptom: the dashboard's 5K tile read 24:59 for an
 * athlete whose logged 5k race is 18:25. The stored `predicted_benchmarks`
 * row held 1499.22s with sample_count 24 — and 1499.22s is, to the hundredth,
 * the bare HR-adjusted Riegel 5k-equivalent of ONE session in their log (an
 * easy 7.5km in 40:00 at 162bpm, k=1.088). Not a blend of 24 sessions. Not
 * the hybrid-plan engine's 1500.0 no-data placeholder either — the odd
 * second is the tell that this is a genuinely computed number.
 *
 * `PATCH /api/activities/[id]` nulled the blend base whenever the stored row's
 * last_activity_id was the activity being edited, meaning to avoid
 * double-counting that session's own evidence. But a null base makes
 * `blendPredictedBenchmark` SEED rather than blend, so re-saving that easy run
 * replaced the whole memory — including the 18:25 race — with the easy run's
 * own equivalent, while `sample_count` was deliberately carried across so the
 * dashboard still considered it calibrated and displayed it.
 */
import { describe, expect, it } from "vitest";
import {
  blendPredictedBenchmark,
  isDirectBenchmarkDistance,
  terrainAdjustedSessionEF,
} from "./cardio-predictions";
import {
  personalizeRiegelKFromWindow,
  replayStoredPredictionFromSessions,
  type HistorySession,
} from "./cardio/race-prediction";
import { BENCHMARK_DISTANCE_METERS } from "./cardio-benchmarks";
import { computeBodyBenchmarkEquivalentSeconds } from "./adapters";
import { formatRiegelPrediction } from "./presentation";
import type { SessionType } from "@/types";

interface LoggedRun extends HistorySession {
  id: string;
  sessionType: SessionType;
  startedAt: string;
}

/** The athlete's actual non-draft running log, oldest first. */
const RUN_LOG: LoggedRun[] = [
  { id: "8ce60b4c", startedAt: "2026-05-06T13:03:00Z", distanceMeters: 4750, durationSeconds: 1271, avgHR: 186, sessionType: "tempo" },
  { id: "61c57efa", startedAt: "2026-05-17T13:18:00Z", distanceMeters: 10120, durationSeconds: 3199, avgHR: 174, sessionType: "easy" },
  { id: "20d4f04e", startedAt: "2026-05-18T13:20:00Z", distanceMeters: 1880, durationSeconds: 441, avgHR: 200, sessionType: "threshold" },
  { id: "ab20fa64", startedAt: "2026-05-22T10:01:00Z", distanceMeters: 9480, durationSeconds: 2943, avgHR: 183, sessionType: "easy" },
  { id: "6cc7c032", startedAt: "2026-05-27T10:06:00Z", distanceMeters: 5000, durationSeconds: 1181, avgHR: 191, sessionType: "threshold" },
  { id: "b202da58", startedAt: "2026-05-31T10:07:00Z", distanceMeters: 15070, durationSeconds: 4642, avgHR: 173, sessionType: "easy" },
  { id: "0b32e77a", startedAt: "2026-06-06T10:09:00Z", distanceMeters: 11560, durationSeconds: 3186, avgHR: 193, sessionType: "race" },
  { id: "ad9f3e8f", startedAt: "2026-06-15T10:10:00Z", distanceMeters: 9720, durationSeconds: 2870, avgHR: 177, sessionType: "easy" },
  { id: "b44efe91", startedAt: "2026-06-21T09:11:00Z", distanceMeters: 8230, durationSeconds: 2125, avgHR: 185, sessionType: "threshold" },
  { id: "1c2b53ec", startedAt: "2026-06-23T10:14:00Z", distanceMeters: 17530, durationSeconds: 5613, avgHR: 183, sessionType: "long" },
  { id: "97f16147", startedAt: "2026-06-27T10:15:00Z", distanceMeters: 5000, durationSeconds: 1160, avgHR: 188, sessionType: "easy" },
  { id: "079061ae", startedAt: "2026-06-30T10:17:00Z", distanceMeters: 7530, durationSeconds: 1982, avgHR: 178, sessionType: "interval" },
  { id: "d38e4267", startedAt: "2026-07-05T10:21:00Z", distanceMeters: 12520, durationSeconds: 3930, avgHR: 166, sessionType: "easy" },
  { id: "4c3f0e84", startedAt: "2026-07-12T10:22:00Z", distanceMeters: 18240, durationSeconds: 5390, avgHR: 173, sessionType: "easy" },
  { id: "feb5199f", startedAt: "2026-07-15T10:23:00Z", distanceMeters: 5000, durationSeconds: 1151, avgHR: 188, sessionType: "race" },
  // The 18:25 5k PR.
  { id: "54ca83a4", startedAt: "2026-07-25T16:59:00Z", distanceMeters: 5000, durationSeconds: 1105, avgHR: 192, sessionType: "race" },
  { id: "7de4d409", startedAt: "2026-08-01T11:10:00Z", distanceMeters: 7000, durationSeconds: 1765, avgHR: 185, sessionType: "interval" },
  { id: "5fc5d0b8", startedAt: "2026-08-02T10:48:00Z", distanceMeters: 7000, durationSeconds: 1765, avgHR: 188, sessionType: "interval" },
  { id: "2fc54d14", startedAt: "2026-08-02T10:52:00Z", distanceMeters: 19140, durationSeconds: 6091, avgHR: 166, sessionType: "easy" },
  { id: "de0b0c08", startedAt: "2026-08-08T11:13:00Z", distanceMeters: 9930, durationSeconds: 2365, avgHR: 196, sessionType: "race" },
  // The session that got re-saved, and whose own equivalent is 1499.22s.
  { id: "d5a4c07f", startedAt: "2026-08-08T11:36:00Z", distanceMeters: 7500, durationSeconds: 2400, avgHR: 162, sessionType: "easy" },
  { id: "145104af", startedAt: "2026-08-12T19:41:00Z", distanceMeters: 9407.1, durationSeconds: 3011, avgHR: 169, sessionType: "easy" },
];

const EDITED_ID = "d5a4c07f";
const edited = RUN_LOG.find((r) => r.id === EDITED_ID)!;
/** What `PATCH /api/activities/[id]` sees: everything except the activity being edited. */
const windowSessions = RUN_LOG.filter((r) => r.id !== EDITED_ID);

function equivalentOf(run: LoggedRun, riegelK: number | null) {
  return computeBodyBenchmarkEquivalentSeconds(
    "run",
    {
      distance_meters: run.distanceMeters,
      duration_seconds: run.durationSeconds,
      avg_heart_rate: run.avgHR,
    },
    riegelK ?? undefined
  )!;
}

/**
 * The personalized Riegel k stored alongside the poisoned row
 * (predicted_benchmarks.riegel_k, NUMERIC(4,3)). Pinned rather than
 * recomputed so the reproduction below is the athlete's actual arithmetic.
 */
const STORED_RIEGEL_K = 1.088;

/** The prediction half of the edit route, parameterised by how it derives its blend base. */
function replayEdit(blendBase: number | null, riegelK: number = STORED_RIEGEL_K) {
  const equivalent = equivalentOf(edited, riegelK);
  return {
    equivalent,
    stored: blendPredictedBenchmark(blendBase, equivalent, {
      sessionType: edited.sessionType,
      thisSessionEF: terrainAdjustedSessionEF(
        edited.distanceMeters,
        edited.durationSeconds,
        edited.avgHR
      ),
      baselineEF: null,
      isDirectBenchmarkDistance: isDirectBenchmarkDistance(
        edited.distanceMeters,
        BENCHMARK_DISTANCE_METERS.run
      ),
    }),
  };
}

describe("editing an activity must not reset the stored 5k prediction", () => {
  it("reproduces 24:59 exactly when the blend base is nulled (the old behaviour)", () => {
    const { equivalent, stored } = replayEdit(null);
    // The bare equivalent of one easy 7.5km run, straight through as the new
    // stored prediction — 1499.3s here against the 1499.22 sitting in the live
    // row, the difference being riegel_k rounded to NUMERIC(4,3) on the way in.
    expect(stored).toBeCloseTo(equivalent, 10);
    expect(stored).toBeCloseTo(1499.22, 0);
    expect(formatRiegelPrediction(stored)).toBe("24:59");
  });

  it("rebuilds the base from the athlete's other sessions instead", () => {
    const personalizedK = personalizeRiegelKFromWindow(windowSessions, null);
    const rebuilt = replayStoredPredictionFromSessions(
      "run",
      windowSessions,
      personalizedK ?? undefined
    );
    expect(rebuilt).not.toBeNull();
    // Their 18:25 5k and 39:25 10k are in that history; the rebuilt base has
    // to look like an 18-19 minute athlete, not a 25-minute one.
    expect(rebuilt!).toBeGreaterThan(16 * 60);
    expect(rebuilt!).toBeLessThan(19.5 * 60);
  });

  it("keeps the prediction near 18:30 after the edit", () => {
    const personalizedK = personalizeRiegelKFromWindow(windowSessions, null);
    const base = replayStoredPredictionFromSessions(
      "run",
      windowSessions,
      personalizedK ?? undefined
    );
    const { stored } = replayEdit(base, personalizedK ?? undefined);
    expect(stored).toBeLessThan(19.5 * 60);
    expect(stored).toBeGreaterThan(16 * 60);
    // And specifically: re-saving an easy run cannot make the athlete slower
    // than the base it was blended into.
    expect(stored).toBeLessThanOrEqual(base! * 1.02);
  });

  it("still seeds from the session itself when there is genuinely no other history", () => {
    expect(replayStoredPredictionFromSessions("run", [], 1.08)).toBeNull();
    const { equivalent, stored } = replayEdit(
      replayStoredPredictionFromSessions("run", [], 1.08)
    );
    expect(stored).toBeCloseTo(equivalent, 10);
  });
});

describe("formatRiegelPrediction", () => {
  it("renders the stored hundredths honestly", () => {
    expect(formatRiegelPrediction(1499.22)).toBe("24:59");
    expect(formatRiegelPrediction(1105)).toBe("18:25");
  });

  it("rolls 59.5+ seconds into the next minute instead of printing :60", () => {
    expect(formatRiegelPrediction(1499.6)).toBe("25:00");
    expect(formatRiegelPrediction(3599.7)).toBe("1:00:00");
  });
});
