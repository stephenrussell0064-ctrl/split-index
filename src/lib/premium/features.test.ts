import { describe, expect, it } from "vitest";
import {
  canAccess,
  canAccessLeaderboardScope,
  canAccessProfile,
  PREMIUM_FEATURES,
  type PremiumFeature,
} from "./features";

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

/**
 * THE FULL ENTITLEMENT MATRIX.
 *
 * Three features were spot-checked here and fifteen were not, so the table
 * itself was unguarded: flipping `data_export` or `oauth_sync` to free left
 * the entire suite green. Those are two of the nine things the pricing page
 * sells, given away with no test noticing — and because PREMIUM_TIER_FEATURES
 * is rendered verbatim on the billing screen, the app would go on charging for
 * them while handing them out.
 *
 * Every key is asserted explicitly rather than looped over the table, so this
 * is a second copy of the pricing decision rather than a restatement of the
 * first. A loop reading PREMIUM_FEATURES to check PREMIUM_FEATURES cannot
 * fail.
 */
describe("the paid/free line, feature by feature", () => {
  const FREE_FOR_EVERYONE: PremiumFeature[] = [
    "full_logging",
    "manual_logging",
    "csv_import",
    "split_index_current",
    "cardio_index_per_workout",
    "ai_coaching_rules_snippet",
    // Recording your own recovery — HRV, drinks — and seeing today's score.
    // Same principle as logging a workout: the entry path is never paywalled,
    // because a starved model is worse for everybody including subscribers.
    "recovery_score",
  ];

  const PAID_ONLY: PremiumFeature[] = [
    "split_index_90d_trends",
    "split_index_projections",
    "period_comparison",
    "strength_dots_gl",
    "cardio_hr_accountability",
    "ai_coaching_full",
    "global_leaderboards",
    "leaderboards_filtered",
    "data_export",
    "oauth_sync",
    "global_rank",
    "run_analysis",
    // Free in build 1.0 (5) and paid from 21 Sep 2026, once App Store approval
    // closed the Guideline 2.1 review that required it to ship free. The gate
    // stops GENERATION only — api/hpe/plan still serves a block generated
    // while the account was entitled to one.
    "hybrid_plan",
    // The reading, not the recording: the per-session decrement forecast and
    // the drinking trend. The score's alcohol DEDUCTION is not gated — a free
    // athlete's recovery still drops after a heavy night, it just doesn't come
    // with the forecast.
    "alcohol_impact_analysis",
  ];

  it.each(FREE_FOR_EVERYONE)("%s is free — logging your own training is never paywalled", (feature) => {
    expect(canAccess(feature, "free", null)).toBe(true);
    expect(canAccess(feature, "premium", "active")).toBe(true);
  });

  it.each(PAID_ONLY)("%s is premium-only", (feature) => {
    expect(canAccess(feature, "free", null)).toBe(false);
    expect(canAccess(feature, "premium", "active")).toBe(true);
  });

  it("covers every key in the table, so a new feature cannot be added untested", () => {
    // Without this, adding a key to PREMIUM_FEATURES silently escapes both
    // lists above and ships ungated.
    expect([...FREE_FOR_EVERYONE, ...PAID_ONLY].sort()).toEqual(
      (Object.keys(PREMIUM_FEATURES) as PremiumFeature[]).sort()
    );
  });
});

describe("what counts as premium", () => {
  it("treats a trialing subscriber as premium", () => {
    // The trial is the product demo. Gating it defeats the point.
    expect(canAccess("data_export", "premium", "trialing")).toBe(true);
  });

  it("does not treat a lapsed or cancelled subscriber as premium", () => {
    expect(canAccess("data_export", "premium", "canceled")).toBe(false);
    expect(canAccess("data_export", "premium", "past_due")).toBe(false);
    expect(canAccess("data_export", "premium", null)).toBe(false);
  });

  it("does not let a free tier claim premium by carrying an active status", () => {
    // Both halves must agree. A stale status column on a downgraded account
    // must not re-grant paid features.
    expect(canAccess("data_export", "free", "active")).toBe(false);
  });

  it("canAccessProfile is the same decision, read off a profile row", () => {
    expect(
      canAccessProfile("data_export", { subscription_tier: "premium", subscription_status: "active" })
    ).toBe(true);
    expect(
      canAccessProfile("data_export", { subscription_tier: "free", subscription_status: null })
    ).toBe(false);
  });
});
