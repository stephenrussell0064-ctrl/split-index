import { describe, expect, it } from "vitest";
import {
  computeHybridBalanceGaps,
  reserveHybridBalanceSessions,
  resolveHybridBalanceSchedule,
  MAX_HYBRID_BALANCE_SESSIONS,
} from "./training-hybrid-balance";
import type { MovementPattern } from "./training-session-content";

// A tiny stand-in for movementPatternForExercise — only Bench/Row/Squat/Plank matter for these tests.
function pattern(name: string): MovementPattern | null {
  const map: Record<string, MovementPattern> = {
    "Bench Press": "push",
    "Barbell Row": "pull",
    Squat: "legs",
    Plank: "core",
  };
  return map[name] ?? null;
}

describe("computeHybridBalanceGaps", () => {
  it("flags every pattern missing when there are no gym goals at all", () => {
    const gaps = computeHybridBalanceGaps([{ goalType: "cardio", targetKey: "run" }], pattern);
    expect(gaps.missingPatterns.sort()).toEqual(["core", "legs", "pull", "push"]);
    expect(gaps.needsGymMaintenance).toBe(true);
  });

  it("flags only the patterns not touched by an active gym goal", () => {
    const gaps = computeHybridBalanceGaps(
      [
        { goalType: "gym", targetKey: "Bench Press" }, // push
        { goalType: "gym", targetKey: "Squat" }, // legs
      ],
      pattern
    );
    expect(gaps.missingPatterns.sort()).toEqual(["core", "pull"]);
    expect(gaps.needsGymMaintenance).toBe(false);
  });

  it("reports no missing patterns once push/pull/legs/core are all covered", () => {
    const gaps = computeHybridBalanceGaps(
      [
        { goalType: "gym", targetKey: "Bench Press" },
        { goalType: "gym", targetKey: "Barbell Row" },
        { goalType: "gym", targetKey: "Squat" },
        { goalType: "gym", targetKey: "Plank" },
      ],
      pattern
    );
    expect(gaps.missingPatterns).toEqual([]);
  });

  it("flags needsCardioMaintenance only when there's no active cardio goal of any sport", () => {
    expect(computeHybridBalanceGaps([{ goalType: "gym", targetKey: "Bench Press" }], pattern).needsCardioMaintenance).toBe(
      true
    );
    expect(
      computeHybridBalanceGaps(
        [
          { goalType: "gym", targetKey: "Bench Press" },
          { goalType: "cardio", targetKey: "run" },
        ],
        pattern
      ).needsCardioMaintenance
    ).toBe(false);
  });

  it("ignores achieved goals — an already-met goal doesn't count as covering its pattern", () => {
    const gaps = computeHybridBalanceGaps(
      [{ goalType: "gym", targetKey: "Bench Press", achieved: true }],
      pattern
    );
    expect(gaps.missingPatterns).toContain("push");
    expect(gaps.needsGymMaintenance).toBe(true);
  });

  it("ignores an exercise name that doesn't match anything in the catalog rather than crashing", () => {
    const gaps = computeHybridBalanceGaps([{ goalType: "gym", targetKey: "Made Up Lift" }], pattern);
    expect(gaps.missingPatterns.sort()).toEqual(["core", "legs", "pull", "push"]);
  });
});

