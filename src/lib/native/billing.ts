import {
  Purchases,
  LOG_LEVEL,
  type CustomerInfo,
  type PurchasesEntitlementInfo,
  type PurchasesPackage,
} from "@revenuecat/purchases-capacitor";
import { isNativePlatform, getNativePlatform } from "./platform";
import { mapPurchaseError } from "./billing-errors";
import type { SubscriptionSku } from "@/types";

/**
 * Capacitor-conversion brief, Part 2: native billing via RevenueCat, running
 * alongside (not instead of) the existing Stripe web checkout — Apple/Google
 * both require in-app digital subscriptions to go through their own
 * billing, full stop. This module is the client-side half; the server half
 * is the RevenueCat webhook at /api/revenuecat/webhook, which reconciles the
 * resulting entitlement back into the same profiles.subscription_tier the
 * Stripe webhook already writes to.
 *
 * WHICH ANSWER IS AUTHORITATIVE
 * -----------------------------
 * `hasProEntitlement()` here reads the device's own StoreKit/Play receipt via
 * RevenueCat. It is fast and it is correct about what this person just paid
 * for, which makes it the right thing to unlock UI with in the seconds after a
 * purchase, before the webhook has landed.
 *
 * It is NOT the thing to gate a paid API response on. That stays where it is:
 * `lib/premium/entitlements.ts`, reading columns only the webhooks write. A
 * client can lie about what its receipt says; it cannot lie about what is in
 * `profiles`. Both answers exist on purpose and they are not interchangeable.
 *
 * Requires manual setup only you can do (see docs/native-billing-setup.md):
 * a RevenueCat project + API keys, and matching monthly/annual/lifetime
 * products created in App Store Connect and Google Play Console, attached
 * to a RevenueCat Offering using the package identifiers below.
 */

/**
 * The entitlement identifier configured in the RevenueCat dashboard. All three
 * SKUs — monthly, annual and lifetime — must unlock this same entitlement;
 * that is the entire point of an entitlement, and it is why nothing in the app
 * asks "which product did they buy" to decide whether to show a paid feature.
 */
export const PRO_ENTITLEMENT_ID = "split_index_pro";

/**
 * Package identifiers on the "default" Offering. `$rc_monthly`/`$rc_annual`/
 * `$rc_lifetime` are RevenueCat's own standard identifiers for these exact
 * durations, so no custom naming is needed in the dashboard.
 *
 * The aliases exist because the dashboard lets you attach a custom package id
 * instead, and "yearly" is the obvious thing to type for the annual plan —
 * RevenueCat has no `$rc_yearly`, so a dashboard configured that way would
 * match nothing here and the annual option would silently vanish from the
 * picker with no error anywhere. Matching a small set of spellings costs
 * nothing and removes a failure that is invisible until someone reports that
 * they can only buy monthly.
 */
const SKU_PACKAGE_IDS: Record<SubscriptionSku, readonly string[]> = {
  monthly: ["$rc_monthly", "monthly"],
  annual: ["$rc_annual", "annual", "yearly"],
  lifetime: ["$rc_lifetime", "lifetime"],
};

function findPackage(
  packages: readonly PurchasesPackage[],
  sku: SubscriptionSku
): PurchasesPackage | undefined {
  for (const id of SKU_PACKAGE_IDS[sku]) {
    const match = packages.find((p) => p.identifier === id);
    if (match) return match;
  }
  return undefined;
}

interface ResolvedApiKey {
  key: string;
  /** RevenueCat's Test Store — simulated purchases, no App Store involved. */
  isTestStore: boolean;
}

/**
 * Picks the API key to configure with, and refuses to hand back one that would
 * take the app down.
 *
 * THE HAZARD THIS EXISTS FOR
 * --------------------------
 * A RevenueCat Test Store key (`test_` prefix) makes the SDK serve simulated
 * products instead of talking to StoreKit — genuinely useful before the App
 * Store Connect products exist. But RevenueCat deliberately *crashes the app*
 * if a release build configures with one, to stop test purchases granting real
 * entitlements.
 *
 * That is a live risk in this app specifically, and not a theoretical one: the
 * native shell loads its JavaScript from the production website
 * (capacitor.config.ts `server.url`), so a `test_` key left in the deployed
 * `NEXT_PUBLIC_REVENUECAT_IOS_API_KEY` would not fail on some developer's
 * machine — it would ship to every TestFlight and App Store install at once
 * and crash them on launch.
 *
 * So the test key lives behind its own variable that has to be turned on
 * deliberately, and a `test_` key found in a platform slot is dropped rather
 * than used. Native billing being off is a bad afternoon; the whole app
 * crashing on open is a bad release.
 */
