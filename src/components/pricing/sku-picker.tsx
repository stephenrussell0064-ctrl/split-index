"use client";

import { useState } from "react";
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
    </div>
  );
}
