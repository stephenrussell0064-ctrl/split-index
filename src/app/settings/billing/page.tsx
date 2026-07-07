"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PREMIUM_PRICE_GBP,
  FREE_TRIAL_DAYS,
} from "@/lib/stripe/config";
import { startStripeCheckout } from "@/lib/stripe/start-checkout";
import {
  FREE_TIER_FEATURES,
  PREMIUM_TIER_FEATURES,
} from "@/lib/premium/features";
import { getTrialDaysRemaining, isPremiumUser } from "@/lib/retention/trial";
import { createClient } from "@/lib/supabase/client";
import { ScoreDisclaimer } from "@/components/legal/score-disclaimer";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

function BillingContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get("success");
  const canceled = searchParams.get("canceled");
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    tier: SubscriptionTier;
    status: SubscriptionStatus | null;
    createdAt: string;
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("subscription_tier, subscription_status, created_at")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setProfile({
              tier: data.subscription_tier,
              status: data.subscription_status,
              createdAt: data.created_at,
            });
          }
        });
    });
  }, []);

  const premium = profile
    ? isPremiumUser(profile.tier, profile.status)
    : false;
  const trialDays = profile
    ? getTrialDaysRemaining(profile.createdAt, profile.tier, profile.status)
    : null;

  const handleCheckout = async () => {
    setLoading(true);
    setCheckoutError(null);
    const result = await startStripeCheckout();
    if (result.ok) {
      window.location.href = result.url;
      return;
    }
    setCheckoutError(result.message);
    setLoading(false);
  };

  if (success) {
    return (
      <Card glow="accent">
        <CardContent className="text-center py-8">
          <p className="text-2xl mb-2">Welcome to Premium</p>
          <p className="text-muted text-sm mb-6">
            Your subscription is active. AI coaching and advanced analytics are now unlocked.
          </p>
          <Link href="/dashboard">
            <Button>Go to Dashboard</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      {canceled && (
        <p className="text-sm text-warning mb-4">
          Checkout was canceled. You can try again anytime.
        </p>
      )}

      {trialDays !== null && trialDays > 0 && !premium && (
        <div className="mb-4 rounded-xl border border-accent/20 bg-accent/10 px-4 py-3 text-center">
          <p className="text-sm font-medium text-accent tabular-nums">
            {trialDays} day{trialDays === 1 ? "" : "s"} left in your free trial
          </p>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-6">
        <Card padding="sm">
          <CardHeader className="mb-2">
            <CardTitle className="text-base">Free</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {FREE_TIER_FEATURES.map((f) => (
                <li key={f} className="text-sm text-muted">
                  · {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card glow="accent" padding="sm">
          <CardHeader className="mb-2">
            <CardTitle className="text-base">
              Premium · £{PREMIUM_PRICE_GBP}/mo
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {PREMIUM_TIER_FEATURES.map((f) => (
                <li key={f} className="text-sm flex items-center gap-2">
                  <span className="text-success">✓</span> {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card glow="accent">
        <CardHeader>
          <CardTitle>
            {premium ? "Premium active" : `Start your ${FREE_TRIAL_DAYS}-day trial`}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!premium && (
            <>
              <p className="text-sm text-muted mb-6">
                Cancel anytime. Full access during trial.
              </p>
              {checkoutError && (
                <p className="text-sm text-warning mb-4">{checkoutError}</p>
              )}
              <Button className="w-full" loading={loading} onClick={handleCheckout}>
                Subscribe — £{PREMIUM_PRICE_GBP}/month
              </Button>
              {/*
                Manual premium for testing (Supabase SQL editor):
                UPDATE profiles
                SET subscription_tier = 'premium',
                    subscription_status = 'active'
                WHERE user_id = (SELECT id FROM auth.users WHERE email = 'your@email.com');
              */}
            </>
          )}
          {premium && (
            <p className="text-sm text-muted">
              You have full access to AI Coach, analytics, and leaderboards.
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

export default function BillingPage() {
  return (
    <AppShell>
      <div className="max-w-2xl mx-auto">
        <Link
          href="/settings"
          className="text-sm text-muted hover:text-foreground mb-4 inline-block"
        >
          ← Settings
        </Link>
        <h1 className="text-2xl font-bold mb-6">Billing</h1>
        <Suspense fallback={<div className="text-muted">Loading...</div>}>
          <BillingContent />
        </Suspense>
        <ScoreDisclaimer className="mt-8" variant="compact" />
      </div>
    </AppShell>
  );
}
