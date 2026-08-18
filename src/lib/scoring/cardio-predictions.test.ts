import { describe, expect, it } from "vitest";
import {
  updatePrediction,
  blendPredictedBenchmark,
  applyDecay,
  PREDICTION_DECAY,
  isDirectBenchmarkDistance,
  DIRECT_EVIDENCE_IMPROVE_RATE,
  REGRESS_RATE,
  computeSessionBenchmarkEquivalentSeconds,
  terrainAdjustedSessionEF,
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
 * than their usual easy effort) nudges it — originally down, now only ever
 * up.
 *
 * That last part was narrowed by a later report (see the "reported 18:22 ->
 * 18:09 bug" block at the bottom of this file): the layer's FASTER direction
 * is now floored at the session's own benchmark-equivalent, so it can only
 * spend improvement the session itself demonstrated. Its slower direction —
 * the fatigue/decline signal — is unchanged, and its faster direction still
 * applies in full on sessions whose own equivalent beats the stored value.
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

  it("beating the athlete's own easy-run baseline CANNOT improve the prediction when the session's own equivalent is slower than the stored value (superseded: this used to nudge it down)", () => {
    // The user's original example — 29:30 (1770s) at 175bpm, more efficient
    // than their usual easy effort — used to pull the stored 20:00 slightly
    // faster. A later report proved that backwards (see the dedicated
    // describe block at the bottom of this file): a session whose own
    // equivalent is 1770s is evidence AGAINST a 1200s prediction, so it may
    // not improve it. The relative-effort signal is still read, it just
    // can't outrun what the session itself demonstrated.
    const result = updatePrediction(STORED, 1770, {
      sessionType: "easy",
      thisSessionEF: 1.15,
      baselineEF: 1.1,
    });
    expect(result).toBe(STORED);
  });

  it("still nudges the prediction faster off the same beat-your-baseline signal when the session's own equivalent DOES support an improvement", () => {
    // Same relative-effort evidence, but on a session whose own equivalent
    // (1150s) is genuinely faster than the stored 1200s — here the easy-run
    // trend layer keeps its full original job, adding a little on top of the
    // IMPROVE_RATE blend.
    const EQUIV = 1150;
    const primaryOnly = updatePrediction(STORED, EQUIV);
    const withTrend = updatePrediction(STORED, EQUIV, {
      sessionType: "easy",
      thisSessionEF: 1.1 * 1.02,
      baselineEF: 1.1,
    });
    expect(withTrend).toBeLessThan(primaryOnly);
    // ...but never past the session's own equivalent, which remains the
    // fastest thing this one session is entitled to claim.
    expect(withTrend).toBeGreaterThanOrEqual(EQUIV);
  });

  it("nudges the prediction slightly slower for a below-baseline easy run — deliberate revision of the original always-improve-only design (user feedback: account for fatigue/declining fitness, not just improvement)", () => {
    const withWorseEfficiency = updatePrediction(STORED, 1800, {
      sessionType: "easy",
      thisSessionEF: 1.0, // below baseline
      baselineEF: 1.1,
    });
    expect(withWorseEfficiency).toBeGreaterThan(STORED);
    // Still deliberately tiny — capped at the same small magnitude as the improvement side.
    expect(withWorseEfficiency).toBeLessThan(STORED * 1.02 + 0.01);
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
    // Measured on a session whose own equivalent (1100s) leaves room to
    // improve, so the cap — not the directional floor — is what's under test.
    const extreme = updatePrediction(STORED, 1100, {
      sessionType: "easy",
      thisSessionEF: 5.0,
      baselineEF: 1.1,
    });
    const atCapBoundary = updatePrediction(STORED, 1100, {
      sessionType: "easy",
      // A ratio chosen so (ratio - 1) * 0.3 already exceeds the 2% cap.
      thisSessionEF: 1.1 * 1.2,
      baselineEF: 1.1,
    });
    expect(extreme).toBe(atCapBoundary);
    const primaryOnly = updatePrediction(STORED, 1100);
    expect(extreme).toBeGreaterThanOrEqual(primaryOnly * 0.98 - 0.01);
  });

  it("layers as a small additional adjustment even when the session already clears the absolute IMPROVE_RATE/REGRESS_RATE gates (user feedback: keep the prediction visibly alive between quality efforts, including when two identical quality efforts would otherwise produce a literal zero-delta update)", () => {
    // Genuinely faster absolute equivalent (900s) already triggers IMPROVE_RATE,
    // and the easy-run trend nudge now layers on top of that primary result
    // rather than only ever being reachable as a last-resort fallback.
    const withWorseTrend = updatePrediction(STORED, 900, {
      sessionType: "easy",
      thisSessionEF: 1.0,
      baselineEF: 1.5, // reads as a declining trend on top of the fast absolute time
    });
    const withoutContext = updatePrediction(STORED, 900);
    expect(withWorseTrend).toBeGreaterThan(withoutContext);
    // Still a small layer on top of the primary IMPROVE_RATE result, not a
    // wholesale reversal of the genuine faster-time evidence.
    expect(withWorseTrend).toBeLessThan(STORED);
  });

  it("blendPredictedBenchmark threads context through the same way", () => {
    const result = blendPredictedBenchmark(STORED, 1150, {
      sessionType: "easy",
      thisSessionEF: 1.1 * 1.02,
      baselineEF: 1.1,
    });
    expect(result).toBeLessThan(updatePrediction(STORED, 1150));
    expect(result).toBeGreaterThan(STORED * 0.9);
  });

  it("blendPredictedBenchmark carries the same directional floor — a slower session can't be talked into an improvement", () => {
    const result = blendPredictedBenchmark(STORED, 1770, {
      sessionType: "easy",
      thisSessionEF: 1.15,
      baselineEF: 1.1,
    });
    expect(result).toBe(STORED);
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

  it("two identical direct-race efforts still produce a literal zero-delta update on their own — this is mathematically inevitable for a point-estimate blend, not a rate-tuning bug (user feedback: a repeat 18:25 5k left the prediction frozen at 18:25)", () => {
    const direct = isDirectBenchmarkDistance(5000, BENCHMARK_DISTANCE_METERS.run);
    const afterFirstRace = updatePrediction(STORED, RACED, { sessionType: "race", isDirectBenchmarkDistance: direct });
    expect(afterFirstRace).toBe(RACED);
    // Second race exactly matches the now-stored prediction -> zero delta -> unchanged by the primary blend alone.
    const afterSecondRace = updatePrediction(afterFirstRace, RACED, { sessionType: "race", isDirectBenchmarkDistance: direct });
    expect(afterSecondRace).toBe(RACED);
  });

  it("differing easy-run trend context on an otherwise-identical direct-race repeat DOES produce a small amount of movement — the widened easy-run trend layer is the mechanism that can move a prediction the primary evidence-based blend cannot", () => {
    const direct = isDirectBenchmarkDistance(5000, BENCHMARK_DISTANCE_METERS.run);
    const afterFirstRace = updatePrediction(STORED, RACED, { sessionType: "race", isDirectBenchmarkDistance: direct });
    // The repeat evidence itself is still a "race" (trend layer doesn't apply to race sessions,
    // by design — comparing a maximal race effort's own EF to an easy-effort baseline isn't a
    // meaningful comparison). This demonstrates the layer's actual, currently-safe reach: an
    // easy/recovery/long session logged around the same time can still move the number even
    // when the headline race number hasn't, addressing the literal "recent recovery and easy
    // runs" part of the ask. A full fix for two literally-identical RACE repeats needs separate,
    // date-ordered trend-tracking plumbing not implemented here (see cardio-predictions.ts's
    // updatePrediction doc comment).
    //
    // The direction it can move in is now bounded by the easy run's own
    // equivalent (fastestJustifiableBySession): a 400s-slower easy run can
    // report a bad day, never a new PR.
    const belowBaselineEasyRun = updatePrediction(afterFirstRace, afterFirstRace + 400, {
      sessionType: "easy",
      thisSessionEF: 1.0,
      baselineEF: 1.1,
    });
    expect(belowBaselineEasyRun).toBeGreaterThan(afterFirstRace);

    const aboveBaselineEasyRun = updatePrediction(afterFirstRace, afterFirstRace + 400, {
      sessionType: "easy",
      thisSessionEF: 1.15,
      baselineEF: 1.1,
    });
    expect(aboveBaselineEasyRun).toBe(afterFirstRace);
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

/**
 * User-reported bug, in the athlete's own words: "I did a run which stated I
 * could run this pace for a 5km at 19:41, yet my 5km predicted time on the
 * dashboard went from 18:22 to 18:09. Why has it gone down so much for an
 * easy run that wasn't that great? This should either have stayed the same
 * or gone up."
 *
 * They were right. 19:41 (1181s) is WORSE than the standing 18:22 (1102s)
 * prediction, so it is evidence against improvement. The primary blend had
 * it right — 1181 sits just inside QUALITY_PROXIMITY of 1102, so REGRESS_RATE
 * moved the number the correct way, to ~18:34 — but `easyTrendNudge` then
 * out-voted it: the run WAS efficient against this athlete's own easy
 * baseline (low HR for the pace), and that relative-effort reading was being
 * spent as up to 2% (~22s) off a RACE prediction. An efficient easy run is
 * weak evidence about 5k race pace and must never outrun the session's own
 * equivalent.
 *
 * The rule enforced here: a session can never move the stored prediction
 * FASTER than that session's own benchmark-equivalent.
 */
describe("updatePrediction — an easy run can never improve the prediction past its own equivalent (reported 18:22 -> 18:09 bug)", () => {
  const PRIOR = 18 * 60 + 22; // 1102s — the standing prediction on the dashboard
  const SESSION_EQUIVALENT = 19 * 60 + 41; // 1181s — this run's own 5k-equivalent

  it("reproduces the reported inputs and never lands below the prior", () => {
    const result = updatePrediction(PRIOR, SESSION_EQUIVALENT, {
      sessionType: "easy",
      // Efficient relative to this athlete's own easy baseline — the exact
      // signal that used to buy a faster race prediction.
      thisSessionEF: 1.5134,
      baselineEF: 1.45,
    });
    // "This should either have stayed the same or gone up" — and it does.
    expect(result).toBeGreaterThanOrEqual(PRIOR);
    // The number the athlete actually saw is now unreachable.
    expect(Math.round(result)).not.toBe(18 * 60 + 9);
    // The window of honest answers runs from "unchanged" to the full
    // REGRESS_RATE move (~18:34). Here the flattering relative-effort
    // reading is still counted — it just gets spent cancelling part of the
    // regression instead of buying a faster race time, and lands on the
    // floor.
    expect(result).toBeLessThanOrEqual(PRIOR + (SESSION_EQUIVALENT - PRIOR) * REGRESS_RATE);
    expect(result).toBe(PRIOR);
  });

  it("holds through the real session pipeline — a 10km easy run at 150bpm whose 5k-equivalent is 19:41", () => {
    const distanceMeters = 10_000;
    const durationSeconds = 2643; // ~4:24/km
    const avgHR = 150;
    const equivalent = computeSessionBenchmarkEquivalentSeconds(
      "run",
      distanceMeters,
      durationSeconds,
      avgHR
    )!;
    expect(Math.round(equivalent)).toBe(19 * 60 + 41); // the 19:41 the athlete was shown
    expect(equivalent).toBeGreaterThan(PRIOR); // ...which is slower than the standing prediction

    const result = blendPredictedBenchmark(PRIOR, equivalent, {
      sessionType: "easy",
      thisSessionEF: terrainAdjustedSessionEF(distanceMeters, durationSeconds, avgHR),
      baselineEF: 1.45,
      isDirectBenchmarkDistance: isDirectBenchmarkDistance(
        distanceMeters,
        BENCHMARK_DISTANCE_METERS.run
      ),
    });
    expect(result).toBeGreaterThanOrEqual(PRIOR);
  });

  it("no relative-effort context, however flattering, can pull any session below its own equivalent", () => {
    // Fuzz the seam directly: across a spread of priors, equivalents and
    // efficiency ratios, the result never beats min(prior, equivalent).
    for (const prior of [900, 1102, 1200, 1800]) {
      for (const equivalent of [600, 950, 1102, 1181, 1400, 2400]) {
        for (const efRatio of [0.5, 0.9, 1, 1.05, 1.5, 5]) {
          for (const sessionType of ["easy", "recovery", "long", "race", "tempo"] as const) {
            const result = updatePrediction(prior, equivalent, {
              sessionType,
              thisSessionEF: 1.2 * efRatio,
              baselineEF: 1.2,
              isDirectBenchmarkDistance: isDirectBenchmarkDistance(5000, BENCHMARK_DISTANCE_METERS.run),
            });
            expect(result).toBeGreaterThanOrEqual(Math.min(prior, equivalent) - 1e-9);
          }
        }
      }
    }
  });

  it("leaves the slower direction alone — a below-baseline easy run still reports declining fitness", () => {
    const result = updatePrediction(PRIOR, SESSION_EQUIVALENT, {
      sessionType: "easy",
      thisSessionEF: 1.3,
      baselineEF: 1.45,
    });
    expect(result).toBeGreaterThan(PRIOR + (SESSION_EQUIVALENT - PRIOR) * REGRESS_RATE);
  });
});
