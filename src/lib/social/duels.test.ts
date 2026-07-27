import { describe, expect, it } from "vitest";
import { aggregateDuelScores, duelWindowEndExclusive, pickLeader } from "./duels";

describe("aggregateDuelScores", () => {
  const [a, b] = ["user-a", "user-b"] as [string, string];

  it("counts sessions for the 'sessions' metric", () => {
    const rows = [
      { user_id: a, load_score: 50, created_at: "2026-01-01" },
      { user_id: a, load_score: 30, created_at: "2026-01-02" },
      { user_id: b, load_score: 999, created_at: "2026-01-01" },
    ];
    expect(aggregateDuelScores(rows, "sessions", [a, b])).toEqual({ [a]: 2, [b]: 1 });
  });

  it("sums load_score for the 'load' metric", () => {
    const rows = [
      { user_id: a, load_score: 50, created_at: "2026-01-01" },
      { user_id: a, load_score: 30, created_at: "2026-01-02" },
      { user_id: b, load_score: 40, created_at: "2026-01-01" },
    ];
    expect(aggregateDuelScores(rows, "load", [a, b])).toEqual({ [a]: 80, [b]: 40 });
  });

  it("ignores rows from users outside the duel", () => {
    const rows = [{ user_id: "stranger", load_score: 500, created_at: "2026-01-01" }];
    expect(aggregateDuelScores(rows, "load", [a, b])).toEqual({ [a]: 0, [b]: 0 });
  });

  it("treats a null load_score as 0 rather than NaN", () => {
    const rows = [{ user_id: a, load_score: null, created_at: "2026-01-01" }];
    expect(aggregateDuelScores(rows, "load", [a, b])[a]).toBe(0);
  });

  it("returns zero for both participants with no rows", () => {
    expect(aggregateDuelScores([], "sessions", [a, b])).toEqual({ [a]: 0, [b]: 0 });
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
