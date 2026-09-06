import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionSku } from "@/types";

/**
 * Capacitor-conversion brief, Part 2: reconciles native StoreKit/Play
 * Billing entitlements (via RevenueCat) into the same profiles.subscription_*
 * columns the existing Stripe webhook already writes to, so there is one
 * consistent place the rest of the app reads "is this user premium" from —
 * not two disconnected billing systems.
 *
 * RevenueCat authenticates webhooks with a shared secret in the
 * Authorization header (configured in the RevenueCat dashboard, not a
 * signed payload like Stripe's), checked against REVENUECAT_WEBHOOK_SECRET.
 */

const PRODUCT_ID_TO_SKU: Record<string, SubscriptionSku> = {
  [process.env.REVENUECAT_MONTHLY_PRODUCT_ID ?? "co.uk.splitindex.app.monthly"]: "monthly",
  [process.env.REVENUECAT_ANNUAL_PRODUCT_ID ?? "co.uk.splitindex.app.annual"]: "annual",
  [process.env.REVENUECAT_LIFETIME_PRODUCT_ID ?? "co.uk.splitindex.app.lifetime"]: "lifetime",
};

// Entitlement is genuinely active/renewed — grant or keep premium.
const GRANT_EVENT_TYPES = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
  "NON_RENEWING_PURCHASE",
]);

// The subscription has actually lapsed (not just "auto-renew turned off" —
// CANCELLATION alone does NOT mean access ends yet, the entitlement stays
// active until the paid period actually runs out, which is EXPIRATION).
const REVOKE_EVENT_TYPES = new Set(["EXPIRATION"]);

/**
 * The entitlement that means "premium" here. Must match PRO_ENTITLEMENT_ID in
 * lib/native/billing.ts and the identifier configured in the RevenueCat
 * dashboard — all three SKUs unlock this one entitlement.
 */
const PRO_ENTITLEMENT_ID = "split_index_pro";

interface RevenueCatWebhookEvent {
  type: string;
  app_user_id: string;
  product_id?: string;
  /** Which entitlements this event affects. Absent on some event types. */
  entitlement_ids?: string[] | null;
}

/**
 * Whether this event concerns premium access at all.
 *
 * The route used to grant premium for ANY purchase event reaching it, on the
 * assumption that the RevenueCat project only ever sells premium. That holds
 * today and stops holding the first time a second product is added — a one-off
 * coaching add-on, a race entry, a cosmetic — at which point buying it would
 * silently hand over AI Coach and the global leaderboards too.
 *
 * Deliberately permissive when `entitlement_ids` is missing or empty: some
 * event types do not carry the field, and it is far worse to withhold premium
 * from someone who has paid than to grant it for a product that does not exist
 * yet. The check only bites when RevenueCat has positively told us which
 * entitlements are involved and ours is not among them.
 */
function affectsPremium(event: RevenueCatWebhookEvent): boolean {
  const ids = event.entitlement_ids;
  if (!ids || ids.length === 0) return true;
  return ids.includes(PRO_ENTITLEMENT_ID);
}

function verifySecret(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(request: Request) {
  if (!verifySecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as { event?: RevenueCatWebhookEvent };
  const event = body.event;

  if (!event?.type || !event.app_user_id) {
    return NextResponse.json({ error: "Malformed event" }, { status: 400 });
  }

  // Sent when you click "Send test webhook" in the RevenueCat dashboard —
  // acknowledge without touching any real profile.
  if (event.type === "TEST") {
    return NextResponse.json({ received: true });
  }

  // A real event about a product that is not premium. Acknowledge it — a 4xx
  // would make RevenueCat retry an event there is nothing to do about.
  if (!affectsPremium(event)) {
    return NextResponse.json({ received: true, ignored: "not_premium_entitlement" });
  }

  const admin = createAdminClient();
  const userId = event.app_user_id;

  if (GRANT_EVENT_TYPES.has(event.type)) {
    const sku = event.product_id ? (PRODUCT_ID_TO_SKU[event.product_id] ?? null) : null;
    await admin
      .from("profiles")
      .update({
        subscription_tier: "premium",
        subscription_status: "active",
        subscription_sku: sku,
        subscription_source: "revenuecat",
      })
      .eq("user_id", userId);
  } else if (REVOKE_EVENT_TYPES.has(event.type)) {
    // Only downgrade if RevenueCat was actually the system that granted the
    // current entitlement — never let a native expiration clobber a
    // separately-active Stripe web subscription for the same user.
    await admin
      .from("profiles")
      .update({
        subscription_tier: "free",
        subscription_status: "canceled",
        subscription_sku: null,
        subscription_source: null,
      })
      .eq("user_id", userId)
      .eq("subscription_source", "revenuecat");
  }
  // CANCELLATION, BILLING_ISSUE, SUBSCRIPTION_PAUSED, TRANSFER, etc. are
  // intentionally no-ops here — the store's own grace-period handling
  // covers billing issues, and cancellation-without-expiration keeps access
  // exactly as-is until the real EXPIRATION event arrives.

  return NextResponse.json({ received: true });
}
