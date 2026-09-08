"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT_GBP } from "@/lib/pricing/config";
import { startStripeCheckout } from "@/lib/stripe/start-checkout";
import { isNativePlatform } from "@/lib/native/platform";
import {
  fetchNativeOfferings,
  purchaseNativeSku,
  restoreNativePurchases,
  type NativeOfferingPackage,
} from "@/lib/native/billing";
import { presentProPaywall } from "@/lib/native/paywall";
import { waitForServerEntitlement } from "@/lib/native/entitlement-settle";
import { PremiumWelcome } from "@/components/pricing/premium-welcome";
import type { SubscriptionSku } from "@/types";

/**
 * Whether the native checkout hands off to the RevenueCat dashboard paywall
 * instead of the inline picker below.
 *
 * Behind a flag rather than always-on because presenting a paywall that has
 * not been built in the dashboard yet returns an error and leaves the athlete
 * with no way to pay at all. Turning this on is the last step of the paywall
 * setup, after the Offering has a paywall attached — see
 * docs/native-billing-setup.md.
 */
const USE_DASHBOARD_PAYWALL = process.env.NEXT_PUBLIC_REVENUECAT_USE_PAYWALL === "true";

const SKUS: Array<{
  sku: SubscriptionSku;
  label: string;
  price: string;
  sub: string;
  badge?: string;
}> = [
  {
    sku: "monthly",
    label: "Monthly",
    price: `£${PRICING.MONTHLY_GBP}/mo`,
    sub: "billed monthly",
  },
  {
    sku: "annual",
    label: "Annual",
    price: `£${PRICING.ANNUAL_GBP}/yr`,
    sub: `just £${ANNUAL_MONTHLY_EQUIVALENT_GBP.toFixed(2)}/mo`,
    badge: "Best value",
  },
  {
    sku: "lifetime",
    label: "Lifetime",
    price: `£${PRICING.LIFETIME_GBP}`,
    sub: "one-time, forever",
  },
];

interface SkuPickerProps {
  ctaLabel?: (sku: SubscriptionSku) => string;
  onError?: (message: string) => void;
  className?: string;
}

