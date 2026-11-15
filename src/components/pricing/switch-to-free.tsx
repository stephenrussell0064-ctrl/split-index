"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useIsNativeShell } from "@/lib/native/use-is-native-shell";
import type { SubscriptionView } from "@/app/api/stripe/subscription/route";

/**
 * "Switch to free" for a subscriber, on the billing page.
 *
 * Three people can be standing on this screen with premium:
 *
 *   Stripe (web checkout)   — the one this component is for. One tap, one
 *                             confirmation, and Stripe stops billing at the
 *                             end of the paid period. Until then the page
 *                             shows the end date and a "Keep premium" undo.
 *   RevenueCat (App Store)  — in the native shell, ManageSubscription next to
 *                             this already opens Customer Center, so this
 *                             renders nothing there. On the web it says where
 *                             to go instead, because the web has no way to
 *                             reach an Apple subscription.
 *   Hand-granted / lifetime — Stripe has nothing live, nothing to render.
 *
 * It never writes entitlement. The route it calls only talks to Stripe, and
 * the webhook moves the profile to free when the period actually ends — so a
 * cancelled subscriber keeps what they paid for and there is no `reload` here
 * to race the webhook (see no-reload-after-purchase.test.ts).
 *
 * The markup lives in `SwitchToFreeView`, a pure function of its props, so the
 * states can be pinned with renderToStaticMarkup like the rest of the
 * component tests here; `SwitchToFree` only owns the fetch and the state.
 */

export type SwitchToFreeStep = "idle" | "confirming";

export interface SwitchToFreeViewProps {
  view: SubscriptionView;
  native: boolean;
  step: SwitchToFreeStep;
  busy: boolean;
  error: string | null;
  onSwitch: () => void;
  onConfirm: () => void;
  onKeep: () => void;
  onResume: () => void;
  className?: string;
}

function formatEnd(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function SwitchToFreeView({
  view,
  native,
  step,
  busy,
  error,
  onSwitch,
  onConfirm,
  onKeep,
  onResume,
  className,
}: SwitchToFreeViewProps) {
  /*
   * Keyed on what Stripe reports, not on profiles.subscription_source. A
   * profile granted premium by hand has no source and nothing to cancel; a
   * profile Stripe is still billing has a live subscription whatever the row
   * says, and the person being charged is the one who needs this button.
   */
  if (!view.subscription) {
    if (view.source !== "revenuecat" || native) return null;
    return (
      <p className={className ? `${className} text-sm text-muted` : "text-sm text-muted"}>
        You subscribed through the App Store or Google Play, so it can&apos;t be changed from the
        web. To switch to Free, open Split Index on your phone and tap <em>Manage subscription</em>,
        or manage it directly in your{" "}
        <a
          href="https://apps.apple.com/account/subscriptions"
          className="underline hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          Apple subscriptions
        </a>{" "}
        or{" "}
        <a
          href="https://play.google.com/store/account/subscriptions"
          className="underline hover:text-foreground"
          target="_blank"
          rel="noreferrer"
        >
          Google Play subscriptions
        </a>
        .
      </p>
    );
  }

  const endsOn = formatEnd(view.subscription.periodEnd);

  if (view.subscription.cancelAtPeriodEnd) {
    return (
      <div className={className}>
        <p className="text-sm text-muted mb-3">
          {endsOn ? `Premium ends on ${endsOn}.` : "Premium ends at the end of this billing period."}{" "}
          You won&apos;t be charged again.
        </p>
        <Button variant="secondary" loading={busy} onClick={onResume}>
          Keep premium
        </Button>
        {error && <p className="mt-2 text-sm text-warning">{error}</p>}
      </div>
    );
  }

  if (step === "confirming") {
    return (
      <div className={className}>
        <p className="text-sm text-muted mb-3">
          {endsOn
            ? `You keep Premium until ${endsOn}, then move to Free.`
            : "You keep Premium until the end of this billing period, then move to Free."}{" "}
          You won&apos;t be charged again.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" loading={busy} onClick={onConfirm}>
            Confirm switch to free
          </Button>
          <Button variant="ghost" disabled={busy} onClick={onKeep}>
            Keep premium
          </Button>
        </div>
        {error && <p className="mt-2 text-sm text-warning">{error}</p>}
      </div>
    );
  }

  return (
    <div className={className}>
      <Button variant="outline" onClick={onSwitch}>
        Switch to free
      </Button>
    </div>
  );
}

async function readError(res: Response, fallback: string): Promise<string> {
  const text = await res.text();
  try {
    const data = JSON.parse(text) as { error?: string };
    return data.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function SwitchToFree({ className }: { className?: string }) {
  const native = useIsNativeShell();
  const [view, setView] = useState<SubscriptionView | null>(null);
  const [step, setStep] = useState<SwitchToFreeStep>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stripe/subscription")
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        setView((await res.json()) as SubscriptionView);
      })
      .catch(() => {
        // Nothing to show is the right answer when Stripe can't be reached.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const act = async (action: "cancel" | "resume") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/stripe/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setError(await readError(res, `Couldn't update your subscription (${res.status})`));
        return;
      }
      setView((await res.json()) as SubscriptionView);
      setStep("idle");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update your subscription");
    } finally {
      setBusy(false);
    }
  };

  if (!view) return null;

  return (
    <SwitchToFreeView
      view={view}
      native={native}
      step={step}
      busy={busy}
      error={error}
      onSwitch={() => setStep("confirming")}
      onConfirm={() => act("cancel")}
      onKeep={() => {
        setStep("idle");
        setError(null);
      }}
      onResume={() => act("resume")}
      className={className}
    />
  );
}
