import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";

/**
 * THE NUMBER SHOWN MUST BE THE NUMBER SCORED.
 *
 * `workPiece.equivalentPaceSecPerKm` is presented to the athlete as "Scored
 * as" — the pace the engine actually judged them on. Today that is true by
 * construction: `sessionFitnessEquivalent` is called with `input` itself, so
 * `intervalEquivalentPaceSecPerKm(input.structuredInterval)` in the readout
 * sees the same object the scorer saw. Nothing states that it must.
 *
 * A future refactor that passes a copy, a normalised session, or a rounded
 * `structuredInterval` would break the link SILENTLY. The screen would keep
 * showing a plausible pace — just not the one behind the score. That is a
 * quieter version of the fabrication problem `work-piece-is-omitted-not-faked`
 * guards: a number an athlete can check against their watch, that no longer
 * means what the label says it means.
 *
 * WHAT THIS DOES NOT DO, and why. The obvious strong form — re-score a plain
 * session at the displayed pace over the work distance and assert the two
 * fitness equivalents match — was tried and DOES NOT HOLD: 1154.6 against
 * 1182 on the fixture below, unrounded. The interval path and the plain path
 * do not reduce to each other, so asserting they do would pin a falsehood and
 * fail the first time someone touched either. Rather than weaken it into a
 * tolerance wide enough to be meaningless, this asserts the property that is
 * actually true and actually load-bearing: the displayed pace and the score
 * are driven by the same input, so they move together or the test fails.
 */

const BASE = {
  type: "run",
  benchmarkSport: "run",
  sex: "male",
  age: 30,
  distanceMeters: 6400,
  durationSeconds: 2070,
  sessionType: "interval",
} as const;

/** 8 x 400m in 84s. Only the recovery changes. */
function scoredWithRest(restSeconds: number) {
  const result = scoreCardioActivity({
    ...BASE,
    structuredInterval: { reps: 8, workDistanceMeters: 400, workSecondsPerRep: 84, restSeconds },
  } as CardioInput);
  return {
    shownPace: result.workPiece!.equivalentPaceSecPerKm,
    score: result.score,
    workPace: result.workPiece!.workPaceSecPerKm,
  };
}

describe("the displayed equivalent pace cannot drift from the score", () => {
  it("moves with the score when rest changes, and in the right direction", () => {
    const short = scoredWithRest(30);
    const long = scoredWithRest(240);

    // More recovery makes a given rep pace easier to hold, so the equivalent
    // is SLOWER (a bigger s/km) and the session is worth LESS.
    expect(long.shownPace).toBeGreaterThan(short.shownPace);
    expect(long.score).toBeLessThan(short.score);

    // The rep pace itself is untouched — only the rest moved. If this ever
    // fails, the fixture changed something it did not mean to and the
    // assertions above stop testing what they claim.
    expect(long.workPace).toBe(short.workPace);
  });

  it("tracks the score across the whole range, not just at the ends", () => {
    /*
      A readout frozen at a constant passes a two-point test if the two points
      happen to bracket it. Monotonicity across a sweep is what catches a
      readout that has come loose from the scorer: every step must move BOTH
      numbers, in opposite directions, with no ties.
    */
    const sweep = [30, 60, 90, 150, 240].map(scoredWithRest);
    for (let i = 1; i < sweep.length; i++) {
      const prev = sweep[i - 1]!;
      const next = sweep[i]!;
      expect(next.shownPace, `pace did not move between step ${i - 1} and ${i}`).toBeGreaterThan(
        prev.shownPace
      );
      expect(next.score, `score did not move between step ${i - 1} and ${i}`).toBeLessThan(prev.score);
    }
  });

  it("still reports the rep pace as the rep pace, not the equivalent", () => {
    // The two numbers sit side by side on the card under different labels.
    // A refactor that pointed both at the same source would make the readout
    // internally consistent and wrong.
    const { shownPace, workPace } = scoredWithRest(90);
    expect(workPace).toBe(210); // 84s per 400m
    expect(shownPace).toBeGreaterThan(workPace);
  });
});
