import { describe, expect, it } from "vitest";
import {
  updatePrediction,
  blendPredictedBenchmark,
  applyDecay,
  PREDICTION_DECAY,
  isDirectBenchmarkDistance,
  DIRECT_EVIDENCE_IMPROVE_RATE,
} from "./cardio-predictions";
import { BENCHMARK_DISTANCE_METERS } from "./cardio-benchmarks";

/**
 * Relative-trend evidence for Tier 2 (user feedback): an easy/recovery/long
 * session whose own equivalent is nowhere near the stored prediction (far
 * outside the absolute QUALITY_PROXIMITY gate) still isn't nothing — if it
 * beat the athlete's own recent easy-effort baseline, that's a small,
 * indirect signal of improvement, distinct from and much weaker than an
 * outright faster absolute time (IMPROVE_RATE). Reproduces the user's own
 * example: previous best 20:00 (1200s); a 30:00 easy run at 180bpm doesn't
 * move the prediction; a 29:30 easy run at 175bpm (genuinely more efficient
 * than their usual easy effort) nudges it down slightly.
 */
describe("updatePrediction / blendPredictedBenchmark — relative-trend evidence", () => {
  const STORED = 1200; // 20:00 5k

  it("without context, a far-off easy run leaves the prediction unchanged (existing behavior preserved)", () => {
    // 30:00 (1800s) is nowhere close to 1200s -> outside QUALITY_PROXIMITY, no context -> unchanged.
    expect(updatePrediction(STORED, 1800)).toBe(STORED);
  });

  it("at exactly the athlete's own easy-run baseline, the prediction still doesn't move", () => {
    const result = updatePrediction(STORED, 1800, {
      sessionType: "easy",
      thisSessionEF: 1.1, // exactly at baseline -> ratio 1.0, no improvement signal
      baselineEF: 1.1,
    });
    expect(result).toBe(STORED);
  });

  it("beating the athlete's own easy-run baseline nudges the prediction down slightly, never anywhere near the session's raw (far-off) absolute time", () => {
    // Reproduces the user's example: 29:30 (1770s) at 175bpm reads as
    // genuinely more efficient than their usual easy effort (baselineEF
    // lower than this session's own EF).
    const result = updatePrediction(STORED, 1770, {
      sessionType: "easy",
      thisSessionEF: 1.15,
      baselineEF: 1.1,
    });
    expect(result).toBeLessThan(STORED);
    // Deliberately tiny — nowhere near blending toward the 1770s absolute time.
    expect(result).toBeGreaterThan(STORED * 0.98);
  });

  it("never penalizes a below-baseline easy run beyond what the absolute gate already does", () => {
    const withWorseEfficiency = updatePrediction(STORED, 1800, {
      sessionType: "easy",
      thisSessionEF: 1.0, // below baseline
      baselineEF: 1.1,
    });
    expect(withWorseEfficiency).toBe(STORED);
  });

  it("only applies to easy/recovery/long session types, not race/tempo/threshold", () => {
    const result = updatePrediction(STORED, 1770, {
      sessionType: "race",
      thisSessionEF: 1.15,
      baselineEF: 1.1,
    });
    expect(result).toBe(STORED);
  });

  it("caps the nudge regardless of how large the efficiency ratio is", () => {
    const extreme = updatePrediction(STORED, 1800, {
      sessionType: "easy",
      thisSessionEF: 5.0,
      baselineEF: 1.1,
    });
    const atCapBoundary = updatePrediction(STORED, 1800, {
      sessionType: "easy",
      // A ratio chosen so (ratio - 1) * 0.3 already exceeds the 2% cap.
      thisSessionEF: 1.1 * 1.2,
      baselineEF: 1.1,
    });
    expect(extreme).toBe(atCapBoundary);
    expect(extreme).toBeGreaterThanOrEqual(STORED * 0.98 - 0.01);
  });

  it("has no effect when the session already clears the absolute IMPROVE_RATE/REGRESS_RATE gates", () => {
    // Genuinely faster absolute equivalent (900s) already triggers IMPROVE_RATE
    // regardless of context.
    const withContext = updatePrediction(STORED, 900, {
      sessionType: "easy",
      thisSessionEF: 1.0,
      baselineEF: 1.5, // would look like a big regression if the trend nudge applied
    });
    const withoutContext = updatePrediction(STORED, 900);
    expect(withContext).toBe(withoutContext);
  });

  it("blendPredictedBenchmark threads context through the same way", () => {
    const result = blendPredictedBenchmark(STORED, 1770, {
      sessionType: "easy",
      thisSessionEF: 1.15,
      baselineEF: 1.1,
    });
    expect(result).toBeLessThan(STORED);
    expect(result).toBeGreaterThan(STORED * 0.98);
  });

  it("blendPredictedBenchmark seeds the prediction on the first-ever session regardless of context", () => {
    expect(blendPredictedBenchmark(null, 1200, { sessionType: "easy" })).toBe(1200);
  });
});

