import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/config";
import { PRICING } from "@/lib/pricing/config";
import type { SubscriptionSku } from "@/types";

const SKU_ENV_VAR: Record<SubscriptionSku, string> = {
  monthly: "STRIPE_PRICE_ID_MONTHLY",
  annual: "STRIPE_PRICE_ID_ANNUAL",
  lifetime: "STRIPE_PRICE_ID_LIFETIME",
};

function resolvePriceId(sku: SubscriptionSku): string | undefined {
  // STRIPE_PRICE_ID is the original single-SKU env var — kept as a fallback
  // for "monthly" so existing deployments don't need to rename it.
  return process.env[SKU_ENV_VAR[sku]] ?? (sku === "monthly" ? process.env.STRIPE_PRICE_ID : undefined);
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const sku: SubscriptionSku =
    body.sku === "annual" || body.sku === "lifetime" ? body.sku : "monthly";

  if (!process.env.STRIPE_SECRET_KEY || !resolvePriceId(sku)) {
    console.error(
      `[stripe/checkout] Missing STRIPE_SECRET_KEY or ${SKU_ENV_VAR[sku]}`
    );
    return NextResponse.json(
      {
        error: `Stripe is not configured for the ${sku} plan. Add STRIPE_SECRET_KEY and ${SKU_ENV_VAR[sku]} to .env.local`,
      },
      { status: 503 }
    );
  }

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_customer_id, display_name")
      .eq("user_id", user.id)
      .single();

    const stripe = getStripe();
    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: profile?.display_name ?? undefined,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await supabase
        .from("profiles")
        .update({ stripe_customer_id: customerId })
        .eq("user_id", user.id);
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const priceId = resolvePriceId(sku)!;

    // Lifetime is a one-time payment — no subscription object, no trial.
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: sku === "lifetime" ? "payment" : "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      ...(sku === "lifetime"
        ? { payment_intent_data: { metadata: { supabase_user_id: user.id, sku } } }
        : {
            subscription_data: {
              trial_period_days: PRICING.TRIAL_DAYS,
              metadata: { supabase_user_id: user.id, sku },
            },
          }),
      success_url: `${appUrl}/settings/billing?success=true`,
      cancel_url: `${appUrl}/settings/billing?canceled=true`,
      metadata: { supabase_user_id: user.id, sku },
    });

    if (!session.url) {
      console.error("[stripe/checkout] Stripe returned session without URL");
      return NextResponse.json(
        { error: "Payment failed: checkout session has no URL" },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[stripe/checkout]", err);
    const message =
      err instanceof Error ? err.message : "Unexpected checkout error";
    return NextResponse.json(
      { error: `Payment failed: ${message}` },
      { status: 500 }
    );
  }
}
