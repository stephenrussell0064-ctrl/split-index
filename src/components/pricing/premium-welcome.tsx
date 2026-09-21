"use client";

import { useEffect, useState } from "react";
import { Check, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils/cn";

/**
 * What an athlete sees the moment a purchase or restore succeeds.
 *
 * It replaces `window.location.reload()`, which was the entire previous
 * treatment of the most important moment in the app. That had two faults, and
 * the second is the reason this exists rather than a nicer spinner:
 *
 *   1. It raced the RevenueCat webhook, so the page usually came back before
 *      the server knew about the purchase and showed the paywall again.
 *   2. Reloading a Capacitor WebView while iOS is still restoring the app after
 *      the StoreKit sheet often fails the load, and Capacitor falls back to
 *      `errorPath` — so the athlete paid and landed on "No connection right
 *      now".
 *
 * The overlay stays up while `waitForServerEntitlement` polls, which turns that
 * unavoidable wait into something that reads as confirmation rather than as the
 * app hanging. Nothing here is decorative: the wait is real, and this is what
 * makes it legible.
 *
 * `settling` is deliberately not an error state. The purchase is already
 * complete on Apple's side by the time this renders, so a slow webhook must not
 * be dressed up as a problem — the copy stays confident and the button stays
 * enabled throughout.
 */
export interface PremiumWelcomeProps {
  /** True while the server is still catching up. Purely informational. */
  settling: boolean;
  /** Restores read differently from purchases — nobody was just charged. */
  variant?: "purchase" | "restore";
  onContinue: () => void;
  className?: string;
}

const UNLOCKED = [
  "Full Split Index with DOTS and IPF GL tiers",
  "Race predictions from your own pace curve",
  "Injury Risk Index and Interference Radar",
  "90-day trends and 8-week projections",
];

export function PremiumWelcome({
  settling,
  variant = "purchase",
  onContinue,
  className,
}: PremiumWelcomeProps) {
  /*
   * The list animates in on mount rather than on scroll. This overlay is short
   * and appears above the fold in its entirety, so anything gated on an
   * intersection observer would simply never run.
   */
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="premium-welcome-title"
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background/95 px-6 py-10 backdrop-blur-sm",
        className,
      )}
    >
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-gym-accent/15">
          <Sparkles className="h-8 w-8 text-gym-accent" aria-hidden="true" />
        </div>

        <h2 id="premium-welcome-title" className="headline-tight text-2xl font-bold">
          {variant === "restore"
            ? "Your premium is back"
            : "Welcome to Split Index Premium"}
        </h2>

        <p className="mt-2 text-sm text-muted">
          {variant === "restore"
            ? "We found your previous purchase and restored it to this account."
            : "You're all set. Everything below is unlocked from now on."}
        </p>

        <ul className="mt-6 space-y-2.5 text-left">
          {UNLOCKED.map((item, i) => (
            <li
              key={item}
              className={cn(
                "flex items-start gap-2.5 text-sm transition-all duration-300",
                shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
              )}
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <Check className="mt-0.5 h-4 w-4 flex-none text-gym-accent" aria-hidden="true" />
              <span>{item}</span>
            </li>
          ))}
        </ul>

        <Button className="mt-8 w-full" onClick={onContinue}>
          Start exploring
        </Button>

        {/*
          Shown only while the webhook is outstanding, and worded so it cannot
          read as a failure — the money has already changed hands. Continuing is
          allowed throughout; the entitlement lands on its own.
        */}
        <p
          className="mt-3 min-h-[1.25rem] text-xs text-muted"
          aria-live="polite"
        >
          {settling ? "Finishing up — this takes a few seconds." : " "}
        </p>
      </div>
    </div>
  );
}
