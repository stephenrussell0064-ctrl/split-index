# Native billing setup (RevenueCat)

Manual, one-time setup required before native (iOS/Android app) purchases work. None of this can be automated — it needs your own Apple Developer, Google Play, and RevenueCat accounts.

The code side is done: `@revenuecat/purchases-capacitor` and `@revenuecat/purchases-capacitor-ui` are installed and registered in both native projects, and the client lives in `src/lib/native/billing.ts` (SDK, entitlements, customer info) and `src/lib/native/paywall.ts` (Paywall, Customer Center).

> **This app has no native SwiftUI purchase code, and must not gain any.** The Capacitor plugin already vendors `purchases-ios-spm` via `purchases-hybrid-common`. Adding the RevenueCat Swift Package directly to `ios/App` would link a second copy of the same SDK, with a second `Purchases.configure()` and duplicate StoreKit transaction observers — which breaks purchases rather than adding them. Everything below is driven from TypeScript.

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
3. Under **Entitlements**, create one entitlement with the identifier **`split_index_pro`** and attach **all three** products to it. One entitlement for all three durations is the point — nothing in the app asks "which product did they buy" to decide whether to show a paid feature. This identifier appears in exactly two places in the code (`PRO_ENTITLEMENT_ID` in `src/lib/native/billing.ts` and in the webhook route); if you name it something else in the dashboard, change both.
4. Under **Offerings**, create (or use) the `default` offering, and attach the 3 products as packages using RevenueCat's standard package identifiers: `$rc_monthly`, `$rc_annual`, `$rc_lifetime`. Custom identifiers `monthly` / `annual` / `yearly` / `lifetime` are also recognised — RevenueCat has no `$rc_yearly`, so the annual plan is matched on any of those spellings rather than silently disappearing from the picker.
5. Copy the iOS and Android **public API keys** (Project settings → API keys) into env vars:
   - `NEXT_PUBLIC_REVENUECAT_IOS_API_KEY` (starts `appl_`)
   - `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY` (starts `goog_`)

## 4. Test Store (optional, for developing before the store products exist)

RevenueCat's Test Store serves simulated products so you can exercise the whole flow with no App Store Connect setup. Its key starts `test_`.

**Never put a `test_` key in the two variables above.** RevenueCat deliberately crashes release builds configured with one, to stop simulated purchases granting real entitlements. Because the native shell loads its JavaScript from the production site (`server.url` in `capacitor.config.ts`), a `test_` key in the deployed production env would not fail on one machine — it would ship to every installed app at once and crash them on launch.

`resolveApiKey` in `src/lib/native/billing.ts` refuses a `test_` key found in a platform slot and logs why. To use the Test Store, set both:

```
NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE=true
NEXT_PUBLIC_REVENUECAT_TEST_STORE_API_KEY=test_your-test-store-key
```

Only the exact string `true` enables it, so a half-configured environment cannot ship a test key.

## 5. Paywall (RevenueCat Paywalls)

1. In RevenueCat, go to **Paywalls**, and build a paywall attached to the `default` Offering.
2. Once it exists, set `NEXT_PUBLIC_REVENUECAT_USE_PAYWALL=true`. Native checkout then hands off to the dashboard paywall (`presentPaywall`) instead of the built-in `SkuPicker` grid.

The flag exists because presenting a paywall that has not been built returns an error, which would leave someone in the app with no way to pay at all. Turn it on last. With it off, the existing inline picker keeps working exactly as before.

`presentProPaywallIfNeeded()` is also available for gating a specific feature: it checks `split_index_pro` and only presents if the entitlement is missing, so it will never interrupt a paying subscriber.

## 6. Customer Center

Nothing to configure in code — `ManageSubscription` on `/settings/billing` calls `RevenueCatUI.presentCustomerCenter()` and appears for premium subscribers on native only. Customise the screens under **Customer Center** in the RevenueCat dashboard.

This is also the app's answer to Apple's expectation that an auto-renewing subscription can be managed (including cancelled) from inside the app. Note the gap it does not close: a **web** subscriber pays through Stripe and this app has no Stripe billing-portal route, so they still have no in-app management. That is separate work.

## 7. Webhook

1. In RevenueCat, go to **Integrations → Webhooks** and add: `https://splitindex.co.uk/api/revenuecat/webhook`.
2. Set an authorization header value and put the same value in the `REVENUECAT_WEBHOOK_SECRET` env var (the route checks `Authorization: Bearer <secret>`).
3. Set these env vars to match the product IDs from step 2, if different from the suggested defaults:
   - `REVENUECAT_MONTHLY_PRODUCT_ID`
   - `REVENUECAT_ANNUAL_PRODUCT_ID`
   - `REVENUECAT_LIFETIME_PRODUCT_ID`
4. Use the dashboard's "send test webhook" button to confirm the route returns 200 — `TEST` type events are acknowledged without touching any real profile.

The route ignores events whose `entitlement_ids` name only entitlements other than `split_index_pro`, so adding a second, non-premium product later cannot accidentally grant premium. Events with no `entitlement_ids` still grant, deliberately — withholding access from someone who paid is the worse failure.

## 8. Database

Apply migration `supabase/migrations/026_native_billing_source.sql` to the live Supabase project (adds `profiles.subscription_source`).

## 9. Which entitlement answer is authoritative

Two exist on purpose and they are not interchangeable:

- **`hasProEntitlement()`** (`lib/native/billing.ts`) reads the device's own receipt through RevenueCat. Fast, and correct about what this person just paid for — so it is the right thing to unlock UI with in the seconds after a purchase, before the webhook lands. **Never gate a paid API response on it**; a client can lie about its receipt.
- **`getEntitlements()`** (`lib/premium/entitlements.ts`) reads `profiles` columns that only the Stripe and RevenueCat webhooks write. This is what every server-side paid gate uses, and it stays that way.

`NativeBillingBootstrap` bridges the two: it holds the app-wide `CustomerInfo` listener and reloads the page when access is *gained* outside the app (a renewal, a restore, a resubscribe from Customer Center), so the server re-reads the now-updated profile. It deliberately does not reload when access is lost — the server gate already refuses the work on the next request, and yanking the page out from under someone mid-session is hostile.

## 10. Verify

- A test purchase in TestFlight / a Play Console internal test track should flip `profiles.subscription_tier` to `premium` with `subscription_source = 'revenuecat'`.
- The existing Stripe path should be unaffected — a Stripe subscriber still shows `subscription_source = 'stripe'` and a RevenueCat `EXPIRATION` event never downgrades a Stripe-sourced entitlement.
- Cancelling in Customer Center should produce a `CANCELLATION` event that changes nothing, then an `EXPIRATION` at period end that downgrades.
- After changing plugins, run `npx cap sync ios` (and `android`) so the native projects pick them up.
