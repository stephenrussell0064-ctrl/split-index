import { describe, expect, it } from "vitest";
import {
  computeGapFraction,
  buildTrainingPlan,
  estimateSessionCount,
  buildWeeklySchedule,
  buildMacrocyclePreview,
  type TrainingGoalInput,
  type RankedGoal,
} from "./training-plan";

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

describe("estimateSessionCount", () => {
  it("converts an hours budget into a session count using the blended average session length", () => {
    // Two cardio goals (0.75h each, avg 0.75h) — 6 hours / 0.75h = 8 sessions.
    const goals: Pick<TrainingGoalInput, "goalType">[] = [{ goalType: "cardio" }, { goalType: "cardio" }];
    expect(estimateSessionCount(goals, 6)).toBe(8);
  });

  it("uses a longer average when gym goals are mixed in", () => {
    // One cardio (0.75h) + one gym (1h) => avg 0.875h. 7h / 0.875h = 8.
    const goals: Pick<TrainingGoalInput, "goalType">[] = [{ goalType: "cardio" }, { goalType: "gym" }];
    expect(estimateSessionCount(goals, 7)).toBe(8);
  });

  it("returns 0 for no goals or no hours", () => {
    expect(estimateSessionCount([], 10)).toBe(0);
    expect(estimateSessionCount([{ goalType: "cardio" }], 0)).toBe(0);
  });
});

describe("buildWeeklySchedule", () => {
  const ranked = (overrides: Partial<RankedGoal>): RankedGoal => ({
    id: "id",
    goalType: "cardio",
    targetKey: "run",
    targetValue: 1000,
    currentValue: 1000,
    label: "Goal",
    gapFraction: 0.2,
    achieved: false,
    weight: 1,
    weeklySessions: 0,
    feasibility: { feasible: true, message: null },
    ...overrides,
  });

  it("places every session somewhere across the week when hours are given per day", () => {
    const goals = [ranked({ id: "run", weeklySessions: 3 }), ranked({ id: "squat", goalType: "gym", weeklySessions: 2 })];
    const perDay = [2, 2, 2, 2, 2, 2, 2]; // plenty of room every day
    const days = buildWeeklySchedule(goals, perDay);
    const totalPlaced = days.reduce((sum, d) => sum + d.sessions.length, 0);
    expect(totalPlaced).toBe(5);
  });

  it("never schedules a day beyond its stated capacity", () => {
    const goals = [ranked({ id: "run", weeklySessions: 4 })]; // 4 * 0.75h = 3h needed
    const perDay = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]; // not enough room anywhere for a 0.75h session
    const days = buildWeeklySchedule(goals, perDay);
    for (const d of days) {
      const used = d.sessions.reduce((sum, s) => sum + s.durationHours, 0);
      expect(used).toBeLessThanOrEqual(d.capacityHours!);
    }
  });

  it("spreads a single goal's repeat sessions across different days when no per-day hours are given", () => {
    const goals = [ranked({ id: "run", weeklySessions: 3 })];
    const days = buildWeeklySchedule(goals);
    const daysWithSessions = days.filter((d) => d.sessions.length > 0);
    expect(daysWithSessions).toHaveLength(3);
    expect(daysWithSessions.every((d) => d.sessions.length === 1)).toBe(true);
  });

  it("interleaves two goals round-robin rather than stacking one goal's sessions first", () => {
    const goals = [
      ranked({ id: "run", weeklySessions: 2, gapFraction: 0.5 }),
      ranked({ id: "squat", goalType: "gym", weeklySessions: 2, gapFraction: 0.1 }),
    ];
    const days = buildWeeklySchedule(goals);
    const order = days.flatMap((d) => d.sessions.map((s) => s.goalId));
    // Round-robin over [run, squat] with 2 each should alternate, not group.
    expect(order).toEqual(["run", "squat", "run", "squat"]);
  });

  it("returns an empty but fully-populated 7-day skeleton when nothing is scheduled", () => {
    const days = buildWeeklySchedule([]);
    expect(days).toHaveLength(7);
    expect(days.every((d) => d.sessions.length === 0)).toBe(true);
    expect(days.map((d) => d.dayLabel)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });

  it("avoids stacking a leg session next to (or on) a hard cardio session when a real per-day schedule gives it room to", () => {
    const goals = [
      ranked({ id: "squat", goalType: "gym", targetKey: "Squat", label: "Squat", weeklySessions: 1 }),
      // gapFraction 0.1 -> "specificity" emphasis -> a single weekly
      // session is "tempo", which is in the high-demand set.
      ranked({ id: "run", goalType: "cardio", targetKey: "run", label: "5K run", gapFraction: 0.1, weeklySessions: 1 }),
    ];
    const perDay = [3, 3, 3, 3, 3, 3, 3]; // plenty of room everywhere, so the only thing steering placement is interference avoidance
    const days = buildWeeklySchedule(goals, perDay);
    const squatDay = days.findIndex((d) => d.sessions.some((s) => s.goalId === "squat"));
    const runDay = days.findIndex((d) => d.sessions.some((s) => s.goalId === "run"));
    expect(squatDay).toBeGreaterThanOrEqual(0);
    expect(runDay).toBeGreaterThanOrEqual(0);
    expect(Math.abs(squatDay - runDay)).toBeGreaterThan(1); // not the same day, not adjacent
  });
});

