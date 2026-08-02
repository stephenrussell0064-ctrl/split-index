# Native billing setup (RevenueCat)

Manual, one-time setup required before native (iOS/Android app) purchases work. None of this can be automated — it needs your own Apple Developer, Google Play, and RevenueCat accounts.

## 1. Accounts

- Apple Developer Program (£79/yr) — required to create in-app purchase products in App Store Connect.
- Google Play Console (£19 one-off) — required to create in-app products in Play Console.
- [RevenueCat](https://www.revenuecat.com) account (free tier is fine to start) — the bridge between StoreKit/Play Billing and this app's entitlement records.

## 2. Create the 3 products in each store

Same 3 SKUs as the existing Stripe checkout — monthly, annual, lifetime. Suggested product IDs (must be created identically in both stores):

- `co.uk.splitindex.app.monthly` — auto-renewing subscription
- `co.uk.splitindex.app.annual` — auto-renewing subscription
- `co.uk.splitindex.app.lifetime` — non-consumable (one-time purchase)

Match prices to the existing Stripe prices in `src/lib/pricing/config.ts`.

## 3. RevenueCat project setup

1. Create a RevenueCat project. Add an iOS app and an Android app to it, each linked to the App Store Connect / Play Console apps above.
2. Under **Products**, import the 3 products from each store.
3. Under **Offerings**, create (or use) the `default` offering, and attach the 3 products as packages using RevenueCat's standard package identifiers: `$rc_monthly`, `$rc_annual`, `$rc_lifetime`. These exact identifiers are what `src/lib/native/billing.ts` looks up — no renaming needed on the app's side.
4. Copy the iOS and Android **public API keys** (Project settings → API keys) into env vars:
   - `NEXT_PUBLIC_REVENUECAT_IOS_API_KEY`
   - `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY`

## 4. Webhook

1. In RevenueCat, go to **Integrations → Webhooks** and add: `https://splitindex.co.uk/api/revenuecat/webhook`.
2. Set an authorization header value and put the same value in the `REVENUECAT_WEBHOOK_SECRET` env var (the route checks `Authorization: Bearer <secret>`).
3. Set these env vars to match the product IDs from step 2, if different from the suggested defaults:
   - `REVENUECAT_MONTHLY_PRODUCT_ID`
   - `REVENUECAT_ANNUAL_PRODUCT_ID`
   - `REVENUECAT_LIFETIME_PRODUCT_ID`
4. Use the dashboard's "send test webhook" button to confirm the route returns 200 — `TEST` type events are acknowledged without touching any real profile.

## 5. Database

Apply migration `supabase/migrations/026_native_billing_source.sql` to the live Supabase project (adds `profiles.subscription_source`).

## 6. Verify

- A test purchase in TestFlight / a Play Console internal test track should flip `profiles.subscription_tier` to `premium` with `subscription_source = 'revenuecat'`.
- The existing Stripe path should be unaffected — a Stripe subscriber still shows `subscription_source = 'stripe'` and a RevenueCat `EXPIRATION` event never downgrades a Stripe-sourced entitlement.
