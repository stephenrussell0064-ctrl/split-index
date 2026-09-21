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

/**
 * N8 — the two premium questions, named, so a call site declares which it is
 * asking.
 *
 * WHAT THE FINDING GOT WRONG
 * --------------------------
 * N8 read the coexistence of `isPremiumUser` and `hasSoftTrialAccess` as an
 * accident — "two entitlement concepts came to coexist without either knowing
 * about the other". They know about each other, and the split is deliberate and
 * documented above: the soft trial is for surfaces where showing the real
 * premium experience up front is the point, and explicitly "not a substitute
 * for real entitlement checks on paid-feature gates like data export or
 * leaderboards".
 *
 * Measured, 2 of 16 sites fold in the soft trial and 14 do not — and that is
 * the intended split, not drift. Migrating all sixteen to one answer, which is
 * what the finding implies, would either give away paid features to every new
 * signup or take the trial away from the dashboard it was built for.
 *
 * WHAT IS ACTUALLY WRONG
 * ----------------------
 * The CHOICE is invisible. Every site writes the expression out, so which
 * question is being asked can only be inferred from whether somebody remembered
 * a second clause. A new page copying the dashboard extends the trial to a paid
 * gate; one copying analytics denies it on a showcase surface. Both look right.
 *
 * These two functions do not change any answer. They give the choice a name, so
 * it is stated at the call site and visible in review.
 */

/*
 * Two parameter types, because the two questions need different columns, and a
 * shared one would have made eleven pages select `created_at` for a function
 * that never reads it. A paid gate asks about the subscription; only the
 * showcase question needs to know when the athlete signed up.
 */
interface SubscriptionSubject {
  subscription_tier: SubscriptionTier;
  subscription_status: SubscriptionStatus | null;
}

interface TrialSubject extends SubscriptionSubject {
  created_at: string;
}

/**
 * For a PAID GATE — data export, leaderboards, the API. Paid subscribers only;
 * a card-less trial does not open these.
 */
export function hasPaidAccess(subject: SubscriptionSubject): boolean {
  return isPremiumUser(subject.subscription_tier, subject.subscription_status);
}

/**
 * For a SHOWCASE surface — the dashboard's trend window, the report view. What
 * the product wants a new athlete to see before they have paid for anything,
 * for the length of the card-less trial.
 */
export function hasShowcaseAccess(subject: TrialSubject): boolean {
  return (
    isPremiumUser(subject.subscription_tier, subject.subscription_status) ||
    hasSoftTrialAccess(
      subject.created_at,
      subject.subscription_tier,
      subject.subscription_status
    )
  );
}