describe("buildTrainingPlan urgency weighting (Stage 3)", () => {
  const goal = (overrides: Partial<TrainingGoalInput>): TrainingGoalInput => ({
    id: "id",
    goalType: "cardio",
    targetKey: "run",
    targetValue: 1000,
    currentValue: 1000,
    label: "Goal",
    ...overrides,
  });

  it("gives a goal with a near deadline more weekly sessions than an identical gap with no deadline", () => {
    const goals = [
      goal({ id: "urgent", targetValue: 1000, currentValue: 1300, daysUntilTarget: 14 }),
      goal({ id: "chill", targetValue: 1000, currentValue: 1300, daysUntilTarget: null }),
    ];
    const plan = buildTrainingPlan(goals, 6);
    const urgent = plan.find((g) => g.id === "urgent")!;
    const chill = plan.find((g) => g.id === "chill")!;
    expect(urgent.weeklySessions).toBeGreaterThan(chill.weeklySessions);
    // The raw gap percentage shown to the user is untouched by urgency.
    expect(urgent.gapFraction).toBeCloseTo(chill.gapFraction, 5);
  });

  it("leaves a far-out deadline (outside the peak window) with unchanged weighting", () => {
    const goals = [
      goal({ id: "far-deadline", targetValue: 1000, currentValue: 1300, daysUntilTarget: 120 }),
      goal({ id: "no-deadline", targetValue: 1000, currentValue: 1300, daysUntilTarget: null }),
    ];
    const plan = buildTrainingPlan(goals, 6);
    expect(plan.find((g) => g.id === "far-deadline")!.weeklySessions).toBe(
      plan.find((g) => g.id === "no-deadline")!.weeklySessions
    );
  });

  it("still sums exactly to the weekly capacity with mixed deadlines", () => {
    const goals = [
      goal({ id: "a", targetValue: 1000, currentValue: 1300, daysUntilTarget: 5 }),
      goal({ id: "b", targetValue: 100, currentValue: 60, goalType: "gym", daysUntilTarget: null }),
      goal({ id: "c", targetValue: 500, currentValue: 520, daysUntilTarget: 20 }),
    ];
    for (const capacity of [1, 3, 5, 7, 10]) {
      const plan = buildTrainingPlan(goals, capacity);
      const total = plan.reduce((sum, g) => sum + g.weeklySessions, 0);
      expect(total).toBe(capacity);
    }
  });
});

describe("buildMacrocyclePreview", () => {
  const goal = (overrides: Partial<TrainingGoalInput>): TrainingGoalInput => ({
    id: "id",
    goalType: "gym",
    targetKey: "Squat",
    targetValue: 140,
    currentValue: 100,
    label: "Squat",
    ...overrides,
  });

  it("returns the requested number of weeks, starting with 'This week'", () => {
    const weeks = buildMacrocyclePreview([goal({ daysUntilTarget: 60 })], 4, 5);
    expect(weeks).toHaveLength(5);
    expect(weeks[0].weekLabel).toBe("This week");
    expect(weeks[1].weekLabel).toBe("Week 2");
  });

  it("shifts a goal into its taper phase in the weeks approaching its deadline", () => {
    const weeks = buildMacrocyclePreview([goal({ daysUntilTarget: 20 })], 4, 4);
    // 20 days out now (not tapering yet), but by week 2 (14 days later) it's inside the 10-day taper window.
    const findGoal = (w: number) => weeks[w].goals.find((g) => g.goalId === "id");
    expect(findGoal(0)?.isTaper).toBe(false);
    expect(findGoal(2)?.isTaper).toBe(true);
    expect(findGoal(2)?.phaseLabel).toContain("Taper");
  });

  it("holds a goal's phase steady across every week when it has no deadline", () => {
    const weeks = buildMacrocyclePreview([goal({ daysUntilTarget: null })], 4, 6);
    const phases = weeks.map((w) => w.goals.find((g) => g.goalId === "id")?.phaseLabel);
    expect(new Set(phases).size).toBe(1);
  });

  it("drops a goal from later weeks once it would already be achieved today (no false optimism about future progress)", () => {
    const weeks = buildMacrocyclePreview([goal({ currentValue: 140, daysUntilTarget: 30 })], 4, 3);
    expect(weeks.every((w) => w.goals.length === 0)).toBe(true);
  });
});
