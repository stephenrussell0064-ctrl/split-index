/**
 * Central pricing/trial constants — single source of truth for all three
 * SKUs, the trial length, and the session-count activation threshold.
 * MONTHLY_GBP mirrors the existing live price (do not change it here without
 * also updating the actual Stripe price and confirming with the business —
 * see PREMIUM_PRICE_GBP in @/lib/stripe/config, which this re-exports from).
 */
import { PREMIUM_PRICE_GBP, FREE_TRIAL_DAYS } from "@/lib/stripe/config";

export const PRICING = {
  MONTHLY_GBP: PREMIUM_PRICE_GBP,
  ANNUAL_GBP: 29.99,
  LIFETIME_GBP: 79.99,
  TRIAL_DAYS: FREE_TRIAL_DAYS,
} as const;

/** Annual framed as a monthly-equivalent for price-anchoring copy on the paywall. */
export const ANNUAL_MONTHLY_EQUIVALENT_GBP = Math.round((PRICING.ANNUAL_GBP / 12) * 100) / 100;

/**
 * Session count at which a skipped trial offer is re-shown as a soft
 * paywall. Lowered from an assumed ~10-session gate — most fitness-app
 * trial starts happen at or near first value, not after a long wait.
 */
export const ACTIVATION_EVENT_SESSION_COUNT = 3;
