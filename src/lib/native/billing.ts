import { Purchases } from "@revenuecat/purchases-capacitor";
import { isNativePlatform, getNativePlatform } from "./platform";
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
 * Requires manual setup only you can do (see docs/native-billing-setup.md):
 * a RevenueCat project + API keys, and matching monthly/annual/lifetime
 * products created in App Store Connect and Google Play Console, attached
 * to a RevenueCat Offering using the package identifiers below.
 */

const REVENUECAT_API_KEYS: Record<"ios" | "android", string> = {
  ios: process.env.NEXT_PUBLIC_REVENUECAT_IOS_API_KEY ?? "",
  android: process.env.NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY ?? "",
};

/** Must match the package identifiers attached to the "default" Offering in the RevenueCat dashboard — $rc_monthly/$rc_annual/$rc_lifetime are RevenueCat's own standard package identifiers for these exact durations, so no custom naming is needed on their end. */
const SKU_TO_PACKAGE_ID: Record<SubscriptionSku, string> = {
  monthly: "$rc_monthly",
  annual: "$rc_annual",
  lifetime: "$rc_lifetime",
};

let configuredForUserId: string | null = null;

/** Idempotent — safe to call on every app load once a user is known; a no-op on web. */
export async function configureRevenueCat(userId: string): Promise<void> {
  if (!isNativePlatform() || configuredForUserId === userId) return;

  const platform = getNativePlatform();
  const apiKey = platform === "ios" ? REVENUECAT_API_KEYS.ios : platform === "android" ? REVENUECAT_API_KEYS.android : "";

  if (!apiKey) {
    console.warn(`[revenuecat] No API key configured for platform "${platform}" — native billing is disabled.`);
    return;
  }

  // appUserID is set to the Supabase user id directly ("identified" mode),
  // so the RevenueCat webhook's app_user_id field IS the same id the rest
  // of this app already uses to key the profiles table — no separate
  // mapping table needed between the two systems.
  await Purchases.configure({ apiKey, appUserID: userId });
  configuredForUserId = userId;
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
  for (const [sku, packageId] of Object.entries(SKU_TO_PACKAGE_ID) as [SubscriptionSku, string][]) {
    const pkg = current.availablePackages.find((p) => p.identifier === packageId);
    if (pkg) {
      result.push({ sku, priceString: pkg.product.priceString, packageIdentifier: pkg.identifier });
    }
  }
  return result;
}

export type PurchaseResult = { ok: true } | { ok: false; cancelled: boolean; message: string };

export async function purchaseNativeSku(sku: SubscriptionSku): Promise<PurchaseResult> {
  try {
    const offerings = await Purchases.getOfferings();
    const packageId = SKU_TO_PACKAGE_ID[sku];
    const pkg = offerings.current?.availablePackages.find((p) => p.identifier === packageId);

    if (!pkg) {
      return { ok: false, cancelled: false, message: "That plan isn't available right now. Please try again shortly." };
    }

    await Purchases.purchasePackage({ aPackage: pkg });
    return { ok: true };
  } catch (err) {
    // RevenueCat surfaces user-initiated cancellation as a rejected promise
    // carrying `userCancelled: true` — not a real failure, so callers should
    // stay quiet rather than showing an error toast for it.
    const cancelled = Boolean((err as { userCancelled?: boolean } | undefined)?.userCancelled);
    return {
      ok: false,
      cancelled,
      message: cancelled ? "" : "Purchase failed. Please try again.",
    };
  }
}

/** Apple explicitly requires a visible "Restore Purchases" action in any app with in-app purchases — this is that action, not an optional nicety. */
export async function restoreNativePurchases(): Promise<PurchaseResult> {
  try {
    await Purchases.restorePurchases();
    return { ok: true };
  } catch {
    return { ok: false, cancelled: false, message: "Could not restore purchases. Please try again." };
  }
}
