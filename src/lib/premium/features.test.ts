import { describe, expect, it } from "vitest";
import { splitGoalsByPremiumLimit, canAccess, canAccessLeaderboardScope } from "./features";

describe("splitGoalsByPremiumLimit", () => {
  it("includes everything and locks nothing for a premium account, regardless of count", () => {
    const rows = ["a", "b", "c", "d", "e"];
    const { included, locked } = splitGoalsByPremiumLimit(rows, true, 1);
    expect(included).toEqual(rows);
    expect(locked).toEqual([]);
  });

  it("caps a free account at maxFreeGoals, locking the rest rather than dropping them", () => {
    const rows = ["a", "b", "c"];
    const { included, locked } = splitGoalsByPremiumLimit(rows, false, 1);
    expect(included).toEqual(["a"]);
    expect(locked).toEqual(["b", "c"]);
    // Nothing lost — every row is accounted for exactly once.
    expect([...included, ...locked]).toEqual(rows);
  });

  it("locks nothing when a free account is under the cap", () => {
    const rows = ["a"];
    const { included, locked } = splitGoalsByPremiumLimit(rows, false, 1);
    expect(included).toEqual(["a"]);
    expect(locked).toEqual([]);
  });

  it("handles zero goals for both tiers without throwing", () => {
    expect(splitGoalsByPremiumLimit([], true, 1)).toEqual({ included: [], locked: [] });
    expect(splitGoalsByPremiumLimit([], false, 1)).toEqual({ included: [], locked: [] });
  });

  it("preserves row order within each bucket", () => {
    const rows = [1, 2, 3, 4, 5];
    const { included, locked } = splitGoalsByPremiumLimit(rows, false, 2);
    expect(included).toEqual([1, 2]);
    expect(locked).toEqual([3, 4, 5]);
  });
});

describe("canAccess / canAccessLeaderboardScope (existing gating, sanity-checked alongside the new function)", () => {
  it("training_plan_multi_goal is premium-only", () => {
    expect(canAccess("training_plan_multi_goal", "free", null)).toBe(false);
    expect(canAccess("training_plan_multi_goal", "premium", "active")).toBe(true);
  });

  it("country and bracket leaderboard scopes stay free regardless of tier", () => {
    expect(canAccessLeaderboardScope("country", { subscription_tier: "free", subscription_status: null })).toBe(true);
    expect(canAccessLeaderboardScope("bracket", { subscription_tier: "free", subscription_status: null })).toBe(true);
  });

  it("global leaderboard scope requires premium", () => {
    expect(canAccessLeaderboardScope("global", { subscription_tier: "free", subscription_status: null })).toBe(false);
    expect(canAccessLeaderboardScope("global", { subscription_tier: "premium", subscription_status: "active" })).toBe(true);
  });
});
