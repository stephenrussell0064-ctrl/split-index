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

export const FREE_TIER_FEATURES = [
  "Full workout logging (all paths)",
  "Current Split Index & per-workout cardio index",
  "Last 7 days on dashboard",
  "Rules-based training snippet",
  "Manual entry + CSV import",
  "Country leaderboard preview",
] as const;

export const PREMIUM_TIER_FEATURES = [
  "Full Strength Index with DOTS / IPF GL tiers",
  "Cardio HR accountability (TRIMP, EF, decoupling)",
  "GPT AI Coach after every workout",
  "90-day analytics, projections & period comparison",
  "Global leaderboards & rank percentile",
  "Data export (CSV / JSON)",
  "Strava, Garmin & all OAuth auto-sync",
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

/** Free users may view country-scoped leaderboard only. */
export function canAccessLeaderboardScope(
  scope: string,
  profile: PremiumProfile
): boolean {
  if (scope === "country") return true;
  return canAccessProfile("global_leaderboards", profile);
}
