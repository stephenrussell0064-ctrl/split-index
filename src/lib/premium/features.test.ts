import { describe, expect, it } from "vitest";
import { canAccess, canAccessLeaderboardScope } from "./features";

describe("canAccess / canAccessLeaderboardScope", () => {
  it("keeps a paid feature paid and a free one free", () => {
    // Replaces a case that gated "training_plan_multi_goal" — a feature key
    // removed with the Training Plan itself, so a test asserting it was
    // premium-only was asserting the price of nothing.
    expect(canAccess("strength_dots_gl", "free", null)).toBe(false);
    expect(canAccess("strength_dots_gl", "premium", "active")).toBe(true);
    expect(canAccess("full_logging", "free", null)).toBe(true);
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
