"use client";

import { createClient } from "@/lib/supabase/client";

/**
 * Wait for the server to agree that this athlete is premium.
 *
 * WHY THIS EXISTS
 * ---------------
 * A native purchase finishes on the device the moment StoreKit says so. The
 * server does not know yet: `profiles.subscription_tier` is written by the
 * RevenueCat webhook, which is a separate round trip through RevenueCat's
 * servers and lands somewhere between a moment and several seconds later.
 *
 * Every premium surface in this app is gated on the server's answer, so
 * anything that re-renders before the webhook lands shows the athlete the
 * paywall they just paid to leave. The old code called
 * `window.location.reload()` the instant the purchase returned, which lost that
 * race nearly every time — and, worse, reloading a Capacitor WebView while iOS
 * is still bringing the app back to the foreground after the StoreKit sheet
 * frequently fails the load outright and drops the athlete on the offline
 * error page. Paying money and landing on "No connection right now" is the
 * worst screen this app can show.
 *
 * WHAT IT DOES
 * ------------
 * Polls the athlete's own profile row until the tier flips, or the budget runs
 * out. RLS already restricts this to their own row, so it needs no new
 * endpoint and grants no new access.
 *
 * A timeout is NOT a failure and must not be presented as one. The purchase is
 * real — Apple has taken the money and RevenueCat has the receipt — so the only
 * question is whether the webhook has arrived yet. When it hasn't, the honest
 * thing is to let the athlete carry on and let the entitlement appear when it
 * does, not to imply something went wrong.
 */
export type EntitlementSettleResult = "settled" | "timeout" | "unknown";

const POLL_INTERVAL_MS = 1_000;
const DEFAULT_BUDGET_MS = 15_000;

export async function waitForServerEntitlement(
  budgetMs: number = DEFAULT_BUDGET_MS,
): Promise<EntitlementSettleResult> {
  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "unknown";

  const deadline = Date.now() + budgetMs;

  // Checked immediately as well as on each tick: a restore, or a webhook that
  // beat us here, is already settled and should not wait a second for no reason.
  for (;;) {
    const { data, error } = await supabase
      .from("profiles")
      .select("subscription_tier")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!error && data?.subscription_tier === "premium") return "settled";

    if (Date.now() >= deadline) return "timeout";
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