export function resolveApiKey(
  platform: "ios" | "android" | "web",
  env: Record<string, string | undefined> = {
    testStoreEnabled: process.env.NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE,
    testStoreKey: process.env.NEXT_PUBLIC_REVENUECAT_TEST_STORE_API_KEY,
    ios: process.env.NEXT_PUBLIC_REVENUECAT_IOS_API_KEY,
    android: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY,
  }
): ResolvedApiKey | null {
  if (env.testStoreEnabled === "true" && env.testStoreKey) {
    return { key: env.testStoreKey, isTestStore: true };
  }

  const key = platform === "ios" ? env.ios : platform === "android" ? env.android : undefined;
  if (!key) return null;

  if (key.startsWith("test_")) {
    console.error(
      `[revenuecat] A Test Store key is set as the ${platform} production key. RevenueCat crashes release builds configured this way, so it has been ignored. ` +
        `Move it to NEXT_PUBLIC_REVENUECAT_TEST_STORE_API_KEY and set NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE=true.`
    );
    return null;
  }

  return { key, isTestStore: false };
}

let configuredForUserId: string | null = null;
let configuring: Promise<boolean> | null = null;

/**
 * Idempotent — safe to call on every app load once a user is known; a no-op on
 * web. Returns whether the SDK is usable afterwards, so callers can skip the
 * native path rather than letting every later call reject.
 *
 * Concurrent calls share one in-flight promise. Two components mounting in the
 * same tick would otherwise both see `configuredForUserId === null` and both
 * call `configure`, and configuring the SDK twice re-registers its StoreKit
 * transaction observer.
 */
export async function configureRevenueCat(userId: string): Promise<boolean> {
  if (!isNativePlatform()) return false;
  if (configuredForUserId === userId) return true;
  if (configuring) return configuring;

  configuring = (async () => {
    const platform = getNativePlatform();
    const resolved = resolveApiKey(platform);

    if (!resolved) {
      console.warn(
        `[revenuecat] No usable API key for platform "${platform}" — native billing is disabled.`
      );
      return false;
    }

    try {
      // DEBUG in development only: the SDK's debug output includes receipt and
      // product detail, which is noise at best in a production console and
      // reads as a data leak at worst.
      await Purchases.setLogLevel({
        level: process.env.NODE_ENV === "production" ? LOG_LEVEL.WARN : LOG_LEVEL.DEBUG,
      });

      // appUserID is set to the Supabase user id directly ("identified" mode),
      // so the RevenueCat webhook's app_user_id field IS the same id the rest
      // of this app already uses to key the profiles table — no separate
      // mapping table needed between the two systems.
      await Purchases.configure({ apiKey: resolved.key, appUserID: userId });
      configuredForUserId = userId;

      if (resolved.isTestStore) {
        console.warn(
          "[revenuecat] Configured against the RevenueCat Test Store. Purchases are simulated and no real money moves."
        );
      }
      return true;
    } catch (err) {
      console.error("[revenuecat] configure failed", err);
      return false;
    } finally {
      configuring = null;
    }
  })();

  return configuring;
}

/**
 * Points the SDK at a different account without a full reconfigure — for a
 * sign-out/sign-in on the same device. Without this the second person to use
 * the device keeps the first person's appUserID, and their purchases are
 * attributed to the wrong Supabase user.
 */
export async function identifyRevenueCatUser(userId: string): Promise<void> {
  if (!isNativePlatform() || configuredForUserId === null) return;
  if (configuredForUserId === userId) return;

  try {
    await Purchases.logIn({ appUserID: userId });
    configuredForUserId = userId;
  } catch (err) {
    console.error("[revenuecat] logIn failed", err);
  }
}

export interface NativeOfferingPackage {
  sku: SubscriptionSku;
  priceString: string;
  packageIdentifier: string;
}

/** Returns only the SKUs that are actually configured server-side in RevenueCat right now — never assume all 3 exist. */
export async function fetchNativeOfferings(): Promise<NativeOfferingPackage[]> {
  const offerings = await Purchases.getOfferings();
  const current = offerings.current;
  if (!current) return [];

  const result: NativeOfferingPackage[] = [];
  for (const sku of Object.keys(SKU_PACKAGE_IDS) as SubscriptionSku[]) {
    const pkg = findPackage(current.availablePackages, sku);
    if (pkg) {
      result.push({ sku, priceString: pkg.product.priceString, packageIdentifier: pkg.identifier });
    }
  }
  return result;
}

export type PurchaseResult =
  | { ok: true; customerInfo: CustomerInfo | null }
  | {
      ok: false;
      cancelled: boolean;
      /** Awaiting approval — not a failure, and not access either. Yet. */
      pending: boolean;
      /** "Restore purchases" is the action that resolves this one. */
      canRestore: boolean;
      message: string;
    };

