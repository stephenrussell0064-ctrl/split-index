import { RevenueCatUI, PAYWALL_RESULT } from "@revenuecat/purchases-capacitor-ui";
import { isNativePlatform } from "./platform";
import { PRO_ENTITLEMENT_ID } from "./billing";

/**
 * RevenueCat Paywalls and Customer Center — the two screens RevenueCat renders
 * natively, on top of the WebView, rather than as React.
 *
 * WHY NOT JUST USE THE EXISTING SkuPicker
 * ---------------------------------------
 * SkuPicker still exists and still handles the web/Stripe path, which this
 * cannot: these are native views and there is nothing behind them on a desktop
 * browser. What the dashboard paywall buys is the ability to change price
 * presentation, copy, trial framing and layout without an App Store review
 * cycle — a two-week turnaround on a pricing experiment becomes a dashboard
 * edit — plus paywall impression and conversion metrics that the hand-rolled
 * picker does not report to anywhere.
 *
 * WHY CUSTOMER CENTER IS WORTH THE PLUGIN
 * ---------------------------------------
 * Apple requires a way to manage a subscription from inside the app, and the
 * honest version of "manage" includes cancelling. Customer Center handles
 * cancel, refund requests, plan changes and the "I paid and it didn't unlock"
 * path — that last one is the single most common billing support email, and it
 * resolves itself here without anyone writing in.
 *
 * Every function is a no-op that returns a sensible value on web, so callers
 * do not need their own platform check before calling.
 */

export type PaywallOutcome =
  /** Bought or restored inside the paywall — the entitlement is live now. */
  | { entitled: true; via: "purchase" | "restore" }
  /** Dismissed, never shown (already entitled), or failed. */
  | { entitled: false; reason: "cancelled" | "not_presented" | "error" | "unsupported" };

function interpret(result: PAYWALL_RESULT): PaywallOutcome {
  switch (result) {
    case PAYWALL_RESULT.PURCHASED:
      return { entitled: true, via: "purchase" };
    case PAYWALL_RESULT.RESTORED:
      return { entitled: true, via: "restore" };
    case PAYWALL_RESULT.CANCELLED:
      return { entitled: false, reason: "cancelled" };
    // NOT_PRESENTED comes back from presentPaywallIfNeeded when the customer
    // already holds the entitlement. It is a success for the caller — there
    // was nothing to sell — but it is not a *new* entitlement, so it must not
    // be reported as one.
    case PAYWALL_RESULT.NOT_PRESENTED:
      return { entitled: false, reason: "not_presented" };
    default:
      return { entitled: false, reason: "error" };
  }
}

/** True when the native paywall/Customer Center views can actually be shown. */
export function canPresentNativePaywall(): boolean {
  return isNativePlatform();
}

/**
 * Shows the current Offering's paywall as configured in the RevenueCat
 * dashboard. `offeringIdentifier` targets a specific Offering, which is how an
 * A/B test or a win-back offer gets shown to one cohort.
 */
export async function presentProPaywall(): Promise<PaywallOutcome> {
  if (!isNativePlatform()) return { entitled: false, reason: "unsupported" };

  try {
    const { result } = await RevenueCatUI.presentPaywall({ displayCloseButton: true });
    return interpret(result);
  } catch (err) {
    console.error("[revenuecat] presentPaywall failed", err);
    return { entitled: false, reason: "error" };
  }
}

/**
 * Shows the paywall only if this customer does not already hold
 * `split_index_pro`. This is the one to call from a gated feature: it collapses
 * "check entitlement, then decide whether to show a paywall" into a single
 * call that cannot get the check wrong, and it will not interrupt a paying
 * subscriber whose local state happens to be stale.
 */
export async function presentProPaywallIfNeeded(): Promise<PaywallOutcome> {
  if (!isNativePlatform()) return { entitled: false, reason: "unsupported" };

  try {
    const { result } = await RevenueCatUI.presentPaywallIfNeeded({
      requiredEntitlementIdentifier: PRO_ENTITLEMENT_ID,
      displayCloseButton: true,
    });
    return interpret(result);
  } catch (err) {
    console.error("[revenuecat] presentPaywallIfNeeded failed", err);
    return { entitled: false, reason: "error" };
  }
}

/**
 * Opens Customer Center — manage, cancel, request a refund, restore.
 *
 * Returns whether it opened, so a settings screen can fall back to a plain
 * link to the App Store subscriptions page rather than rendering a button that
 * does nothing on web.
 */
export async function presentCustomerCenter(): Promise<boolean> {
  if (!isNativePlatform()) return false;

  try {
    await RevenueCatUI.presentCustomerCenter();
    return true;
  } catch (err) {
    console.error("[revenuecat] presentCustomerCenter failed", err);
    return false;
  }
}
