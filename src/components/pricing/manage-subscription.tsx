"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { canPresentNativePaywall, presentCustomerCenter } from "@/lib/native/paywall";

/**
 * "Manage subscription" for people who already pay — RevenueCat's Customer
 * Center, presented natively over the WebView.
 *
 * WHAT IT REPLACES
 * ----------------
 * Nothing, which is the problem it solves. The billing page showed a premium
 * subscriber a sentence confirming they had access and no action of any kind:
 * no cancel, no plan change, no refund request, no restore. On iOS that is an
 * App Review risk as well as a bad experience — an app selling an auto-renewing
 * subscription is expected to let someone manage it from inside the app.
 *
 * Customer Center also handles the "I paid and it didn't unlock" case, which is
 * the most common billing support email there is, without anyone having to
 * send one.
 *
 * WEB RENDERS NOTHING, DELIBERATELY
 * ---------------------------------
 * Customer Center is a native view. A web subscriber pays through Stripe, and
 * this app has no Stripe billing-portal route to send them to — so rendering a
 * disabled button, or one that goes nowhere, would be worse than rendering
 * nothing. Wiring up the Stripe portal is separate work; this component does
 * not pretend to cover it.
 */
export function ManageSubscription({ className }: { className?: string }) {
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
   * Platform detection reads Capacitor's global, which does not exist during
   * the server render — so the server has to say "not native" and the client
   * has to be free to disagree, without that counting as a hydration mismatch.
   *
   * useSyncExternalStore is the API for exactly this: separate server and
   * client snapshots of a value React does not own. The alternative —
   * setState in an effect — is what the React 19 lint rule forbids, and it
   * would render the button, then unrender it, on every web page load.
   *
   * The subscribe function returns an empty teardown because the answer cannot
   * change: an app does not stop being native while it is running.
   */
  const available = useSyncExternalStore(
    () => () => {},
    canPresentNativePaywall,
    () => false
  );

  if (!available) return null;

  return (
    <div className={className}>
      <Button
        variant="secondary"
        loading={opening}
        onClick={async () => {
          setOpening(true);
          setError(null);
          const opened = await presentCustomerCenter();
          if (!opened) setError("Couldn't open subscription settings. Please try again.");
          setOpening(false);
        }}
      >
        Manage subscription
      </Button>
      {error && <p className="mt-2 text-sm text-warning">{error}</p>}
    </div>
  );
}