export async function purchaseNativeSku(sku: SubscriptionSku): Promise<PurchaseResult> {
  try {
    const offerings = await Purchases.getOfferings();
    const current = offerings.current;
    const pkg = current ? findPackage(current.availablePackages, sku) : undefined;

    if (!pkg) {
      return {
        ok: false,
        cancelled: false,
        pending: false,
        canRestore: false,
        message: "That plan isn't available right now. Please try again shortly.",
      };
    }

    const { customerInfo } = await Purchases.purchasePackage({ aPackage: pkg });
    return { ok: true, customerInfo };
  } catch (err) {
    const mapped = mapPurchaseError(err);
    if (!mapped.cancelled) console.error("[revenuecat] purchase failed", err);
    return {
      ok: false,
      cancelled: mapped.cancelled,
      pending: mapped.pending,
      canRestore: mapped.canRestore,
      message: mapped.message,
    };
  }
}

/** Apple explicitly requires a visible "Restore Purchases" action in any app with in-app purchases — this is that action, not an optional nicety. */
export async function restoreNativePurchases(): Promise<PurchaseResult> {
  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return { ok: true, customerInfo };
  } catch (err) {
    console.error("[revenuecat] restore failed", err);
    const mapped = mapPurchaseError(err);
    return {
      ok: false,
      cancelled: mapped.cancelled,
      pending: false,
      canRestore: false,
      message: mapped.cancelled ? "" : "Could not restore purchases. Please try again.",
    };
  }
}

export interface ProEntitlement {
  active: boolean;
  /** False once auto-renew is switched off, while access itself continues. */
  willRenew: boolean;
  /** NORMAL | INTRO | TRIAL | PREPAID — TRIAL is the one worth showing. */
  periodType: string;
  /** ISO8601, or null for lifetime — which is exactly how lifetime shows up. */
  expirationDate: string | null;
  productIdentifier: string;
  store: string;
  isSandbox: boolean;
}

function toProEntitlement(info: PurchasesEntitlementInfo): ProEntitlement {
  return {
    active: info.isActive,
    willRenew: info.willRenew,
    periodType: info.periodType,
    expirationDate: info.expirationDate,
    productIdentifier: info.productIdentifier,
    store: info.store,
    isSandbox: info.isSandbox,
  };
}

/**
 * The device's own view of the customer record. Null on web, and null if the
 * SDK cannot be reached — never a thrown error, because every caller of this
 * is rendering UI and "we don't know" has to render as "not premium" rather
 * than as a crashed component.
 */
export async function fetchCustomerInfo(): Promise<CustomerInfo | null> {
  if (!isNativePlatform()) return null;
  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (err) {
    console.error("[revenuecat] getCustomerInfo failed", err);
    return null;
  }
}

/**
 * Reads `split_index_pro` off a CustomerInfo. Split out from the fetch so the
 * listener path and the fetch path cannot disagree about what "active" means.
 *
 * `entitlements.active` is RevenueCat's own already-evaluated set — checking
 * membership of it is not the same as reading `entitlements.all[…].isActive`
 * and trusting a date comparison against the device clock, which a user can
 * change.
 */
export function readProEntitlement(info: CustomerInfo | null): ProEntitlement | null {
  const entitlement = info?.entitlements.active[PRO_ENTITLEMENT_ID];
  return entitlement ? toProEntitlement(entitlement) : null;
}

/** Convenience for the common "should this be unlocked on-device right now" question. */
export async function hasProEntitlement(): Promise<boolean> {
  return readProEntitlement(await fetchCustomerInfo()) !== null;
}

export type CustomerInfoUnsubscribe = () => void;

/**
 * Fires whenever RevenueCat's view of this customer changes — a renewal
 * landing, a restore, a purchase made through the paywall, a subscription
 * cancelled from inside the Customer Center, or a StoreKit transaction that
 * finished while the app was backgrounded.
 *
 * This is the only way to notice the last few of those. Polling getCustomerInfo
 * on an interval would hit the network on a timer for an event that arrives
 * maybe twice a year per user.
 */
export async function onCustomerInfoChange(
  handler: (info: CustomerInfo, pro: ProEntitlement | null) => void
): Promise<CustomerInfoUnsubscribe> {
  if (!isNativePlatform()) return () => {};

  try {
    await Purchases.addCustomerInfoUpdateListener((info) => {
      handler(info, readProEntitlement(info));
    });
  } catch (err) {
    console.error("[revenuecat] addCustomerInfoUpdateListener failed", err);
    return () => {};
  }

  // removeAllListeners is the only teardown the Capacitor plugin exposes, and
  // it is plugin-wide. Calling it from one component's cleanup would silently
  // kill every other listener, so the unsubscribe is a no-op by design: this
  // listener is registered once, app-wide, from NativeBillingBootstrap.
  return () => {};
}
