import { describe, expect, it } from "vitest";
import { computeGapFraction, buildTrainingPlan, type TrainingGoalInput } from "./training-plan";

describe("computeGapFraction", () => {
  it("returns 0 for a cardio goal already met or beaten", () => {
    expect(computeGapFraction({ goalType: "cardio", targetValue: 1200, currentValue: 1200 })).toBe(0);
    expect(computeGapFraction({ goalType: "cardio", targetValue: 1200, currentValue: 1100 })).toBe(0);
  });

  it("returns a positive fraction for a cardio goal not yet met (currently slower)", () => {
    // 10% slower than target
    expect(computeGapFraction({ goalType: "cardio", targetValue: 1000, currentValue: 1100 })).toBeCloseTo(0.1, 5);
  });

  it("returns 0 for a gym goal already met or beaten", () => {
    expect(computeGapFraction({ goalType: "gym", targetValue: 100, currentValue: 100 })).toBe(0);
    expect(computeGapFraction({ goalType: "gym", targetValue: 100, currentValue: 110 })).toBe(0);
  });

  it("returns a positive fraction for a gym goal not yet met (currently lighter)", () => {
    expect(computeGapFraction({ goalType: "gym", targetValue: 100, currentValue: 90 })).toBeCloseTo(0.1, 5);
  });

  it("treats no current data as maximally far off (encourages logging a baseline)", () => {
    expect(computeGapFraction({ goalType: "cardio", targetValue: 1000, currentValue: null })).toBe(1);
  });
});

describe("buildTrainingPlan", () => {
  const goal = (overrides: Partial<TrainingGoalInput>): TrainingGoalInput => ({
    id: "id",
    goalType: "cardio",
    targetKey: "run",
    targetValue: 1000,
    currentValue: 1000,
    label: "Goal",
    ...overrides,
  });

  it("prioritizes the goal with the biggest gap with more weekly sessions", () => {
    const goals = [
      goal({ id: "close", targetValue: 1000, currentValue: 1020 }), // 2% off
      goal({ id: "far", targetValue: 1000, currentValue: 1400 }), // 40% off
    ];
    const plan = buildTrainingPlan(goals, 6);
    const far = plan.find((g) => g.id === "far")!;
    const close = plan.find((g) => g.id === "close")!;
    expect(far.weeklySessions).toBeGreaterThan(close.weeklySessions);
    // Furthest-behind-first ordering.
    expect(plan[0].id).toBe("far");
  });

  it("never lets an achieved goal consume any weekly sessions", () => {
    const goals = [
      goal({ id: "done", targetValue: 1000, currentValue: 900 }),
      goal({ id: "active", targetValue: 1000, currentValue: 1500 }),
    ];
    const plan = buildTrainingPlan(goals, 5);
    expect(plan.find((g) => g.id === "done")!.weeklySessions).toBe(0);
    expect(plan.find((g) => g.id === "done")!.achieved).toBe(true);
  });

  it("guarantees every active goal a non-zero share even when one goal dominates the gap (hybrid balance floor)", () => {
    const goals = [
      goal({ id: "tiny-gap", targetValue: 1000, currentValue: 1010 }), // 1% off
      goal({ id: "huge-gap", targetValue: 1000, currentValue: 5000 }), // 400% off
    ];
    const plan = buildTrainingPlan(goals, 10);
    const tiny = plan.find((g) => g.id === "tiny-gap")!;
    expect(tiny.weight).toBeGreaterThan(0);
    expect(tiny.weeklySessions).toBeGreaterThan(0);
  });

  it("allocates session counts that sum exactly to the weekly capacity", () => {
    const goals = [
      goal({ id: "a", targetValue: 1000, currentValue: 1300 }),
      goal({ id: "b", targetValue: 100, currentValue: 60, goalType: "gym" }),
      goal({ id: "c", targetValue: 500, currentValue: 520 }),
    ];
    for (const capacity of [1, 3, 5, 7, 10]) {
      const plan = buildTrainingPlan(goals, capacity);
      const total = plan.reduce((sum, g) => sum + g.weeklySessions, 0);
      expect(total).toBe(capacity);
    }
  });

  it("treats a goal with no logged data yet as needing the most focus", () => {
    const goals = [
      goal({ id: "logged", targetValue: 1000, currentValue: 1050 }),
      goal({ id: "unlogged", targetValue: 1000, currentValue: null }),
    ];
    const plan = buildTrainingPlan(goals, 6);
    expect(plan[0].id).toBe("unlogged");
  });

  it("returns zero sessions for every goal when all are already achieved", () => {
    const goals = [
      goal({ id: "a", targetValue: 1000, currentValue: 900 }),
      goal({ id: "b", targetValue: 1000, currentValue: 800 }),
    ];
    const plan = buildTrainingPlan(goals, 6);
    expect(plan.every((g) => g.weeklySessions === 0)).toBe(true);
    expect(plan.every((g) => g.achieved)).toBe(true);
  });
});
