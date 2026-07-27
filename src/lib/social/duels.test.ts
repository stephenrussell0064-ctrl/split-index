import { describe, expect, it } from "vitest";
import { aggregateDuelScores, duelWindowEndExclusive, pickLeader } from "./duels";

describe("aggregateDuelScores", () => {
  const [a, b] = ["user-a", "user-b"] as [string, string];

  /** Shorthand for a workout_scores row — endurance/strength_component default null (cardio-only/gym-only fields, see activity-scorer.ts). */
  function row(
    userId: string,
    overrides: Partial<{
      load_score: number | null;
      created_at: string;
      endurance_component: number | null;
      strength_component: number | null;
    }> = {}
  ) {
    return {
      user_id: userId,
      load_score: null,
      created_at: "2026-01-01",
      endurance_component: null,
      strength_component: null,
      ...overrides,
    };
  }

  it("counts sessions for the 'sessions' metric", () => {
    const rows = [
      row(a, { load_score: 50, created_at: "2026-01-01" }),
      row(a, { load_score: 30, created_at: "2026-01-02" }),
      row(b, { load_score: 999, created_at: "2026-01-01" }),
    ];
    expect(aggregateDuelScores(rows, "sessions", [a, b])).toEqual({ [a]: 2, [b]: 1 });
  });

  it("sums load_score for the 'load' metric", () => {
    const rows = [
      row(a, { load_score: 50 }),
      row(a, { load_score: 30 }),
      row(b, { load_score: 40 }),
    ];
    expect(aggregateDuelScores(rows, "load", [a, b])).toEqual({ [a]: 80, [b]: 40 });
  });

  it("ignores rows from users outside the duel", () => {
    const rows = [row("stranger", { load_score: 500 })];
    expect(aggregateDuelScores(rows, "load", [a, b])).toEqual({ [a]: 0, [b]: 0 });
  });

  it("treats a null load_score as 0 rather than NaN", () => {
    const rows = [row(a, { load_score: null })];
    expect(aggregateDuelScores(rows, "load", [a, b])[a]).toBe(0);
  });

  it("returns zero for both participants with no rows", () => {
    expect(aggregateDuelScores([], "sessions", [a, b])).toEqual({ [a]: 0, [b]: 0 });
  });

  it("'speed' takes the best single-session endurance_component, not a sum", () => {
    const rows = [
      row(a, { endurance_component: 600 }),
      row(a, { endurance_component: 650 }),
      row(a, { endurance_component: 400 }),
      row(b, { endurance_component: 620 }),
    ];
    expect(aggregateDuelScores(rows, "speed", [a, b])).toEqual({ [a]: 650, [b]: 620 });
  });

  it("'speed' ignores gym rows (endurance_component null on gym sessions)", () => {
    const rows = [row(a, { endurance_component: null, strength_component: 700 })];
    expect(aggregateDuelScores(rows, "speed", [a, b])[a]).toBe(0);
  });

  it("'strength' takes the best single-session strength_component, not a sum", () => {
    const rows = [
      row(a, { strength_component: 500 }),
      row(a, { strength_component: 720 }),
      row(b, { strength_component: 690 }),
    ];
    expect(aggregateDuelScores(rows, "strength", [a, b])).toEqual({ [a]: 720, [b]: 690 });
  });

  it("'strength' ignores cardio rows (strength_component null on cardio sessions)", () => {
    const rows = [row(a, { strength_component: null, endurance_component: 700 })];
    expect(aggregateDuelScores(rows, "strength", [a, b])[a]).toBe(0);
  });
});

describe("duelWindowEndExclusive", () => {
  it("returns midnight UTC the day after end_date, so the whole end day counts", () => {
    expect(duelWindowEndExclusive("2026-01-07")).toBe("2026-01-08T00:00:00.000Z");
  });

  it("rolls over month/year boundaries correctly", () => {
    expect(duelWindowEndExclusive("2026-01-31")).toBe("2026-02-01T00:00:00.000Z");
    expect(duelWindowEndExclusive("2026-12-31")).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("pickLeader", () => {
  it("picks the challenger when they're ahead", () => {
    expect(pickLeader("challenger", 10, "opponent", 5)).toBe("challenger");
  });

  it("picks the opponent when they're ahead", () => {
    expect(pickLeader("challenger", 5, "opponent", 10)).toBe("opponent");
  });

  it("returns null on a tie", () => {
    expect(pickLeader("challenger", 7, "opponent", 7)).toBeNull();
  });

  it("returns null when both are at zero (duel not yet underway)", () => {
    expect(pickLeader("challenger", 0, "opponent", 0)).toBeNull();
  });
});
