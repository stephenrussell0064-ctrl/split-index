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
  | "manual_logging"
  | "training_plan_multi_goal";

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
  training_plan_multi_goal: { free: false, premium: true },
};

/**
 * Training Plan (user feedback: "Make this part of the premium feature and
 * they can get a small training plan trial but they won't benefit properly
 * unless they have premium.") Free users can still run the whole goal-
 * setup wizard and see it work — just capped to one goal and a narrower
 * weekly-session range, so the plan can never actually balance across
 * multiple competing goals (the entire point of the feature) without
 * Premium. Centralized here rather than duplicated between the API route
 * and the wizard UI.
 */
export const MAX_FREE_TRAINING_GOALS = 1;
export const MAX_FREE_WEEKLY_CAPACITY = 4;
export const MAX_PREMIUM_WEEKLY_CAPACITY = 14;

export const FREE_TIER_FEATURES = [
  "Full workout logging (all paths)",
  "Current Split Index & per-workout cardio index",
  "Last 7 days on dashboard",
  "Rules-based training snippet",
  "Manual entry + CSV import",
  "Country leaderboard preview",
  "Training plan (1 goal)",
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
  "Multi-goal hybrid training plan across every sport",
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

/**
 * Splits an athlete's goal rows (any order, already sorted oldest-first by
 * the caller) into the ones that actually feed the balanced weekly plan
 * vs. the ones locked behind Premium. Extracted out of the API route so
 * this gating rule — the one piece of Training Plan behavior with real
 * money attached to it — has its own test coverage instead of only being
 * exercised implicitly through a full request. Premium: everything is
 * included, nothing is locked. Free: first `maxFreeGoals` (by whatever
 * order the caller already sorted, e.g. creation order) are included, the
 * rest are locked — never dropped.
 */
export function splitGoalsByPremiumLimit<T>(
  rows: T[],
  premium: boolean,
  maxFreeGoals: number
): { included: T[]; locked: T[] } {
  if (premium) return { included: rows, locked: [] };
  return { included: rows.slice(0, maxFreeGoals), locked: rows.slice(maxFreeGoals) };
}
