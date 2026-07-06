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
