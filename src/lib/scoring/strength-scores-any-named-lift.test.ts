import { describe, expect, it } from "vitest";
import { scoreStrength } from "@/lib/scoring/split-strength-engine";

/*
 * Pins the fact that isolates one real bug from a class of imagined ones.
 *
 * THE SYMPTOM. A logged set showed "—" under Top set while Est. 1RM, × BW and
 * Volume filled in normally beside it. That reads as a broken scorer, and it
 * cost a long detour through profile data — is the athlete's sex missing, is
 * bodyweight missing, is the lift name unrecognised — before the actual cause
 * turned up.
 *
 * WHY THE OTHER THREE WORK. Est. 1RM is Epley over weight and reps. × BW is
 * that divided by the bodyweight typed into the session bar. Volume is weight
 * times reps. None of them touch the exercise name. scoreSet does, because the
 * name is what resolves the anchor table and the weight convention — so an
 * unnamed exercise fails its very first guard while everything around it
 * computes happily. That asymmetry IS the bug report.
 *
 * WHAT THESE TESTS RULE OUT. If an unknown name scored null, then "my custom
 * exercise doesn't score" would be a separate, much larger problem. It doesn't:
 * resolveLiftAnchor falls back to a generic standard and flags it, so any
 * non-empty string scores. That leaves the empty name as the only way to reach
 * a null score through this path, which is what the hint in gym-form now says.
 *
 * If a future change makes scoreStrength able to return a null or NaN score,
 * these fail, and the hint in gym-form needs a branch for whatever new case
 * that is.
 */

const SET = {
  history: [] as never[],
  latestSet: { weightKg: 35, reps: 4, repsInReserve: null },
  bodyweightKg: 79,
  sex: "male" as const,
  age: 28,
  isPremium: false,
};

describe("scoreStrength scores any non-empty lift name", () => {
  it("scores a lift it knows", () => {
    const { score } = scoreStrength({
      ...SET,
      liftKey: "weighted pull up",
      exerciseName: "weighted pull up",
    });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it("still scores a name it has never seen, via the generic standard", () => {
    // The point of the generic fallback: a custom exercise is not a reason to
    // withhold a score, it is a reason to mark the score as estimated.
    const { score } = scoreStrength({
      ...SET,
      liftKey: "zzz nonsense lift",
      exerciseName: "zzz nonsense lift",
    });
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);
  });

  it("scores the same for either sex rather than refusing one", () => {
    // resolveScoringSex never returns null — it falls back to a default — so no
    // caller should ever be guarding on a missing sex. An earlier fix did, and
    // the branch was unreachable.
    for (const sex of ["male", "female"] as const) {
      const { score } = scoreStrength({
        ...SET,
        sex,
        liftKey: "back squat",
        exerciseName: "back squat",
      });
      expect(Number.isFinite(score), `sex=${sex}`).toBe(true);
    }
  });
});
