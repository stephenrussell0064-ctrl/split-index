import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getStripe } from "@/lib/stripe/config";
import Stripe from "stripe";

function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

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
          })
          .eq("user_id", userId);
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
