"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Compass, MoreHorizontal, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { LOG_WORKOUT, PRIMARY_NAV } from "@/lib/navigation/app-nav";

/**
 * A one-time "here is how the app is laid out" card at the top of the home
 * page.
 *
 * User feedback: people find the app hard to get around, and the thing that
 * puts them off is not knowing where anything is. The tab bar is five controls
 * and nothing ever says what they are. This says so, once, in the athlete's
 * own first session, and then gets out of the way for good.
 *
 * "Once" is enforced with localStorage, the same way the profile and invite
 * banners are dismissed — but read through `useSyncExternalStore` with a
 * server snapshot that means "don't know yet", the way the daily takeover
 * does. The server cannot see localStorage, so it renders nothing; the client
 * renders the card only if it has never been dismissed. That is a brief
 * appearance after hydration rather than a hydration mismatch, and nobody who
 * has already dismissed it ever sees it flash.
 */

export const GETTING_AROUND_STORAGE_KEY = "split-index-getting-around-dismissed";

type Seen = "unknown" | "show" | "dismissed";

const subscribeToNothing = () => () => {};

const snapshot = (): Seen => {
  try {
    return window.localStorage.getItem(GETTING_AROUND_STORAGE_KEY) ? "dismissed" : "show";
  } catch {
    // Private mode, or storage blocked. Showing a card that can never be
    // dismissed would be worse than not showing it.
    return "dismissed";
  }
};

const serverSnapshot = (): Seen => "unknown";

export function GettingAroundCard() {
  const stored = useSyncExternalStore(subscribeToNothing, snapshot, serverSnapshot);
  const [dismissedNow, setDismissedNow] = useState(false);

  if (stored !== "show" || dismissedNow) return null;

  const dismiss = () => {
    try {
      window.localStorage.setItem(GETTING_AROUND_STORAGE_KEY, "1");
    } catch {
      // Nothing to do — the in-memory flag below still hides it for this visit.
    }
    setDismissedNow(true);
  };

  const Plus = LOG_WORKOUT.icon;

  return (
    <section
      aria-labelledby="getting-around-heading"
      className="relative rounded-2xl border border-accent/20 bg-accent/[0.04] p-4 pr-12"
    >
      <button
        type="button"
        aria-label="Dismiss this guide"
        onClick={dismiss}
        className="absolute right-1 top-1 flex h-11 w-11 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>

      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/15">
          <Compass className="h-4.5 w-4.5 text-accent" />
        </div>
        <div className="min-w-0">
          <h2 id="getting-around-heading" className="text-sm font-semibold">
            New here? This is how the app is laid out
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            Five controls along the bottom of the screen take you everywhere.
          </p>
        </div>
      </div>

      <ul className="mt-3 space-y-1.5 text-xs">
        {PRIMARY_NAV.map((item) => {
          const Icon = item.icon;
          return (
            <li key={item.href} className="flex items-start gap-2">
              <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
              <span>
                <span className="font-semibold text-foreground">{item.label}</span>
                {item.brandName && <span className="text-muted"> ({item.brandName})</span>}
                <span className="text-muted"> — {item.description}</span>
              </span>
            </li>
          );
        })}
        <li className="flex items-start gap-2">
          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">The + button</span>
            <span className="text-muted"> — {LOG_WORKOUT.description}</span>
          </span>
        </li>
        <li className="flex items-start gap-2">
          <MoreHorizontal className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
          <span>
            <span className="font-semibold text-foreground">More</span>
            <span className="text-muted">
              {" "}
              — your plan, recovery, analytics, logbook, social, profile and settings, each with a
              line saying what it is.
            </span>
          </span>
        </li>
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href="/help" className={buttonVariants({ variant: "secondary", size: "sm" })}>
          Open the full guide
        </Link>
        <button type="button" onClick={dismiss} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          Got it
        </button>
      </div>
    </section>
  );
}
