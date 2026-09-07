import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe/config";
import Stripe from "stripe";
// Was a second, inline copy of createAdminClient reading
// SUPABASE_SERVICE_ROLE_KEY directly. A duplicated elevated-credential factory
// is one the `server-only` guard and the call-site inventory both miss, which
// is exactly how the tenth call site gets added without anybody noticing.
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const body = await request.text();
  const headersList = await headers();
  const signature = headersList.get("stripe-signature");

  if (!signature) {
    return NextResponse.json({ error: "No signature" }, { status: 400 });
  }

  let event: Stripe.Event;

  try {
    event = getStripe().webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabaseAdmin = createAdminClient();

  /*
    EVERY WRITE IN THIS FILE USED TO BE FIRE-AND-FORGET.

    `await supabaseAdmin.from("profiles").update(...)` with the result thrown
    away, and a 200 returned regardless. So a write that failed — a bad enum
    value, a momentary outage, a row that was not there — looked exactly like a
    write that succeeded: Stripe marked the event delivered, never retried it,
    and nothing was logged. A subscriber whose card failed kept full premium
    forever, and the only evidence was in Stripe's dashboard, not ours.

    Everything now goes through here. A failure returns 500, which is what makes
    Stripe retry with its own backoff, and it is loud in the logs.
  */
  async function applyToProfile(
    userId: string,
    patch: Record<string, unknown>,
    what: string
  ): Promise<Response | null> {
    const { error } = await supabaseAdmin.from("profiles").update(patch).eq("user_id", userId);
    if (error) {
      console.error(`[stripe/webhook] ${what} failed for user ${userId}:`, error);
      // 500 so Stripe redelivers. Returning 200 on a failed write is how a
      // paid subscription silently stops being reflected in the app.
      return NextResponse.json({ error: "Could not apply subscription change" }, { status: 500 });
    }
    return null;
  }

  /**
   * Stripe's status vocabulary is wider than this database's.
   *
   * `subscription.status as "active" | "trialing"` was a cast, not a check, and
   * Stripe also emits `unpaid`, `paused` and `incomplete_expired` — none of
   * which exist in the `subscription_status` enum, so the UPDATE failed on the
   * exact events that should have taken premium away. Mapped explicitly:
   * anything that is not a live, paying state resolves to a status this schema
   * has, and access follows.
   */
  function toStoredStatus(status: string): "trialing" | "active" | "past_due" | "canceled" | "incomplete" {
    switch (status) {
      case "trialing":
      case "active":
      case "past_due":
      case "canceled":
      case "incomplete":
        return status;
      case "unpaid":
      case "paused":
        return "past_due";
      case "incomplete_expired":
        return "incomplete";
      default:
        console.warn(`[stripe/webhook] unrecognised Stripe status "${status}" — storing as canceled`);
        return "canceled";
    }
  }

  /** Statuses that still entitle the athlete to premium. `past_due` does: Stripe is still retrying the card, and cutting access off mid-dunning loses subscribers who would have paid. */
  const ENTITLED = new Set(["trialing", "active", "past_due"]);

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.supabase_user_id;
      const sku = subscription.metadata.sku === "annual" ? "annual" : "monthly";

      if (userId) {
        const status = toStoredStatus(subscription.status);
        const failure = await applyToProfile(
          userId,
          {
            subscription_tier: ENTITLED.has(status) ? "premium" : "free",
            subscription_status: status,
            subscription_sku: ENTITLED.has(status) ? sku : null,
            subscription_source: "stripe",
          },
          `${event.type} (${subscription.status})`
        );
        if (failure) return failure;
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.supabase_user_id;

      if (userId) {
        /*
          Only if Stripe is the source of the CURRENT entitlement.

          Its RevenueCat counterpart already guards this way and Stripe's did
          not. An athlete who cancelled a web subscription and later resubscribed
          through the App Store had their live StoreKit entitlement wiped by the
          delayed cancellation event for the old one — paying Apple, and free in
          the app.
        */
        const { data: current } = await supabaseAdmin
          .from("profiles")
          .select("subscription_source")
          .eq("user_id", userId)
          .maybeSingle();

        if (current && current.subscription_source && current.subscription_source !== "stripe") {
          console.info(
            `[stripe/webhook] ignoring cancellation for ${userId}: entitlement now comes from ${current.subscription_source}`
          );
          break;
        }

        const failure = await applyToProfile(
          userId,
          {
            subscription_tier: "free",
            subscription_status: "canceled",
            subscription_sku: null,
            subscription_source: null,
          },
          "customer.subscription.deleted"
        );
        if (failure) return failure;
      }
      break;
    }
    // Lifetime is a one-time payment — no subscription object, so it's
    // handled off the Checkout Session itself rather than subscription events.
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "payment") break;

      const userId = session.metadata?.supabase_user_id;
      const sku = session.metadata?.sku;
      if (userId && sku === "lifetime") {
        const failure = await applyToProfile(
          userId,
          {
            subscription_tier: "premium",
            subscription_status: "active",
            subscription_sku: "lifetime",
            subscription_source: "stripe",
          },
          "checkout.session.completed (lifetime)"
        );
        if (failure) return failure;
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
