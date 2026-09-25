"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils/cn";
import { LegalLinks } from "@/components/pricing/legal-links";
import { Button } from "@/components/ui/button";
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT_GBP } from "@/lib/pricing/config";
import { restoreNativePurchases } from "@/lib/native/billing";
import { useCheckout } from "@/lib/native/use-checkout";
import { waitForServerEntitlement } from "@/lib/native/entitlement-settle";
import { PremiumWelcome } from "@/components/pricing/premium-welcome";
import type { SubscriptionSku } from "@/types";

/**
 * `sub` is the web subtitle; `nativeSub` is the one shown in the app.
 *
 * They differ because the price above them comes from a different place in each
 * case. On the web we set the price ourselves and it is always GBP, so a
 * sterling per-month equivalent underneath it is accurate. On native the price
 * comes from StoreKit in the viewer's own storefront currency — dollars in the
 * US, euros in Ireland — and the two lines sit close enough together that a
 * reader takes them as one statement about one price.
 *
 * The annual subtitle used to be `just £2.50/mo` in both. On a US storefront
 * that rendered as $34.99/yr above just £2.50/mo: a sterling figure quoted under
 * a dollar price, describing a saving in a currency the buyer is not paying in.
 *
 * So every `nativeSub` must be currency-neutral. `no-currency-in-native-sku-copy.test.ts`
 * enforces that, because the failure is invisible from a UK device — which is
 * every device this was ever tested on.
 */
export const SKUS: Array<{
  sku: SubscriptionSku;
  label: string;
  price: string;
  sub: string;
  nativeSub: string;
  badge?: string;
}> = [
  {
    sku: "monthly",
    label: "Monthly",
    price: `£${PRICING.MONTHLY_GBP}/mo`,
    sub: "billed monthly",
    nativeSub: "billed monthly",
  },
  {
    sku: "annual",
    label: "Annual",
    price: `£${PRICING.ANNUAL_GBP}/yr`,
    sub: `just £${ANNUAL_MONTHLY_EQUIVALENT_GBP.toFixed(2)}/mo`,
    nativeSub: "billed annually",
    badge: "Best value",
  },
  {
    sku: "lifetime",
    label: "Lifetime",
    price: `£${PRICING.LIFETIME_GBP}`,
    sub: "one-time, forever",
    nativeSub: "one-time, forever",
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
  const router = useRouter();

  /*
    WHICH BILLING PATH THIS IS — decided in `useCheckout`, and only there.

    This component used to hold the branch itself, and so did the Settings
    upgrade button. They drifted: SkuPicker was migrated to RevenueCat and the
    Settings copy was forgotten, which left a bare `startStripeCheckout()` in
    the most prominent upgrade button in the app — App Store Guideline 3.1.1,
    on a UK storefront where the 3.1.1(a) external-link carve-out does not
    apply. One decision point is the fix for that, and
    `scripts/check-checkout-single-path.mjs` is what keeps it to one: nothing
    outside `use-checkout.ts` may name a payment entry point.

    `offeringsLoaded` is deliberately not the same question as `resolving`.
    Which rail takes the money is known synchronously and must never wait on a
    fetch — that window was blocker B2. Whether the *price on screen* is the
    store's own does wait on one, and the button below is disabled on it so a
    fast tap cannot buy a package at a price this screen has not shown.
  */
  const { platform, offeringsLoaded, priceFor, checkout } = useCheckout();
  const native = platform === "native";

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

  const handleCheckout = async () => {
    setLoading(true);
    onError?.("");

    const outcome = await checkout(selected);
    switch (outcome.status) {
      case "entitled":
        // `via` comes from the paywall, which is the only thing that knows
        // whether this was a sale or a restore. PremiumWelcome says different
        // words for each.
        await celebrate(outcome.via);
        return;
      case "redirecting":
        window.location.href = outcome.url;
        return;
      case "error":
        onError?.(outcome.message);
        break;
      // A dismissal is not a failure and gets no message. `not-ready` is the
      // platform still resolving: it reaches neither rail, which is the whole
      // point of it, and the button is already disabled while it lasts.
      case "cancelled":
      case "not-ready":
        break;
    }
    setLoading(false);
  };

  const nativePriceFor = priceFor;

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
              {/* Native takes nativeSub, which carries no currency — see SKUS. */}
              <p className="text-xs text-muted mt-0.5">
                {native ? (
                  option.nativeSub
                ) : option.sku === "annual" ? (
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
        <LegalLinks />
      </div>
    </div>
  );
}
