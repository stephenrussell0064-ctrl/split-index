-- Capacitor-conversion brief, Part 2: native billing (StoreKit/Play Billing
-- via RevenueCat) runs alongside the existing Stripe web checkout, not
-- instead of it. subscription_source records which billing system last
-- wrote a given premium status, so the two webhook handlers (Stripe's
-- existing one, and the new RevenueCat one) don't fight each other or
-- silently downgrade an entitlement the other system granted.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS subscription_source TEXT
    CHECK (subscription_source IS NULL OR subscription_source IN ('stripe', 'revenuecat'));

-- Backfill: every existing premium user today got there through Stripe —
-- there is no native billing path yet, so this is unambiguous.
UPDATE profiles
  SET subscription_source = 'stripe'
  WHERE subscription_tier = 'premium' AND subscription_source IS NULL;