describe("reserveHybridBalanceSessions", () => {
  it("reserves nothing when nothing is missing", () => {
    const gaps = { missingPatterns: [], needsCardioMaintenance: false, needsGymMaintenance: false };
    expect(reserveHybridBalanceSessions(gaps, 10, 3)).toBe(0);
  });

  it("reserves one session for gym gaps and one for cardio gaps, up to the cap", () => {
    const gaps = { missingPatterns: ["pull" as MovementPattern], needsCardioMaintenance: true, needsGymMaintenance: false };
    expect(reserveHybridBalanceSessions(gaps, 10, 3)).toBe(2);
    expect(reserveHybridBalanceSessions(gaps, 10, 3)).toBeLessThanOrEqual(MAX_HYBRID_BALANCE_SESSIONS);
  });

  it("never reserves so much that real goals would be crowded below one session each", () => {
    const gaps = { missingPatterns: ["pull" as MovementPattern], needsCardioMaintenance: true, needsGymMaintenance: false };
    // Only 2 total capacity, 2 active goals — no room to spare for maintenance at all.
    expect(reserveHybridBalanceSessions(gaps, 2, 2)).toBe(0);
  });

  it("never claims more than a fifth of the week even when there'd otherwise be room to spare", () => {
    const gaps = { missingPatterns: ["pull" as MovementPattern], needsCardioMaintenance: true, needsGymMaintenance: false };
    // 3 capacity, 2 goals leaves 1 full session of "spare" headroom by the
    // leave-a-session-per-goal rule alone, but 1/3 capacity is still a
    // third of the week — too much for something secondary to real goals.
    expect(reserveHybridBalanceSessions(gaps, 3, 2)).toBe(0);
    // 6 capacity, 1 goal: leave-room alone would allow up to 5, but the
    // 20% fraction cap kicks in first and holds it to 1.
    expect(reserveHybridBalanceSessions(gaps, 6, 1)).toBe(1);
    // 10 capacity, 3 goals: plenty of room for the full 2-session cap.
    expect(reserveHybridBalanceSessions(gaps, 10, 3)).toBe(2);
  });

  // User feedback: "increase the goal percentage slightly higher as
  // ultimately they want to work towards this" — goals should keep an
  // even clearer majority than the original 75% floor.
  it("guarantees real goals at least 80% of the week whenever any reservation happens", () => {
    const gaps = { missingPatterns: ["pull" as MovementPattern], needsCardioMaintenance: true, needsGymMaintenance: false };
    for (const [capacity, activeGoalCount] of [
      [5, 2],
      [6, 1],
      [8, 2],
      [10, 3],
      [14, 4],
    ] as const) {
      const reserved = reserveHybridBalanceSessions(gaps, capacity, activeGoalCount);
      expect(reserved / capacity).toBeLessThanOrEqual(0.2);
    }
  });

  it("allows the full reservation when there are no active goals at all yet", () => {
    const gaps = { missingPatterns: ["pull" as MovementPattern], needsCardioMaintenance: true, needsGymMaintenance: true };
    expect(reserveHybridBalanceSessions(gaps, 5, 0)).toBe(2);
  });
});

describe("resolveHybridBalanceSchedule", () => {
  const bothGaps = { missingPatterns: ["pull" as MovementPattern], needsCardioMaintenance: true, needsGymMaintenance: false };

  it("grants both maintenance types when 2 sessions are reserved", () => {
    const resolved = resolveHybridBalanceSchedule(bothGaps, 2);
    expect(resolved.gymMaintenance).not.toBeNull();
    expect(resolved.cardioMaintenance).toBe(true);
  });

  it("prioritizes gym-pattern coverage over cardio when only one slot is reserved", () => {
    const resolved = resolveHybridBalanceSchedule(bothGaps, 1);
    expect(resolved.gymMaintenance).not.toBeNull();
    expect(resolved.cardioMaintenance).toBe(false);
  });

  it("grants nothing when zero sessions are reserved, even if gaps exist", () => {
    const resolved = resolveHybridBalanceSchedule(bothGaps, 0);
    expect(resolved.gymMaintenance).toBeNull();
    expect(resolved.cardioMaintenance).toBe(false);
  });

  it("carries the actual missing patterns through to the resolved gym maintenance", () => {
    const gaps = {
      missingPatterns: ["pull", "core"] as MovementPattern[],
      needsCardioMaintenance: false,
      needsGymMaintenance: false,
    };
    const resolved = resolveHybridBalanceSchedule(gaps, 1);
    expect(resolved.gymMaintenance?.missingPatterns.sort()).toEqual(["core", "pull"]);
  });
});
