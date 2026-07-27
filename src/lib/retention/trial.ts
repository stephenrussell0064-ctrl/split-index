import { FREE_TRIAL_DAYS } from "@/lib/stripe/config";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

export function getTrialDaysRemaining(
  createdAt: string,
  tier: SubscriptionTier,
  status: SubscriptionStatus | null
): number | null {
  if (tier === "premium" && status === "active") return null;
  if (status === "canceled") return null;

  const start = new Date(createdAt).getTime();
  const elapsed = Math.floor((Date.now() - start) / 86400000);
  const remaining = FREE_TRIAL_DAYS - elapsed;
  if (remaining <= 0) return 0;
  return remaining;
}

export function isPremiumUser(
  tier: SubscriptionTier,
  status: SubscriptionStatus | null
): boolean {
  return tier === "premium" && (status === "active" || status === "trialing");
}

/**
 * A card-less trial grant from signup date alone — the same length as
 * Stripe's paid trial, so the pitch stays consistent once it lapses, but
 * requiring no explicit action to activate (Slice D: "make the trial the
 * default rather than something to notice and activate" — most users never
 * touch Settings > Billing, so a trial that only starts there never starts
 * at all). Meant to be folded into a page's own premium check for surfaces
 * where showing the real premium experience up front is the point (e.g. the
 * dashboard's trend window) — not a substitute for real entitlement checks
 * on paid-feature gates like data export or leaderboards.
 */
export function hasSoftTrialAccess(
  createdAt: string,
  tier: SubscriptionTier,
  status: SubscriptionStatus | null
): boolean {
  if (tier === "premium" || status === "canceled") return false;
  const elapsed = Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
  return elapsed < FREE_TRIAL_DAYS;
}
