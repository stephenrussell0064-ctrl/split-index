import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe/config";
import type { SubscriptionSku, SubscriptionSource } from "@/types";

/**
 * The web subscriber's "switch to free".
 *
 * WHY THIS EXISTS
 * ---------------
 * The billing page told a Stripe subscriber they had premium and gave them no
 * way out of it. Native subscribers got RevenueCat's Customer Center; web
 * subscribers got a sentence. Cancelling meant finding the Stripe dashboard —
 * which an athlete cannot do, and which the person who runs this app had to
 * do by hand for their own test accounts.
 *
 * WHAT IT DOES, AND DOES NOT, TOUCH
 * ---------------------------------
 * It talks to Stripe only. It never writes `profiles.subscription_*`: those
 * columns belong to the webhook, which is the single writer for Stripe state
 * and already handles both halves of what happens here —
 *
 *   cancel  → Stripe sets cancel_at_period_end and emits
 *             customer.subscription.updated with status still `active`, so the
 *             athlete keeps what they paid for until the period ends;
 *   period ends → customer.subscription.deleted → the webhook moves the profile
 *             to free/canceled.
 *
 * Cancelling at period end rather than immediately is deliberate. A trial
 * cancelled this way runs to its end and is never charged; a paid month is not
 * thrown away. "Switch to free" means "stop charging me", not "lock me out now".
 *
 * `resume` undoes a pending cancellation. Stripe allows this right up to the
 * period end, and the billing page offers it so a mis-tap is recoverable
 * without support.
 *
 * WHO IT REFUSES
 * --------------
 * An App Store / Play subscription is between the athlete and Apple or Google;
 * Stripe has never heard of it. Lifetime is a one-off payment with nothing to
 * cancel. Both answer 409 with a sentence the page can show verbatim.
 */

/** Stripe statuses that still entitle the athlete — the webhook's ENTITLED set, in Stripe's vocabulary. */
const LIVE_STATUSES = new Set<Stripe.Subscription.Status>(["active", "trialing", "past_due"]);

export interface SubscriptionView {
  source: SubscriptionSource | null;
  sku: SubscriptionSku | null;
  /** Null when there is nothing in Stripe to act on (native, lifetime, lapsed, or never subscribed). */
  subscription: {
    status: Stripe.Subscription.Status;
    cancelAtPeriodEnd: boolean;
    /** ISO date the current paid period ends — the day premium stops if cancelled. */
    periodEnd: string | null;
  } | null;
}

interface ProfileBilling {
  stripe_customer_id: string | null;
  subscription_source: SubscriptionSource | null;
  subscription_sku: SubscriptionSku | null;
}

type Loaded =
  | { ok: true; userId: string; profile: ProfileBilling }
  | { ok: false; response: NextResponse };

async function loadBilling(): Promise<Loaded> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, subscription_source, subscription_sku")
    .eq("user_id", user.id)
    .maybeSingle();

  return {
    ok: true,
    userId: user.id,
    profile: {
      stripe_customer_id: profile?.stripe_customer_id ?? null,
      subscription_source: profile?.subscription_source ?? null,
      subscription_sku: profile?.subscription_sku ?? null,
    },
  };
}

function toView(profile: ProfileBilling, subscription: Stripe.Subscription | null): SubscriptionView {
  if (!subscription) {
    return { source: profile.subscription_source, sku: profile.subscription_sku, subscription: null };
  }
  /*
   * Since API version 2025-03-31 the period lives on the subscription item,
   * not the subscription. `cancel_at` is set by Stripe when a cancellation is
   * pending and is the authoritative "premium ends on" date in that case.
   */
  const periodEndUnix = subscription.cancel_at ?? subscription.items.data[0]?.current_period_end ?? null;
  return {
    source: profile.subscription_source,
    sku: profile.subscription_sku,
    subscription: {
      status: subscription.status,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
      periodEnd: periodEndUnix ? new Date(periodEndUnix * 1000).toISOString() : null,
    },
  };
}

/** The one subscription Stripe is still billing this customer for, or null. */
async function findLiveSubscription(customerId: string): Promise<Stripe.Subscription | null> {
  const stripe = getStripe();
  const { data } = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
  return data.find((s) => LIVE_STATUSES.has(s.status)) ?? null;
}

/** Why this profile has nothing for Stripe to cancel, as a sentence for the page — or null when it does. */
function notCancellableReason(profile: ProfileBilling): string | null {
  if (profile.subscription_source === "revenuecat") {
    return "This subscription is billed through the App Store or Google Play, so Stripe can't change it. Open Split Index on your phone and tap Manage subscription, or cancel it from your phone's subscription settings.";
  }
  if (profile.subscription_sku === "lifetime") {
    return "Lifetime access is a one-off purchase. There is no subscription to cancel.";
  }
  if (!profile.stripe_customer_id) {
    return "No Stripe subscription found for this account.";
  }
  return null;
}

export async function GET() {
  const loaded = await loadBilling();
  if (!loaded.ok) return loaded.response;
  const { profile } = loaded;

  if (notCancellableReason(profile) || !process.env.STRIPE_SECRET_KEY) {
    return NextResponse.json(toView(profile, null));
  }

  try {
    const subscription = await findLiveSubscription(profile.stripe_customer_id!);
    return NextResponse.json(toView(profile, subscription));
  } catch (err) {
    console.error("[stripe/subscription] GET", err);
    return NextResponse.json({ error: "Couldn't load your subscription from Stripe." }, { status: 502 });
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body.action;
  if (action !== "cancel" && action !== "resume") {
    return NextResponse.json({ error: "action must be 'cancel' or 'resume'" }, { status: 400 });
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error("[stripe/subscription] Missing STRIPE_SECRET_KEY");
    return NextResponse.json({ error: "Stripe is not configured. Add STRIPE_SECRET_KEY to .env.local" }, { status: 503 });
  }

  const loaded = await loadBilling();
  if (!loaded.ok) return loaded.response;
  const { userId, profile } = loaded;

  const reason = notCancellableReason(profile);
  if (reason) {
    return NextResponse.json({ error: reason }, { status: 409 });
  }

  try {
    const live = await findLiveSubscription(profile.stripe_customer_id!);
    if (!live) {
      return NextResponse.json({ error: "No active subscription found to change." }, { status: 404 });
    }

    const wantCancel = action === "cancel";
    const updated =
      live.cancel_at_period_end === wantCancel
        ? live
        : await getStripe().subscriptions.update(live.id, { cancel_at_period_end: wantCancel });

    console.info(`[stripe/subscription] ${action} for ${userId}: ${updated.id} (${updated.status})`);
    return NextResponse.json(toView(profile, updated));
  } catch (err) {
    console.error(`[stripe/subscription] ${action}`, err);
    const message = err instanceof Error ? err.message : "Unexpected Stripe error";
    return NextResponse.json({ error: `Couldn't update your subscription: ${message}` }, { status: 502 });
  }
}
