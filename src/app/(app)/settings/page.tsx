"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CreditCard,
  User,
  Download,
  LogOut,
  Shield,
  Plug,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { IMPORT_SOURCES } from "@/lib/constants/sports";
import {
  PREMIUM_FEATURES,
  PREMIUM_PRICE_GBP,
  FREE_TRIAL_DAYS,
} from "@/lib/stripe/config";
import { startStripeCheckout } from "@/lib/stripe/start-checkout";
import { FREE_TIER_FEATURES } from "@/lib/retention/tiers";
import { getTrialDaysRemaining, isPremiumUser } from "@/lib/retention/trial";
import { SplitIndexSettings } from "@/components/settings/split-index-settings";
import { PremiumBadge } from "@/components/retention/premium-badge";
import { createClient } from "@/lib/supabase/client";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [recomputeLoading, setRecomputeLoading] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<string | null>(null);
  const [profile, setProfile] = useState<{
    tier: SubscriptionTier;
    status: SubscriptionStatus | null;
    createdAt: string;
    userId: string;
    splitEnduranceWeight: number;
  } | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      supabase
        .from("profiles")
        .select("subscription_tier, subscription_status, created_at, split_endurance_weight, user_id")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          if (data) {
            setProfile({
              tier: data.subscription_tier,
              status: data.subscription_status,
              createdAt: data.created_at,
              userId: data.user_id,
              splitEnduranceWeight:
                typeof data.split_endurance_weight === "number"
                  ? data.split_endurance_weight
                  : 0.5,
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

  const connectedSources = IMPORT_SOURCES.filter((s) => s.status === "available");
  const comingSoonSources = IMPORT_SOURCES.filter((s) => s.status !== "available");

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

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/");
  };

  const handleRecomputeScores = async () => {
    setRecomputeLoading(true);
    setRecomputeResult(null);
    try {
      const res = await fetch("/api/activities/recompute", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRecomputeResult(data.error ?? "Failed to recompute scores.");
        return;
      }
      setRecomputeResult(
        `Recomputed ${data.recomputed} of ${data.total} activities` +
          (data.failed > 0 ? ` (${data.failed} failed).` : ".")
      );
    } catch {
      setRecomputeResult("Failed to recompute scores. Please try again.");
    } finally {
      setRecomputeLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    const confirmed = window.confirm(
      "Delete your account permanently? All workouts, scores, and profile data will be removed. This cannot be undone."
    );
    if (!confirmed) return;

    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setDeleteError(data.error ?? "Failed to delete account");
        return;
      }
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/");
    } catch {
      setDeleteError("Failed to delete account. Please try again.");
    } finally {
      setDeleteLoading(false);
    }
  };

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted text-sm mt-1">
          Profile, subscription, integrations, and account
        </p>
      </div>

      {/* Profile */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-accent" />
            <CardTitle>Profile</CardTitle>
            {premium && <PremiumBadge />}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Link href="/profile">
            <Button variant="secondary" className="w-full">
              Edit profile & stats
            </Button>
          </Link>
          <Link href="/onboarding">
            <Button variant="ghost" className="w-full">
              Redo onboarding
            </Button>
          </Link>
        </CardContent>
      </Card>

      {profile && (
        <SplitIndexSettings
          initialEnduranceWeight={profile.splitEnduranceWeight}
          userId={profile.userId}
        />
      )}

      {/* Subscription */}
      <Card glow={premium ? undefined : "accent"}>
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-accent" />
              <CardTitle>Subscription</CardTitle>
            </div>
            {trialDays !== null && trialDays > 0 && !premium && (
              <span className="rounded-full bg-accent/15 px-2.5 py-1 text-xs font-medium text-accent tabular-nums">
                {trialDays} day{trialDays === 1 ? "" : "s"} left in trial
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {premium ? (
            <div className="space-y-3">
              <p className="text-sm text-muted">
                Premium active — AI Coach, full analytics, and leaderboards unlocked.
              </p>
              <Link href="/settings/billing">
                <Button variant="secondary" className="w-full">
                  Manage billing
                </Button>
              </Link>
            </div>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 gap-4 mb-6">
                <div className="rounded-xl border border-white/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted mb-2">
                    Free
                  </p>
                  <ul className="space-y-1.5">
                    {FREE_TIER_FEATURES.map((f) => (
                      <li key={f} className="text-xs text-muted">
                        · {f}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-accent/20 bg-accent/5 p-4">
                  <p className="text-xs font-medium uppercase tracking-wider text-accent mb-2">
                    Premium · £{PREMIUM_PRICE_GBP}/mo
                  </p>
                  <ul className="space-y-1.5">
                    {PREMIUM_FEATURES.slice(0, 4).map((f) => (
                      <li key={f} className="text-xs flex items-center gap-1.5">
                        <Shield className="h-3 w-3 text-success shrink-0" />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
              <p className="text-xs text-muted mb-4">
                {FREE_TRIAL_DAYS}-day free trial · cancel anytime
              </p>
              {checkoutError && (
                <p className="text-sm text-warning mb-4">{checkoutError}</p>
              )}
              <Button className="w-full" loading={loading} onClick={handleCheckout}>
                Start {FREE_TRIAL_DAYS}-Day Free Trial
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Integrations */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Plug className="h-4 w-4 text-endurance" />
            <CardTitle>Integrations</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {connectedSources.map((source) => (
              <button
                key={source.id}
                type="button"
                className="glass rounded-xl p-4 text-left text-sm transition-colors hover:bg-white/5"
              >
                <p className="font-medium">{source.name}</p>
                <p className="text-xs text-success mt-1">Available</p>
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowIntegrations((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-white/5 px-4 py-3 text-sm text-muted transition-colors hover:bg-white/5"
          >
            <span>Connect more apps</span>
            <ChevronDown
              className={`h-4 w-4 transition-transform ${showIntegrations ? "rotate-180" : ""}`}
            />
          </button>
          {showIntegrations && (
            <div className="mt-3 grid grid-cols-2 gap-3">
              {comingSoonSources.map((source) => (
                <div
                  key={source.id}
                  className="glass rounded-xl p-4 text-left text-sm opacity-50"
                >
                  <p className="font-medium">{source.name}</p>
                  <p className="text-xs text-muted mt-1">Coming soon</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scoring engine */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-muted" />
            <CardTitle>Scoring engine</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted">
            Scores are calculated once when you log a workout and don&apos;t
            update automatically when the scoring engine improves. If we&apos;ve
            changed how scores are calculated, use this to re-score all of
            your past activities with the latest version.
          </p>
          {recomputeResult && <p className="text-sm text-muted">{recomputeResult}</p>}
          <Button
            variant="outline"
            className="w-full"
            loading={recomputeLoading}
            onClick={handleRecomputeScores}
          >
            Refresh all my scores
          </Button>
        </CardContent>
      </Card>

      {/* Account */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-muted" />
            <CardTitle>Account</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button variant="destructive" className="w-full" onClick={handleSignOut}>
            <LogOut className="h-4 w-4" />
            Sign out
          </Button>
          {deleteError && <p className="text-sm text-danger">{deleteError}</p>}
          <Button
            variant="outline"
            className="w-full min-h-11 border-danger/40 text-danger hover:bg-danger/10"
            loading={deleteLoading}
            onClick={handleDeleteAccount}
          >
            Delete account and all data
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
