import Stripe from "stripe";

let _stripe: Stripe | null = null;

/** Lazily instantiated so builds don't require STRIPE_SECRET_KEY. */
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: "2026-06-24.dahlia",
      typescript: true,
    });
  }
  return _stripe;
}

/** @deprecated Use PREMIUM_TIER_FEATURES from @/lib/premium/features */
export { PREMIUM_TIER_FEATURES as PREMIUM_FEATURES } from "@/lib/premium/features";

/**
 * No free trial. Premium is bought, not sampled.
 *
 * This was 14 — a card-less grant from the signup date, on top of Stripe's own
 * trial. Removed at the athlete's request on 21 September 2026, not zeroed out
 * of laziness: every surface that advertised "start your 14-day free trial"
 * now offers the subscription directly, so nothing in the app promises a trial
 * the code does not give.
 *
 * Kept as a named zero rather than deleted because `getTrialDaysRemaining` and
 * `hasSoftTrialAccess` are read by the entitlement resolver, and a zero here
 * makes both answer "no trial" arithmetically rather than by a special case
 * somebody could later remove without noticing what it was holding.
 */
export const FREE_TRIAL_DAYS = 0;
export const PREMIUM_PRICE_GBP = 5;
