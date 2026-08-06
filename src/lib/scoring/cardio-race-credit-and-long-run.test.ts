import { describe, expect, it } from "vitest";
import { scoreCardioActivity, longRunDistanceCredit, type CardioInput } from "./cardio-activity";

/**
 * Second round of follow-up feedback on the same real account (18:25 5K
 * PR): "for heart rate credit on fast runs it isn't possible to get an
 * average of your max heart rate... if you have just done a 5km at 3:50
 * 188bpm average it is unlikely for you to run an 18:50 next time but
 * maybe a 19:00... the easy runs needs to be the main focus especially the
 * long easy runs, the scoring does still not account for the fact that the
 * longer you run, the harder it is at any split, therefore these should be
 * scoring higher for the further distance."
 *
 * Two changes:
 * 1. Race-tagged sessions no longer get the population HR-adjustment
 *    credit at all — a sustained race effort's AVERAGE heart rate is
 *    always well below true instantaneous max by construction (HR ramps
 *    over minutes), so treating that gap as unused reserve over-claims a
 *    faster time than the athlete just proved they could run. Tempo/
 *    threshold/interval/fartlek sessions are unaffected — those genuinely
 *    are sub-ceiling efforts and the credit there is real (see
 *    cardio-tempo-and-personalization.test.ts).
 * 2. A new bonus-only "long-run distance credit" (longRunDistanceCredit)
 *    rewards easy/recovery/long-tagged sessions for sheer distance/
 *    duration, since sustaining the same pace/HR for longer is objectively
 *    harder and previously wasn't reflected in the primary score/
 *    predictions at all (only in the separate executionScore metric).
 */
describe("race-tagged sessions no longer get extrapolated faster via HR credit", () => {
  const profile = {
    sex: "male" as const,
    age: 18,
    maxHR: 206,
    experience: "intermediate" as const,
  };

  it("predicts a race's own actual time, not a faster one, regardless of avgHR", () => {
    for (const [durationSeconds, avgHR] of [
      [1105, 192],
      [1151, 188],
      [1160, 188],
    ] as const) {
      const result = scoreCardioActivity({
        type: "run",
        benchmarkSport: "run",
        distanceMeters: 5000,
        durationSeconds,
        ...profile,
        avgHR,
        sessionType: "race",
      });
      expect(result.predictions!["5000"]).toBeCloseTo(durationSeconds, 0);
    }
  });

  it("still lets a real endurance-adjacent Riegel k or other legitimate factors move the number — this only removes the HR-based extrapolation", () => {
    // Sanity: without a sessionType at all (untagged), the population HR
    // credit still applies as before — this change is race-tag-specific,
    // not a blanket removal of the mechanism.
    const untagged = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1151,
      ...profile,
      avgHR: 188,
    });
    const tagged = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1151,
      ...profile,
      avgHR: 188,
      sessionType: "race",
    });
    expect(untagged.predictions!["5000"]).toBeLessThan(tagged.predictions!["5000"]);
  });
});

describe("long-run distance credit for easy/recovery/long-tagged sessions", () => {
  const profile = {
    sex: "male" as const,
    age: 18,
    maxHR: 206,
    experience: "intermediate" as const,
  };

  function easyRun(distanceKm: number, sessionType: CardioInput["sessionType"] = "easy"): CardioInput {
    const paceSecPerKm = 330; // constant 5:30/km
    return {
      type: "run",
      benchmarkSport: "run",
      distanceMeters: distanceKm * 1000,
      durationSeconds: distanceKm * paceSecPerKm,
      ...profile,
      avgHR: 155,
      sessionType,
    };
  }

  it("scores a longer easy run higher than a shorter one at the identical pace and HR", () => {
    const distances = [8, 12.52, 15, 18, 21.0975, 25, 32];
    let previousScore = -Infinity;
    let previousFiveK = Infinity;
    for (const km of distances) {
      const result = scoreCardioActivity(easyRun(km, km > 15 ? "long" : "easy"));
      expect(result.score).toBeGreaterThan(previousScore);
      expect(result.predictions!["5000"]).toBeLessThan(previousFiveK);
      previousScore = result.score;
      previousFiveK = result.predictions!["5000"];
    }
  });

  it("never applies to race/tempo sessions — those measure absolute pace capability, not endurance volume", () => {
    const easy = scoreCardioActivity(easyRun(21.0975, "long"));
    const raceAtSamePaceAndHR = scoreCardioActivity(easyRun(21.0975, "race"));
    // The long-run credit only applies to the relative-effort session
    // types; a race-tagged effort at the identical pace/HR/distance should
    // score lower (no distance credit, and no HR credit either per the
    // fix above — pure raw Riegel projection).
    expect(easy.score).toBeGreaterThan(raceAtSamePaceAndHR.score);
  });

  it("saturates — the credit itself approaches its cap rather than growing without bound", () => {
    const marathonCredit = longRunDistanceCredit(42.195 * 330); // ~3h52m
    const ultraCredit = longRunDistanceCredit(80 * 330); // ~7h20m
    expect(marathonCredit).toBeLessThan(0.18);
    expect(ultraCredit).toBeLessThan(0.18);
    // Both are well past the half-saturation point (75 min) — doubling the
    // duration again barely moves the credit, unlike the near-linear growth
    // at short durations.
    expect(ultraCredit - marathonCredit).toBeLessThan(0.02);
  });

  it("doesn't apply to a session that looks like a mistagged hard effort", () => {
    const mistagged = scoreCardioActivity({
      type: "run",
      benchmarkSport: "run",
      distanceMeters: 5000,
      durationSeconds: 1160, // 19:20 — essentially race pace
      ...profile,
      avgHR: 188,
      sessionType: "easy",
      recentHardEffortBenchmarkSeconds: 1105, // this athlete's real 18:25 PR
    });
    expect(mistagged.flags).toContain("easy-tag-pace-mismatch");
  });
});