export function SkuPicker({ ctaLabel, onError, className }: SkuPickerProps) {
  const [selected, setSelected] = useState<SubscriptionSku>("annual");
  const [loading, setLoading] = useState(false);
  const [nativeOfferings, setNativeOfferings] = useState<NativeOfferingPackage[]>([]);
  const [offeringsLoaded, setOfferingsLoaded] = useState(false);
  const router = useRouter();

  /*
    What replaced `window.location.reload()` on every success path.

    Reloading was wrong twice over. It raced the RevenueCat webhook, so the page
    came back before the server knew about the purchase and the athlete saw the
    paywall they had just paid to leave. And reloading a Capacitor WebView while
    iOS is still restoring the app after the StoreKit sheet often fails the load
    entirely, at which point Capacitor falls back to `errorPath` — someone paid
    and landed on "No connection right now", which is exactly what happened in
    testing.

    So: no reload. Show the confirmation immediately (the purchase is already
    real at this point — Apple has the money and RevenueCat has the receipt),
    poll for the server to catch up behind it, and hand over with
    `router.refresh()`, which re-renders the server components in place without
    the WebView ever navigating.
  */
  const [welcome, setWelcome] = useState<null | "purchase" | "restore">(null);
  const [settling, setSettling] = useState(false);

  const celebrate = async (variant: "purchase" | "restore") => {
    setWelcome(variant);
    setLoading(false);
    setSettling(true);
    await waitForServerEntitlement();
    setSettling(false);
    // Refreshed while the overlay is still up, so the screen behind it is
    // already premium by the time they tap through.
    router.refresh();
  };

  /*
    WHICH BILLING PATH THIS IS, DECIDED BY THE DEVICE — not by a network call.

    `native` used to be state, initialised false and set true only once
    RevenueCat's offerings resolved. That made "is this an iPhone?" the RESULT
    OF A FETCH, and it opened a window between mount and resolution — long
    enough on a cold SDK start, indefinitely long on a flaky connection — in
    which the CTA below fell through to Stripe on a native device. That is App
    Store Guideline 3.1.1, reachable by anyone who taps quickly.

    `isNativePlatform()` is a synchronous property of the runtime, correct from
    the very first render. The offerings fetch stays, but it now does the one
    job it is actually for: fetching localised price strings. It cannot decide
    which store takes the money.

    This is a client component and `isNativePlatform()` reads Capacitor's
    global, so it is evaluated per render rather than hoisted — on the server
    pass it is false, which is correct there too.
  */
  const native = isNativePlatform();

  useEffect(() => {
    if (!native) return;
    fetchNativeOfferings()
      .then(setNativeOfferings)
      .catch(() => setNativeOfferings([]))
      .finally(() => setOfferingsLoaded(true));
  }, [native]);

  const handleCheckout = async () => {
    setLoading(true);
    onError?.("");

    if (native) {
      // The dashboard paywall runs the whole flow itself — selection, purchase,
      // restore — so the SKU chosen above is only a fallback path's input.
      if (USE_DASHBOARD_PAYWALL) {
        const outcome = await presentProPaywall();
        if (outcome.entitled) {
          await celebrate(outcome.via === "restore" ? "restore" : "purchase");
          return;
        }
        // A dismissed paywall is not an error and gets no message; a genuinely
        // failed one does, because otherwise the button just silently stops
        // working and there is nothing on screen to explain it.
        if (outcome.reason === "error") {
          onError?.("Couldn't open checkout. Please try again.");
        }
        setLoading(false);
        return;
      }

      const result = await purchaseNativeSku(selected);
      if (result.ok) {
        await celebrate("purchase");
        return;
      }
      // `pending` is neither: the purchase is alive and awaiting approval, so
      // the message is shown but it is not framed as a failure.
      if (!result.cancelled) onError?.(result.message);
      setLoading(false);
      return;
    }

    // Web only. Deliberately unreachable above: there is no fallback from the
    // native path to this one, so a RevenueCat failure surfaces as an error the
    // athlete can see rather than as a Stripe checkout Apple would reject.
    const result = await startStripeCheckout(selected);
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    onError?.(result.message);
    setLoading(false);
  };

  const nativePriceFor = (sku: SubscriptionSku) =>
    nativeOfferings.find((o) => o.sku === sku)?.priceString;

  const defaultCta = (sku: SubscriptionSku) =>
    sku === "lifetime" ? `Get lifetime access — £${PRICING.LIFETIME_GBP}` : `Start your ${PRICING.TRIAL_DAYS}-day free trial`;

  return (
    <div className={className}>
      {/*
        Rendered over the picker rather than replacing it. The purchase is done
        by the time this appears, so there is nothing behind it left to do —
        but keeping the tree mounted means dismissing it cannot land on a blank
        screen if the refresh is still in flight.
      */}
      {welcome && (
        <PremiumWelcome
          variant={welcome}
          settling={settling}
          onContinue={() => setWelcome(null)}
        />
      )}

      <div className="grid grid-cols-3 gap-3 mb-6">
        {SKUS.map((option) => {
          const isSelected = option.sku === selected;
          return (
            <button
              key={option.sku}
              type="button"
              onClick={() => setSelected(option.sku)}
              className={cn(
                "relative rounded-xl border p-4 text-left transition-colors",
                isSelected
                  ? "border-accent bg-accent/10"
                  : "border-white/10 hover:border-white/20"
              )}
            >
              {option.badge && (
                <span className="absolute -top-2.5 left-3 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-accent-foreground">
                  {option.badge}
                </span>
              )}
              <p className="text-xs uppercase tracking-wide text-muted mb-1">
                {option.label}
              </p>
              <p className="text-lg font-bold">{nativePriceFor(option.sku) ?? option.price}</p>
              <p className="text-xs text-muted mt-0.5">
                {!native && option.sku === "annual" ? (
                  <>
                    <span className="line-through opacity-60">
                      £{PRICING.MONTHLY_GBP}/mo billed monthly
                    </span>{" "}
                    — {option.sub}
                  </>
                ) : (
                  option.sub
                )}
              </p>
            </button>
          );
        })}
      </div>

      {/* Disabled until the store has answered, so a fast tap cannot buy a
          package whose price this screen has not yet shown. */}
      <Button
        className="w-full"
        loading={loading || (native && !offeringsLoaded)}
        disabled={native && !offeringsLoaded}
        onClick={handleCheckout}
      >
        {(ctaLabel ?? defaultCta)(selected)}
      </Button>

      {native && (
        <button
          type="button"
          className="mt-3 w-full text-center text-xs text-muted underline-offset-2 hover:underline"
          onClick={async () => {
            setLoading(true);
            const result = await restoreNativePurchases();
            if (result.ok) {
              await celebrate("restore");
              return;
            }
            onError?.(result.message);
            setLoading(false);
          }}
        >
          Restore purchases
        </button>
      )}

      {/*
        Guideline 3.1.2 requires the purchase surface itself to carry the terms
        of the sale and working links to the EULA and privacy policy. Both were
        reachable from /login, /signup and /support but not from here, which is
        the one place the guideline actually names — a common enough rejection
        that it is worth stating why this block must not be tidied away.

        It sits in SkuPicker rather than in each caller so both paywalls (the
        onboarding score reveal and Settings → Billing) are covered by
        construction, the way the checkout branch itself is.

        Title, duration and price are already disclosed by the SKU buttons
        above, so what is left is the renewal terms and the two links.

        The renewal sentence is conditional because lifetime is a one-time
        purchase — showing "renews automatically" against it would be a false
        statement about the thing being sold, which is worse than showing
        nothing. Only the two auto-renewing SKUs claim to auto-renew.
      */}
      <div className="mt-4 space-y-2 text-center text-[11px] leading-relaxed text-muted">
        {selected !== "lifetime" && (
          <p>
            Your {selected === "annual" ? "annual" : "monthly"} subscription renews
            automatically unless cancelled at least 24 hours before the end of the
            current period. Manage or cancel it any time from Settings.
          </p>
        )}
        <p>
          <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
            Terms of Use
          </Link>
          {" · "}
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  );
}
