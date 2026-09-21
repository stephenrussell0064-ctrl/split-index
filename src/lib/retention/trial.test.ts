import { describe, expect, it } from "vitest";
import { getTrialDaysRemaining, isPremiumUser, hasSoftTrialAccess } from "./trial";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

describe("isPremiumUser", () => {
  it("is true for an active premium subscription", () => {
    expect(isPremiumUser("premium", "active")).toBe(true);
  });

  it("is true for a Stripe-trialing premium subscription", () => {
    expect(isPremiumUser("premium", "trialing")).toBe(true);
  });

  it("is false for free tier regardless of status", () => {
    expect(isPremiumUser("free", null)).toBe(false);
  });

  it("is false for a canceled premium subscription", () => {
    expect(isPremiumUser("premium", "canceled")).toBe(false);
  });
});

describe("hasSoftTrialAccess — Slice D card-less signup trial", () => {
  it("grants access to a brand-new free-tier user", () => {
    expect(hasSoftTrialAccess(daysAgoIso(0), "free", null)).toBe(true);
  });

  it("grants access within the trial window", () => {
    expect(hasSoftTrialAccess(daysAgoIso(13), "free", null)).toBe(true);
  });

  it("denies access once the trial window has elapsed", () => {
    expect(hasSoftTrialAccess(daysAgoIso(14), "free", null)).toBe(false);
    expect(hasSoftTrialAccess(daysAgoIso(30), "free", null)).toBe(false);
  });

  it("never grants access to a real premium-tier account (defers entirely to isPremiumUser)", () => {
    expect(hasSoftTrialAccess(daysAgoIso(0), "premium", "active")).toBe(false);
    expect(hasSoftTrialAccess(daysAgoIso(0), "premium", "past_due")).toBe(false);
    expect(hasSoftTrialAccess(daysAgoIso(0), "premium", "canceled")).toBe(false);
  });

  it("does not grant access to an explicitly canceled free-tier profile", () => {
    expect(hasSoftTrialAccess(daysAgoIso(0), "free", "canceled")).toBe(false);
  });
});

describe("getTrialDaysRemaining", () => {
  it("counts down from signup date", () => {
    expect(getTrialDaysRemaining(daysAgoIso(5), "free", null)).toBe(9);
  });

  it("returns null for an active paying premium user", () => {
    expect(getTrialDaysRemaining(daysAgoIso(5), "premium", "active")).toBeNull();
  });

  it("returns null once explicitly canceled", () => {
    expect(getTrialDaysRemaining(daysAgoIso(5), "free", "canceled")).toBeNull();
  });

  it("floors at 0 rather than going negative", () => {
    expect(getTrialDaysRemaining(daysAgoIso(30), "free", null)).toBe(0);
  });
});
