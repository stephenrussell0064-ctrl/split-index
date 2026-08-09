import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * User feedback (Slice 2): two athletes at similar pace/HR on an easy run
 * but very different demonstrated 5K ceilings (18:25 vs 21:00) shouldn't
 * score identically. A prior attempt at this exact idea (floor
 * `sessionEquivalentSeconds` at the athlete's own best pace) was tried and
 * reverted — user feedback: "i dont want a ceiling in place, i want the
 * natural credit reduced slightly on every run" — because a hard floor made
 * different sessions converge on the identical number whenever they hit it.
 *
 * This mechanism is instead a single, athlete-constant scale factor derived
 * only from `storedPredictionSeconds` (never from this session's own pace),
 * so it can't change the ordering between two sessions from the SAME
 * athlete — only shift the baseline between two DIFFERENT athletes. See
 * CEILING_FITNESS_BONUS_MAX's doc comment in cardio-activity.ts.
 */
describe("scoreCardioActivity — ceiling-aware fitness bonus", () => {
  // 7.5km at 5:20/km, 162bpm, no HR-zone/EF-baseline data — the identical
  // easy-run inputs from the reported real-world example, deliberately
  // without maxHR/restingHR/easyEffortBaselineEF so the plain population
  // branch scores it and the ceiling bonus is the only thing varying.
  const easyRun: Omit<CardioInput, "storedPredictionSeconds"> = {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 7500,
    durationSeconds: 2400,
    sex: "male",
    age: 30,
    avgHR: 162,
    sessionType: "easy",
  };

  it("gives a faster-ceiling athlete more relative-effort credit than a slower-ceiling athlete at the identical pace/HR", () => {
    const fasterCeiling = scoreCardioActivity({ ...easyRun, storedPredictionSeconds: 1105 }); // ~18:25 5K
    const slowerCeiling = scoreCardioActivity({ ...easyRun, storedPredictionSeconds: 1260 }); // ~21:00 5K

    expect(fasterCeiling.flags).toContain("ceiling-fitness-bonus");
    expect(slowerCeiling.flags).toContain("ceiling-fitness-bonus");
    expect(fasterCeiling.score).toBeGreaterThan(slowerCeiling.score);
  });

  it("applies no bonus (and no score change) when the ceiling is at or below the population median", () => {
    const withoutCeiling = scoreCardioActivity(easyRun);
    const medianCeiling = scoreCardioActivity({ ...easyRun, storedPredictionSeconds: 1800 }); // ~30:00, population median

    expect(medianCeiling.flags).not.toContain("ceiling-fitness-bonus");
    expect(medianCeiling.score).toBe(withoutCeiling.score);
  });

  it("never applies to race/tempo/threshold sessions, however fast the ceiling", () => {
    const asRace = scoreCardioActivity({
      ...easyRun,
      sessionType: "race",
      storedPredictionSeconds: 1105,
    });
    const asRaceNoMemory = scoreCardioActivity({ ...easyRun, sessionType: "race" });

    expect(asRace.flags).not.toContain("ceiling-fitness-bonus");
    expect(asRace.score).toBe(asRaceNoMemory.score);
  });

  it("preserves monotonicity for the same athlete's own sessions with the bonus active", () => {
    const faster = scoreCardioActivity({
      ...easyRun,
      durationSeconds: 2350,
      storedPredictionSeconds: 1105,
    });
    const slower = scoreCardioActivity({
      ...easyRun,
      durationSeconds: 2450,
      storedPredictionSeconds: 1105,
    });
    expect(faster.score).toBeGreaterThanOrEqual(slower.score);
  });

  it("caps the bonus for an extremely fast ceiling instead of scaling it unbounded", () => {
    const atSaturation = scoreCardioActivity({ ...easyRun, storedPredictionSeconds: 1020 }); // 17:00, the saturation anchor
    const wellBeyondSaturation = scoreCardioActivity({ ...easyRun, storedPredictionSeconds: 780 }); // implausibly fast

    expect(atSaturation.score).toBe(wellBeyondSaturation.score);
  });
});
