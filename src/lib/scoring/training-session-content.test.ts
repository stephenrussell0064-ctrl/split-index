import { describe, expect, it } from "vitest";
import {
  movementPatternForExercise,
  strengthPhaseFromGap,
  mainLiftPrescription,
  dupVariantLabel,
  pickAccessories,
  cardioEmphasisFromGap,
  cardioSessionTypes,
  sessionContentForInstance,
} from "./training-session-content";
import type { RankedGoal } from "./training-plan";

describe("movementPatternForExercise", () => {
  it("maps chest/shoulder/triceps lifts to push", () => {
    expect(movementPatternForExercise("Bench Press")).toBe("push");
    expect(movementPatternForExercise("Overhead Press")).toBe("push");
  });

  it("maps back lifts to pull", () => {
    expect(movementPatternForExercise("Deadlift")).toBe("pull");
    expect(movementPatternForExercise("Barbell Row")).toBe("pull");
  });

  it("maps leg lifts to legs", () => {
    expect(movementPatternForExercise("Squat")).toBe("legs");
  });

  it("returns null for an unrecognized name", () => {
    expect(movementPatternForExercise("Made Up Exercise Name")).toBeNull();
  });
});

describe("strengthPhaseFromGap", () => {
  it("returns build when far from target", () => {
    expect(strengthPhaseFromGap(0.3)).toBe("build");
  });
  it("returns strength for a moderate gap", () => {
    expect(strengthPhaseFromGap(0.12)).toBe("strength");
  });
  it("returns peak when close to target", () => {
    expect(strengthPhaseFromGap(0.05)).toBe("peak");
  });
});

describe("mainLiftPrescription / dupVariantLabel", () => {
  it("returns the phase's own prescription for a single weekly session (no undulation needed)", () => {
    expect(mainLiftPrescription("strength", 0, 1)).toEqual({ sets: 5, reps: "4-6", intensity: "~80-85% 1RM" });
    expect(dupVariantLabel(0, 1)).toBeNull();
  });

  it("alternates heavier and lighter prescriptions across repeat weekly sessions of the same lift", () => {
    const heavy = mainLiftPrescription("strength", 0, 2);
    const volume = mainLiftPrescription("strength", 1, 2);
    expect(heavy).not.toEqual(volume);
    expect(dupVariantLabel(0, 2)).toBe("Heavy day");
    expect(dupVariantLabel(1, 2)).toBe("Volume day");
    // Heavy variant should use fewer reps than the volume variant.
    const heavyReps = Number(heavy.reps.split("-")[0]);
    const volumeReps = Number(volume.reps.split("-")[0]);
    expect(heavyReps).toBeLessThan(volumeReps);
  });
});

describe("pickAccessories", () => {
  it("pulls one accessory per synergist muscle for a push lift, not the same muscle repeated", () => {
    const picks = pickAccessories("Bench Press", "build", new Set());
    expect(picks.length).toBeGreaterThan(1);
    const muscles = picks.map((p) => p.muscle);
    expect(new Set(muscles).size).toBe(muscles.length); // no duplicate muscle group
    expect(muscles.every((m) => ["Chest", "Shoulders", "Triceps"].includes(m))).toBe(true);
  });

  it("never recommends the main lift itself as an accessory", () => {
    const picks = pickAccessories("Bench Press", "build", new Set());
    expect(picks.some((p) => p.name === "Bench Press")).toBe(false);
  });

  it("excludes exercises that are already someone's own explicit goal elsewhere in the plan", () => {
    const withoutExclusion = pickAccessories("Bench Press", "build", new Set());
    const someExerciseName = withoutExclusion[0]?.name;
    expect(someExerciseName).toBeTruthy();
    const withExclusion = pickAccessories("Bench Press", "build", new Set([someExerciseName!]));
    expect(withExclusion.some((p) => p.name === someExerciseName)).toBe(false);
  });

  it("returns nothing for an unrecognized exercise rather than throwing", () => {
    expect(pickAccessories("Not A Real Lift", "build", new Set())).toEqual([]);
  });
});

describe("cardioEmphasisFromGap", () => {
  it("emphasizes aerobic base when far from target", () => {
    expect(cardioEmphasisFromGap(0.3)).toBe("aerobic-base");
  });
  it("emphasizes specificity when close to target", () => {
    expect(cardioEmphasisFromGap(0.05)).toBe("specificity");
  });
});

describe("cardioSessionTypes", () => {
  it("never repeats the identical session type for 2+ sessions a week", () => {
    for (const count of [2, 3, 4, 5]) {
      const types = cardioSessionTypes(count, "aerobic-base");
      expect(types).toHaveLength(count);
      expect(new Set(types).size).toBeGreaterThan(1);
    }
  });

  it("includes a long session once there are at least 3 sessions a week", () => {
    expect(cardioSessionTypes(3, "aerobic-base")).toContain("long");
    expect(cardioSessionTypes(4, "specificity")).toContain("long");
  });

  it("returns an empty array for zero sessions", () => {
    expect(cardioSessionTypes(0, "aerobic-base")).toEqual([]);
  });
});

describe("sessionContentForInstance", () => {
  const gymGoal: RankedGoal = {
    id: "bench",
    goalType: "gym",
    targetKey: "Bench Press",
    targetValue: 100,
    currentValue: 70,
    label: "Bench Press",
    gapFraction: 0.3,
    achieved: false,
    weight: 1,
    weeklySessions: 2,
  };

  const cardioGoal: RankedGoal = {
    id: "run",
    goalType: "cardio",
    targetKey: "run",
    targetValue: 1200,
    currentValue: 1500,
    label: "5K run",
    gapFraction: 0.25,
    achieved: false,
    weight: 1,
    weeklySessions: 3,
  };

  it("produces genuinely different content for a lift's two weekly sessions, not the same prescription twice", () => {
    const first = sessionContentForInstance(gymGoal, 0, 2, new Set());
    const second = sessionContentForInstance(gymGoal, 1, 2, new Set());
    expect(first.description).not.toBe(second.description);
    expect(first.title).not.toBe(second.title);
  });

  it("includes accessory work in a gym session's description, not just the main lift", () => {
    const content = sessionContentForInstance(gymGoal, 0, 1, new Set());
    expect(content.description).toContain("Bench Press");
    expect(content.description).toContain("·"); // at least one accessory joined on
  });

  it("produces a real easy/quality/long spread for a 3x/week cardio goal, not the same session three times", () => {
    const sessions = [0, 1, 2].map((i) => sessionContentForInstance(cardioGoal, i, 3, new Set()));
    const sessionTypes = sessions.map((s) => s.sessionType);
    expect(new Set(sessionTypes).size).toBe(3);
  });
});
