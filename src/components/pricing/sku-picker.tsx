"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { PRICING, ANNUAL_MONTHLY_EQUIVALENT_GBP } from "@/lib/pricing/config";
import { restoreNativePurchases } from "@/lib/native/billing";
import { useCheckout } from "@/lib/native/use-checkout";
import type { SubscriptionSku } from "@/types";

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

  // Apple and Google both require in-app subscriptions to go through their own
  // billing, so the checkout path branches on platform. That branch lives in
  // `useCheckout` and nowhere else — it used to be duplicated here and in the
  // Settings screen, they drifted, and the Settings copy shipped a Guideline
  // 3.1.1 rejection.
  const { platform, resolving, priceFor, checkout } = useCheckout();
  const native = platform === "native";

  const handleCheckout = async () => {
    setLoading(true);
    onError?.("");

    const outcome = await checkout(selected);
    switch (outcome.status) {
      case "redirecting":
        window.location.href = outcome.url;
        return;
      case "entitled":
        window.location.reload();
        return;
      case "error":
        onError?.(outcome.message);
        break;
      case "not-ready":
      case "cancelled":
        break;
    }
    setLoading(false);
  };

  const nativePriceFor = priceFor;

  const defaultCta = (sku: SubscriptionSku) =>
    sku === "lifetime" ? `Get lifetime access — £${PRICING.LIFETIME_GBP}` : `Start your ${PRICING.TRIAL_DAYS}-day free trial`;

  return (
    <div className={className}>
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

      {/*
        Disabled until the platform is known. Without this the button is live
        during the window where the app has not yet established that it is
        running natively, and a fast tap there took the Stripe path inside the
        native app — a Guideline 3.1.1 rejection triggered by tapping quickly.
      */}
      <Button
        className="w-full"
        loading={loading || resolving}
        disabled={resolving}
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
              window.location.reload();
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
