import { describe, expect, it } from "vitest";
import { scoreStrength } from "./split-strength-engine";

/**
 * BODYWEIGHT SETS USED TO SCORE 1, WHICH IS THE SAME AS NOT TRAINING.
 *
 * Pull-ups, dips and push-ups are scored on ADDED load, and added load goes to
 * zero as the set approaches a single bodyweight rep. The log curve dives, the
 * clamp catches everything, and a whole band of real beginner ability landed on
 * the same number. Measured before the floor, 80kg male, no added weight:
 *
 *     pull-up x1..x4    1 1 1 1        push-up x1..x5   1 1 1 1 1
 *
 * A single pull-up was worse than that: added load of exactly 0 tripped the
 * `no-valid-set` guard meant for sets with no load logged, so the rep was
 * recorded as an absence.
 *
 * These tests pin the shape rather than the exact numbers where the number is
 * a calibration choice, and pin the numbers where a regression would be
 * invisible otherwise.
 */

const MALE = { bodyweightKg: 80, sex: "male" as const, age: 30, isPremium: true, history: [] };

function bodyweightSet(liftKey: string, reps: number, addedKg = 0) {
  return scoreStrength({ ...MALE, liftKey, latestSet: { weightKg: addedKg, reps } });
}

describe.each(["Pull-up", "Push-up", "Dip"])("%s at bodyweight", (lift) => {
  it("is a set, not an absence", () => {
    const single = bodyweightSet(lift, 1);
    expect(single.flags).not.toContain("no-valid-set");
    expect(single.score).toBeGreaterThan(1);
  });

  it("scores every rep count differently, so progress is visible", () => {
    // The failure this replaces: reps 1 through 4 or 5 were all exactly 1, so
    // an athlete going from one rep to five saw no movement at all.
    const scores = [1, 2, 3, 4, 5, 6, 7, 8].map((reps) => bodyweightSet(lift, reps).score);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThan(scores[i - 1]!);
    }
    expect(new Set(scores).size).toBe(scores.length);
  });

  it("joins the main curve without a step", () => {
    // The floor only replaces scores below 120; the join must not be a jump.
    const below = bodyweightSet(lift, 5).score;
    const above = bodyweightSet(lift, 6).score;
    expect(below).toBeLessThanOrEqual(120);
    expect(above).toBeGreaterThan(below);
  });
});

describe("the floor is a floor, not a recalibration", () => {
  it("leaves weighted work exactly where it was", () => {
    // Above the floor nothing may change: these are the numbers the engine
    // produced before it existed.
    expect(bodyweightSet("Pull-up", 3, 20).score).toBe(492);
    expect(bodyweightSet("Pull-up", 3, 40).score).toBe(717);
    expect(bodyweightSet("Pull-up", 3, 60).score).toBe(857);
  });

  it("never lets a bodyweight-only set reach a serious tier", () => {
    // Ten strict pull-ups is a real achievement and should score like one; one
    // pull-up must not.
    expect(bodyweightSet("Pull-up", 1).tier).toBe("Beginner");
    expect(bodyweightSet("Pull-up", 1).score).toBeLessThan(120);
  });

  it("keeps a pull-up above a push-up at the same rep count", () => {
    // Inside the floor band the ordering comes from the bodyweight fraction the
    // movement carries — a pull-up hangs all of it, a push-up 0.64 of it.
    for (const reps of [1, 2, 3]) {
      expect(bodyweightSet("Pull-up", reps).score).toBeGreaterThan(
        bodyweightSet("Push-up", reps).score
      );
    }
  });
});

describe("a set with nothing in it is still nothing", () => {
  it("does not invent a score for zero reps", () => {
    const empty = scoreStrength({ ...MALE, liftKey: "Pull-up", latestSet: { weightKg: 0, reps: 0 } });
    expect(empty.flags).toContain("no-valid-set");
    expect(empty.score).toBe(1);
  });

  it("does not invent a score without a bodyweight to compare against", () => {
    const noBw = scoreStrength({
      ...MALE,
      bodyweightKg: 0,
      liftKey: "Pull-up",
      latestSet: { weightKg: 0, reps: 5 },
    });
    expect(noBw.flags).toContain("no-valid-set");
  });
});
