import { isPremiumUser } from "@/lib/retention/trial";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

/** Central premium feature keys — single source of truth for gating. */
export type PremiumFeature =
  | "full_logging"
  | "split_index_current"
  | "split_index_90d_trends"
  | "split_index_projections"
  | "period_comparison"
  | "cardio_index_per_workout"
  | "strength_dots_gl"
  | "cardio_hr_accountability"
  | "ai_coaching_full"
  | "ai_coaching_rules_snippet"
  | "global_leaderboards"
  | "leaderboards_filtered"
  | "data_export"
  | "oauth_sync"
  | "global_rank"
  | "csv_import"
  | "manual_logging";

type TierAccess = { free: boolean; premium: boolean };

/** Which tiers can access each feature. */
export const PREMIUM_FEATURES: Record<PremiumFeature, TierAccess> = {
  full_logging: { free: true, premium: true },
  manual_logging: { free: true, premium: true },
  csv_import: { free: true, premium: true },
  split_index_current: { free: true, premium: true },
  cardio_index_per_workout: { free: true, premium: true },
  ai_coaching_rules_snippet: { free: true, premium: true },

  split_index_90d_trends: { free: false, premium: true },
  split_index_projections: { free: false, premium: true },
  period_comparison: { free: false, premium: true },
  strength_dots_gl: { free: false, premium: true },
  cardio_hr_accountability: { free: false, premium: true },
  ai_coaching_full: { free: false, premium: true },
  global_leaderboards: { free: false, premium: true },
  leaderboards_filtered: { free: false, premium: true },
  data_export: { free: false, premium: true },
  oauth_sync: { free: false, premium: true },
  global_rank: { free: false, premium: true },
};

/*
 * The Training Plan's per-tier caps used to live here — MAX_FREE_TRAINING_GOALS,
 * MAX_FREE_WEEKLY_CAPACITY, MAX_PREMIUM_WEEKLY_CAPACITY — centralized so the
 * API route and the wizard UI could not disagree about them. Both are gone with
 * the product (the page removed at the athlete's request, the API retired
 * after), and a cap on a feature nobody can reach is not a cap.
 *
 * The Hybrid Plan does not replace them. It is not sold by the goal: it builds
 * ONE block toward one event, and there is nothing to meter.
 */

export const FREE_TIER_FEATURES = [
  "Full workout logging (all paths)",
  "Current Split Index & per-workout cardio index",
  "Last 7 days on dashboard",
  "Rules-based training snippet",
  "Manual entry + CSV import",
  "Country leaderboard preview",
] as const;

export const PREMIUM_TIER_FEATURES = [
  "Injury Risk Index — know when to back off, before it becomes an injury",
  "GPT AI Coach — a concrete recommendation after every workout",
  "Race predictions personalized to your own pace curve, not a generic formula",
  "Full Strength Index with DOTS / IPF GL tiers",
  "Cardio HR accountability (TRIMP, EF, decoupling)",
  "90-day trend history & period comparison",
  "8-week Split Index projections",
  "Global leaderboards & rank percentile",
  "Data export (CSV / JSON)",
  /*
   * "Multi-goal hybrid training plan across every sport" was here, and it is
   * removed rather than reworded because it named the multi-goal weekly
   * balancer specifically — the product whose page was removed and whose API is
   * now retired. Billing and the marketing pricing panel both render this list
   * verbatim, so leaving it would have gone on selling a removed feature to
   * paying subscribers.
   *
   * It is NOT repointed at the Hybrid Plan, tempting as that is. The Hybrid
   * Plan is gated by a rollout flag (hpe/rollout.ts), not by subscription, so
   * naming it here would claim as paid something every free account can already
   * open. If it should become the paid hook, it needs a premium gate first —
   * that is a pricing decision, not a copy edit.
   */
] as const;

export interface PremiumProfile {
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus | null;
}

export function canAccess(
  feature: PremiumFeature,
  tier: SubscriptionTier,
  status: SubscriptionStatus | null = null
): boolean {
  const access = PREMIUM_FEATURES[feature];
  return isPremiumUser(tier, status) ? access.premium : access.free;
}

export function canAccessProfile(
  feature: PremiumFeature,
  profile: PremiumProfile
): boolean {
  return canAccess(feature, profile.subscription_tier, profile.subscription_status);
}

/** Free users may view country + personal bracket; other scopes need Premium. */
export function canAccessLeaderboardScope(
  scope: string,
  profile: PremiumProfile
): boolean {
  if (scope === "country" || scope === "bracket") return true;
  return canAccessProfile("global_leaderboards", profile);
}