/**
 * Direct race-distance evidence (user feedback): "i ran an 18:25 time 5km
 * and it shows my 5km prediction is 18:33 why?" Root cause: the ordinary
 * IMPROVE_RATE=0.55 blend treated a genuine at-distance race exactly like
 * an inferred/projected result, only pulling 55% of the way from the prior
 * stored prediction (~18:42) toward the demonstrated 18:25. A race run at
 * the benchmark distance itself is direct, non-extrapolated proof — the
 * prediction for that distance should become that time, not a blend
 * toward it.
 */
describe("updatePrediction — direct race-distance evidence snaps fully, not the 55% blend", () => {
  const STORED = 18 * 60 + 42; // 18:42 prior prediction
  const RACED = 18 * 60 + 25; // 18:25 actual race result

  it("reproduces the reported bug without the direct-evidence context (ordinary 55% blend)", () => {
    const result = updatePrediction(STORED, RACED);
    expect(Math.round(result)).toBe(18 * 60 + 33); // 18:33 — the reported symptom
  });

  it("snaps directly to the demonstrated time when raced at the benchmark distance", () => {
    const direct = isDirectBenchmarkDistance(5000, BENCHMARK_DISTANCE_METERS.run);
    expect(direct).toBe(true);
    const result = updatePrediction(STORED, RACED, { sessionType: "race", isDirectBenchmarkDistance: direct });
    expect(result).toBe(RACED);
  });

  it("isDirectBenchmarkDistance tolerates small GPS/course measurement noise but not a genuinely different distance", () => {
    expect(isDirectBenchmarkDistance(5000, 5000)).toBe(true);
    expect(isDirectBenchmarkDistance(5100, 5000)).toBe(true); // 2% off, within tolerance
    expect(isDirectBenchmarkDistance(4800, 5000)).toBe(true); // 4% off, within tolerance
    expect(isDirectBenchmarkDistance(8000, 5000)).toBe(false); // a genuinely different distance
    expect(isDirectBenchmarkDistance(0, 5000)).toBe(false);
  });

  it("does not snap for a hard-effort session tagged something other than 'race', even at the exact benchmark distance", () => {
    const direct = isDirectBenchmarkDistance(5000, BENCHMARK_DISTANCE_METERS.run);
    const result = updatePrediction(STORED, RACED, { sessionType: "tempo", isDirectBenchmarkDistance: direct });
    expect(result).not.toBe(RACED);
    expect(result).toBeCloseTo(STORED + (RACED - STORED) * 0.55, 1);
  });

  it("does not snap when the session's own distance isn't actually close to the benchmark distance, even if tagged 'race'", () => {
    const notDirect = isDirectBenchmarkDistance(10000, BENCHMARK_DISTANCE_METERS.run);
    expect(notDirect).toBe(false);
    const result = updatePrediction(STORED, RACED, { sessionType: "race", isDirectBenchmarkDistance: notDirect });
    expect(result).toBeCloseTo(STORED + (RACED - STORED) * 0.55, 1);
  });

  it("DIRECT_EVIDENCE_IMPROVE_RATE is a full 1.0 snap, distinct from IMPROVE_RATE's 55% blend", () => {
    expect(DIRECT_EVIDENCE_IMPROVE_RATE).toBe(1.0);
  });
});

/**
 * Time-based decay ceilings (user feedback: "someone who ran a 20:00 5k a
 * year ago is likely not to be able to run a 20:00 5k now" — the old single
 * 15% ceiling applied equally to total inactivity and to "still running,
 * just hasn't tested near capability lately," which was too gentle for
 * genuine months-long inactivity). Total inactivity now has a much higher
 * ceiling (35%) than merely lacking a recent quality effort (15%, unchanged).
 */
describe("applyDecay — inactivity vs. no-recent-quality ceilings", () => {
  const STORED = 1200; // 20:00 5k

  it("a full year of total inactivity decays close to the higher (35%) ceiling, not the old 15% one", () => {
    const decayed = applyDecay(STORED, 365, 365);
    expect(decayed).toBeGreaterThan(STORED * 1.3);
    expect(decayed).toBeLessThanOrEqual(STORED * (1 + PREDICTION_DECAY.maxDecayInactive));
  });

  it("still running (recent activity) but no quality effort in a while stays at the gentler (15%) ceiling", () => {
    const decayed = applyDecay(STORED, 5, 365); // ran 5 days ago, but no quality effort in a year
    expect(decayed).toBeLessThanOrEqual(STORED * (1 + PREDICTION_DECAY.maxDecayNoQuality));
    expect(decayed).toBeGreaterThan(STORED); // still decays some, just capped lower
  });

  it("within the grace period, there's no decay at all", () => {
    expect(applyDecay(STORED, 5, 5)).toBe(STORED);
  });
});
