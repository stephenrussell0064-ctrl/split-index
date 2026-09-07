"use client";

import { useCallback, useEffect, useState } from "react";
import { isNativePlatform } from "@/lib/native/platform";
import {
  fetchNativeOfferings,
  purchaseNativeSku,
  type NativeOfferingPackage,
} from "@/lib/native/billing";
import { presentProPaywall } from "@/lib/native/paywall";
import { startStripeCheckout } from "@/lib/stripe/start-checkout";
import type { SubscriptionSku } from "@/types";

/**
 * The one place that decides whether a purchase goes through Apple/Google or
 * through Stripe.
 *
 * It exists because that decision was previously made in two places and they
 * drifted. `SkuPicker` was moved onto RevenueCat; the Settings screen was not,
 * and kept a bare `startStripeCheckout()` — an App Store Guideline 3.1.1
 * rejection sitting in the most prominent upgrade button in the app, on a UK
 * storefront where the 3.1.1(a) external-link carve-out does not apply. A
 * second copy of this branch is how that happened, so there is now one.
 *
 * ## Why there are three platform states and not two
 *
 * The old code held `native` as a boolean initialised to `false` and set to
 * `true` inside an async `.then()`. Between mount and that promise resolving,
 * "we haven't checked yet" and "this is the web" were the same value, so a tap
 * inside that window took the Stripe branch **inside the native app**. The
 * window is short. App Review taps fast, and a reviewer on a slow network taps
 * during exactly that window.
 *
 * So the state is `"checking" | "native" | "web"`, it starts at `"checking"`,
 * and `checkout()` refuses to do anything until it resolves. Note also that
 * the platform is decided *synchronously* inside the effect — `isNativePlatform()`
 * returns immediately — and only the offerings fetch is awaited. A failed
 * offerings fetch therefore leaves the platform as `"native"`, which is the
 * safe direction: worst case the native purchase fails with a message, rather
 * than silently falling back to a payment method Apple rejects the app for.
 *
 * The initial value is `"checking"` rather than a lazy `isNativePlatform()`
 * call because this component server-renders, where Capacitor reports web —
 * a lazy initialiser would hydrate the native app with `"web"` already latched.
 */
export type CheckoutPlatform = "checking" | "native" | "web";

/** Whether the native checkout hands off to RevenueCat's own dashboard paywall. */
const USE_DASHBOARD_PAYWALL =
  process.env.NEXT_PUBLIC_REVENUECAT_USE_PAYWALL === "true";

export type CheckoutOutcome =
  | { status: "redirecting"; url: string }
  | { status: "entitled" }
  | { status: "cancelled" }
  | { status: "error"; message: string }
  | { status: "not-ready" };

export interface UseCheckout {
  platform: CheckoutPlatform;
  /** True until we know which billing rail applies. Disable purchase UI on it. */
  resolving: boolean;
  offerings: NativeOfferingPackage[];
  /** Localised store price for a SKU, when the store gave us one. */
  priceFor: (sku: SubscriptionSku) => string | undefined;
  checkout: (sku?: SubscriptionSku) => Promise<CheckoutOutcome>;
}

/**
 * Which billing rail a purchase takes, as a pure function of the platform.
 *
 * Split out of the hook so it can be tested without a React renderer — the two
 * App Store blockers this closes were both invisible to the type checker and
 * to every existing test, so the routing decision needs tests that do not
 * depend on a testing library the project does not have.
 */
export async function performCheckout(
  platform: CheckoutPlatform,
  sku: SubscriptionSku = "annual",
): Promise<CheckoutOutcome> {
  // Not "not decided yet, assume web". That assumption was blocker B2.
  if (platform === "checking") return { status: "not-ready" };

  if (platform === "native") {
    if (USE_DASHBOARD_PAYWALL) {
      const outcome = await presentProPaywall();
      if (outcome.entitled) return { status: "entitled" };
      // A dismissed paywall is not a failure and gets no message; a genuinely
      // failed one does, or the button just stops working with nothing on
      // screen to explain it.
      return outcome.reason === "error"
        ? { status: "error", message: "Couldn't open checkout. Please try again." }
        : { status: "cancelled" };
    }

    const result = await purchaseNativeSku(sku);
    if (result.ok) return { status: "entitled" };
    if (result.cancelled) return { status: "cancelled" };
    // `pending` is neither success nor failure — the purchase is alive and
    // awaiting approval — so its message is surfaced without being framed as
    // an error the athlete has to fix.
    return { status: "error", message: result.message };
  }

  const result = await startStripeCheckout(sku);
  return result.ok
    ? { status: "redirecting", url: result.url }
    : { status: "error", message: result.message };
}

/**
 * Resolve the platform without waiting on the network.
 *
 * `isNativePlatform()` answers immediately; only the offerings fetch is slow.
 * Deciding here rather than in the fetch's `.then()` is what closes the window
 * B2 lived in.
 */
export function resolvePlatform(): CheckoutPlatform {
  return isNativePlatform() ? "native" : "web";
}

export function useCheckout(): UseCheckout {
  const [platform, setPlatform] = useState<CheckoutPlatform>("checking");
  const [offerings, setOfferings] = useState<NativeOfferingPackage[]>([]);

  useEffect(() => {
    const resolved = resolvePlatform();
    setPlatform(resolved);
    if (resolved !== "native") return;

    fetchNativeOfferings()
      .then(setOfferings)
      .catch(() => {
        // Prices fall back to the configured ones; the rail does not change.
        // Failing open to Stripe here would be the rejection we are avoiding.
      });
  }, []);

  const checkout = useCallback(
    (sku: SubscriptionSku = "annual") => performCheckout(platform, sku),
    [platform],
  );

  const priceFor = useCallback(
    (sku: SubscriptionSku) => offerings.find((o) => o.sku === sku)?.priceString,
    [offerings],
  );

  return {
    platform,
    resolving: platform === "checking",
    offerings,
    priceFor,
    checkout,
  };
}
