import { describe, expect, it } from "vitest";
import { scoreStrength } from "./split-strength-engine";
import {
  resolveConfigKey,
  getExerciseLoadConfig,
  isBodyweightOnlyExercise,
} from "./weight-entry";

/**
 * Bodyweight vs weighted are separate, distinctly-tracked exercises (user
 * feedback: "Pull Up" etc. should score off reps alone with no weight
 * input, while "Weighted Pull Up" etc. stay a separate exercise). Covers
 * all four calisthenics families: pull-up, dip, push-up, muscle-up.
 */
describe("resolveConfigKey — bodyweight vs weighted resolve to distinct keys", () => {
  it("pull-up family", () => {
    expect(resolveConfigKey("Pull Up")).toBe("pullUp");
    expect(resolveConfigKey("Chin Up")).toBe("pullUp");
    expect(resolveConfigKey("Weighted Pull Up")).toBe("weightedPullup");
    expect(resolveConfigKey("Weighted Chin Up")).toBe("weightedPullup");
  });

  it("dip family", () => {
    expect(resolveConfigKey("Dips")).toBe("dip");
    expect(resolveConfigKey("Chest Dips")).toBe("dip");
    expect(resolveConfigKey("Bench Dips")).toBe("dip");
    expect(resolveConfigKey("Ring Dip")).toBe("dip");
    expect(resolveConfigKey("Weighted Dips")).toBe("weightedDips");
    expect(resolveConfigKey("Weighted Ring Dip")).toBe("weightedDips");
  });

  it("push-up family", () => {
    expect(resolveConfigKey("Push Up")).toBe("pushUp");
    expect(resolveConfigKey("Diamond Push Up")).toBe("pushUp");
    expect(resolveConfigKey("Weighted Push Up")).toBe("weightedPushUp");
  });

  it("muscle-up family", () => {
    expect(resolveConfigKey("Muscle Up")).toBe("muscleUp");
    expect(resolveConfigKey("Bar Muscle Up")).toBe("muscleUp");
    expect(resolveConfigKey("Ring Muscle Up")).toBe("muscleUp");
    expect(resolveConfigKey("Weighted Muscle Up")).toBe("weightedMuscleUp");
  });
});

describe("isBodyweightOnlyExercise / noWeightInput", () => {
  it("is true for every plain bodyweight variant (no weight field should render)", () => {
    expect(isBodyweightOnlyExercise("Pull Up")).toBe(true);
    expect(isBodyweightOnlyExercise("Dips")).toBe(true);
    expect(isBodyweightOnlyExercise("Push Up")).toBe(true);
    expect(isBodyweightOnlyExercise("Muscle Up")).toBe(true);
  });

  it("is false for every weighted variant (weight field should render)", () => {
    expect(isBodyweightOnlyExercise("Weighted Pull Up")).toBe(false);
    expect(isBodyweightOnlyExercise("Weighted Dips")).toBe(false);
    expect(isBodyweightOnlyExercise("Weighted Push Up")).toBe(false);
    expect(isBodyweightOnlyExercise("Weighted Muscle Up")).toBe(false);
  });

  it("is false for an unrelated exercise", () => {
    expect(isBodyweightOnlyExercise("Bench Press")).toBe(false);
  });

  it("weighted variants still accept an addedLoad weight entry", () => {
    expect(getExerciseLoadConfig("Weighted Pull Up").allowedConventions).toEqual(["addedLoad"]);
    expect(getExerciseLoadConfig("Weighted Muscle Up").allowedConventions).toEqual(["addedLoad"]);
  });
});

describe("scoreStrength — bodyweight and weighted variants both score correctly and distinctly", () => {
  const BODYWEIGHT_KG = 83;

  function scoreBodyweight(liftKey: string, reps: number) {
    return scoreStrength({
      liftKey,
      history: [],
      latestSet: { weightKg: 0, reps },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 30,
      isPremium: false,
    });
  }

  function scoreWeighted(liftKey: string, addedKg: number, reps: number) {
    return scoreStrength({
      liftKey,
      history: [],
      latestSet: { weightKg: addedKg, reps },
      bodyweightKg: BODYWEIGHT_KG,
      sex: "male",
      age: 30,
      isPremium: false,
    });
  }

  for (const [bwName, weightedName] of [
    ["Pull Up", "Weighted Pull Up"],
    ["Dips", "Weighted Dips"],
    ["Push Up", "Weighted Push Up"],
    ["Muscle Up", "Weighted Muscle Up"],
  ]) {
    it(`${bwName}: bodyweight reps score meaningfully above zero and don't fall back to generic`, () => {
      const result = scoreBodyweight(bwName, 8);
      expect(result.score).toBeGreaterThan(0);
      expect(result.source).not.toBe("generic");
    });

    it(`${weightedName}: adding real weight scores higher than bodyweight-only for the same reps`, () => {
      const bw = scoreBodyweight(bwName, 8);
      const weighted = scoreWeighted(weightedName, 20, 8);
      expect(weighted.score).toBeGreaterThan(bw.score);
      expect(weighted.source).not.toBe("generic");
    });
  }

  it("Pull Up and Weighted Pull Up at 0kg added score identically (same underlying anchor, addedKg=0 either way)", () => {
    const bw = scoreBodyweight("Pull Up", 10);
    const weightedAtZero = scoreWeighted("Weighted Pull Up", 0, 10);
    expect(weightedAtZero.score).toBe(bw.score);
  });
});
