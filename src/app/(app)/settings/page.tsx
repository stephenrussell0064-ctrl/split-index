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
  RefreshCw,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  PREMIUM_FEATURES,
  PREMIUM_PRICE_GBP,
  FREE_TRIAL_DAYS,
} from "@/lib/stripe/config";
import { startStripeCheckout } from "@/lib/stripe/start-checkout";
import { FREE_TIER_FEATURES } from "@/lib/retention/tiers";
import { getTrialDaysRemaining, isPremiumUser } from "@/lib/retention/trial";
import { SplitIndexSettings } from "@/components/settings/split-index-settings";
import {
  ActivityPrivacySettings,
  type PrivacyState,
} from "@/components/settings/activity-privacy-settings";
import { WidgetStatus } from "@/components/settings/widget-status";
import { PremiumBadge } from "@/components/retention/premium-badge";
import { createClient } from "@/lib/supabase/client";
import type { SubscriptionStatus, SubscriptionTier } from "@/types";

/*
 * The privacy switch loads independently of the rest of the profile, so the
 * four outcomes are tracked separately: still loading, it worked, the column
 * isn't there (the database is behind on migrations — reloading cannot help),
 * or the read failed for some other reason (it might). `PrivacyState` is
 * declared alongside the control itself and imported here, so the page cannot
 * drift from the shape the control actually understands.
 */

export default function SettingsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
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
  // Tracked separately from `profile` so the Privacy control can still be
  // rendered (disabled, with an explanation) when the profile row fails to
  // load. Previously every settings card here was gated on `profile` being
  // non-null, so one failed query made the privacy switch vanish with no
  // error — which is precisely how an athlete ends up reporting that the
  // option "is not available" in settings.
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [profileLoadFailed, setProfileLoadFailed] = useState(false);
  const [privacy, setPrivacy] = useState<PrivacyState>({ status: "loading" });

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      setAuthUserId(user.id);

      // Two reads, not one. `share_activities_with_friends` arrived in
      // migration 031, and asking for it in the same SELECT as everything
      // else meant a database that had not taken 031 failed the WHOLE
      // profile read with `column ... does not exist` — so the Split Index
      // card vanished, the subscription card fell back to "free", and the
      // Privacy card could only say it had no idea. One missing column must
      // not be able to empty the Settings page.
      supabase
        .from("profiles")
        .select(
          "subscription_tier, subscription_status, created_at, split_endurance_weight, user_id"
        )
        .eq("user_id", user.id)
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            setProfileLoadFailed(true);
            return;
          }
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
        });

      supabase
        .from("profiles")
        .select("share_activities_with_friends")
        .eq("user_id", user.id)
        .single()
        .then(({ data, error }) => {
          if (error || !data) {
            // 42703 is Postgres' undefined_column. It is not a blip and
            // reloading will never clear it: the database is behind on
            // migrations. Say so, because "try again" wastes the one person
            // who could actually fix it.
            setPrivacy({
              status: error?.code === "42703" ? "missing_column" : "read_failed",
            });
            return;
          }
          // Activities are visible to friends by default, so anything
          // other than an explicit `false` means visible. Never infer
          // "private" from a missing/undefined value here — that would
          // show the athlete a Private-account switch that doesn't
          // match what the database is actually enforcing.
          setPrivacy({
            status: "loaded",
            shareActivitiesWithFriends: data.share_activities_with_friends !== false,
          });
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
      // `rebuildFailures` covers the per-athlete steps — the personal-record
      // rebuild especially, which deletes every record before re-inserting. It
      // is reported separately because the activity count can read "all of
      // them" while that step failed and took the PR list with it.
      const rebuildFailed: string[] = data.rebuildFailures ?? [];
      setRecomputeResult(
        `Recomputed ${data.recomputed} of ${data.total} activities` +
          (data.failed > 0 ? ` (${data.failed} failed).` : ".") +
          (rebuildFailed.length > 0
            ? " Your personal records or predictions could not be rebuilt — try again."
            : "")
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
          Profile, subscription, and account
        </p>
      </div>

      {/*
        Cards that need the profile row render nothing without it. Saying so
        beats letting the page look like it simply has fewer settings than it
        does — which is how a failed read gets reported as a missing feature.
      */}
      {profileLoadFailed && (
        <p className="text-sm text-warning">
          We couldn&apos;t load your profile, so some settings below are missing.
          Your subscription and Split Index cards need it.
        </p>
      )}

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

      {/*
        Rendered as soon as we know who the athlete is, even if nothing about
        their profile could be read. A privacy control that quietly disappears
        when a query fails is indistinguishable from one that was never built,
        and that is what the original report ("this option is not available
        there") actually described.
      */}
      {/*
        Rendered while the privacy read is still in flight, not just after it
        lands. The card previously waited for `privacy.status !== "loading"`,
        which meant it appeared late and pushed the rest of Settings down; and
        because the failure branches passed `initialShareActivities={true}`,
        a read that failed still drew a switch sitting in the "not private"
        position. A privacy control must never render a state it did not read.
        It now owns all four states and shows an indeterminate switch for the
        three where the stored value is unknown.
      */}
      {authUserId && (
        <ActivityPrivacySettings state={privacy} userId={authUserId} />
      )}

      {/*
        iOS only, and renders nothing at all unless there's a widget
        container to report on — so it stays invisible for everyone whose
        answer to "why is my widget empty?" is "you don't have one".
      */}
      <WidgetStatus />

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
