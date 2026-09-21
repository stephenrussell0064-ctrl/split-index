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

export const FREE_TRIAL_DAYS = 14;
export const PREMIUM_PRICE_GBP = 5;
