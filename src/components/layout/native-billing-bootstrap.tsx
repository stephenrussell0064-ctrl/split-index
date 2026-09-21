"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  configureRevenueCat,
  identifyRevenueCatUser,
  onCustomerInfoChange,
} from "@/lib/native/billing";

/**
 * Capacitor-conversion brief, Part 2 — configures RevenueCat once per
 * session as soon as the logged-in user is known, using their Supabase
 * user id as RevenueCat's own appUserID (see billing.ts). Renders nothing;
 * a no-op entirely on web (configureRevenueCat checks isNativePlatform()
 * itself before doing anything).
 *
 * It also owns the single app-wide CustomerInfo listener. That listener is what
 * closes a gap the webhook alone cannot: a renewal or a cancellation that
 * happens outside the app — in iOS Settings, or in Customer Center — changes
 * the entitlement on the device immediately, while `profiles.subscription_tier`
 * only catches up when RevenueCat's webhook arrives. Without this, someone who
 * just resubscribed sits looking at an upgrade prompt until they think to kill
 * the app and reopen it.
 *
 * The reload is deliberately one-directional: it fires when access is GAINED,
 * never when it is lost. Yanking the page out from under someone mid-session
 * because their card expired is both hostile and pointless — the server-side
 * gate in lib/premium/entitlements.ts already refuses the paid work on the
 * next request either way.
 */
export function NativeBillingBootstrap() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();

    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;

      const ready = await configureRevenueCat(user.id);
      if (cancelled || !ready) return;

      let wasEntitled: boolean | null = null;
      await onCustomerInfoChange((_info, pro) => {
        const entitled = pro !== null;
        // The listener fires once on registration with current state; that
        // first call establishes the baseline rather than counting as a change.
        if (wasEntitled !== null && entitled && !wasEntitled) {
          /*
           * `router.refresh()` rather than `window.location.reload()`.
           *
           * This listener fires the moment RevenueCat sees an entitlement, and
           * the most common way for that to happen is a purchase — which means
           * iOS may still be restoring the app after dismissing the StoreKit
           * sheet. Reloading a Capacitor WebView in that window frequently
           * fails the load, and Capacitor falls back to `errorPath`: the
           * athlete pays and lands on "No connection right now". Seen for real
           * in sandbox testing.
           *
           * A refresh re-renders the server components in place, so the app
           * never navigates and there is no load to fail. It also does not
           * throw away the screen someone was on, which matters here because
           * this can fire from anywhere in the app — a renewal or a restore on
           * another device, not just a purchase in front of them.
           */
          router.refresh();
        }
        wasEntitled = entitled;
      });
    })();

    // A sign-out/sign-in on the same device has to move RevenueCat's appUserID
    // with it, or the second person's purchases are attributed to the first
    // person's Supabase id and the webhook writes premium onto the wrong row.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) void identifyRevenueCatUser(session.user.id);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
    // `router` is stable for the life of the app, and this effect must run
    // exactly once — it configures the SDK and registers the single app-wide
    // CustomerInfo listener. Re-running it would register a second listener.
  }, [router]);

  return null;
}
