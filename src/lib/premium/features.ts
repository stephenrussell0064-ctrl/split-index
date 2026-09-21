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
  | "run_analysis"
  | "hybrid_plan";

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
  /*
   * Per-run analysis: splits, best efforts against the athlete's own history,
   * heart-rate zones and drift, the elevation profile. Paid, because it is the
   * only feature here with a storage cost per session (activity_streams holds
   * the per-sample series, migration 078) and because it is the one thing a
   * runner compares this app against Strava on.
   *
   * What stays free is the run itself: recording it, its distance, duration,
   * average pace, climb and heart rate, its map, and its score. Logging your
   * own training is never paywalled — only the deeper reading of it is.
   */
  run_analysis: { free: false, premium: true },
  /*
   * The Hybrid Plan: one periodised block built toward a named event date.
   *
   * Gated on GENERATION only. A free athlete who already has a block keeps
   * reading it — see the note on the gate in api/hpe/plan. That is the same
   * asymmetry the kill switch relies on, and it exists here for a stronger
   * reason: the plan was free in build 1.0 (5), so anyone mid-block generated
   * theirs under the old terms. Withdrawing a plan somebody is three weeks
   * into is not a paywall, it is a recall.
   */
  hybrid_plan: { free: false, premium: true },
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
  "Hybrid Plan — one periodised block built toward your event date, across lifting and endurance together",
  "Run, ride and walk analysis — splits, best efforts, heart-rate zones and elevation for every GPS session",
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
   * "Multi-goal hybrid training plan across every sport" used to sit here. It
   * named the multi-goal weekly balancer specifically — the product whose page
   * was removed and whose API is now retired — so it was deleted rather than
   * reworded. Billing and the marketing pricing panel both render this list
   * verbatim, and leaving it would have gone on selling a removed feature to
   * paying subscribers.
   *
   * The Hybrid Plan line at the top of this list is NOT that feature returning
   * under a new name. It is a different product, and it is named here only
   * because the pricing decision that was outstanding has now been made: the
   * premium gate went in on 21 Sep 2026, after App Store approval closed the
   * Guideline 2.1 review that required it to stay free. The rollout flag
   * (hpe/rollout.ts) still decides eligibility separately — a subscriber
   * outside the rollout cannot generate either, which is why the gate is
   * checked AFTER the rollout dial rather than before it.
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

