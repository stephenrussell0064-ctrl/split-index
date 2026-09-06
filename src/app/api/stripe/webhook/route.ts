import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getStripe } from "@/lib/stripe/config";
import { correlationId } from "@/lib/api/errors";
import { logSecurityEvent } from "@/lib/observability/security-log";
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
    /*
     * A webhook that fails signature verification is either a misconfiguration
     * or somebody forging billing events. Both are worth a record, and this is
     * the only signal either produces — the webhook is exempt from rate
     * limiting precisely because the signature is its control.
     */
    logSecurityEvent({
      type: "payment.webhook",
      correlationId: correlationId(),
      source: "/api/stripe/webhook",
      outcome: "denied",
      detail: { reason: "invalid_signature" },
    });
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  logSecurityEvent({
    type: "payment.webhook",
    correlationId: correlationId(),
    source: "/api/stripe/webhook",
    outcome: "allowed",
    // The event type and nothing else. A Stripe event object carries the
    // customer's email and card details.
    detail: { stripeEvent: event.type },
  });

  const supabaseAdmin = createAdminClient();

  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.supabase_user_id;
      const sku = subscription.metadata.sku === "annual" ? "annual" : "monthly";

      if (userId) {
        await supabaseAdmin
          .from("profiles")
          .update({
            subscription_tier: "premium",
            subscription_status: subscription.status as "active" | "trialing",
            subscription_sku: sku,
            subscription_source: "stripe",
          })
          .eq("user_id", userId);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.supabase_user_id;

      if (userId) {
        await supabaseAdmin
          .from("profiles")
          .update({
            subscription_tier: "free",
            subscription_status: "canceled",
            subscription_sku: null,
            subscription_source: null,
          })
          .eq("user_id", userId);
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
        await supabaseAdmin
          .from("profiles")
          .update({
            subscription_tier: "premium",
            subscription_status: "active",
            subscription_sku: "lifetime",
            subscription_source: "stripe",
          })
          .eq("user_id", userId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
