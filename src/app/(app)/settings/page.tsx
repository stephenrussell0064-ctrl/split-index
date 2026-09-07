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
import { FREE_TIER_FEATURES } from "@/lib/retention/tiers";
import { getTrialDaysRemaining, isPremiumUser } from "@/lib/retention/trial";
import { SplitIndexSettings } from "@/components/settings/split-index-settings";
import {
  ActivityPrivacySettings,
  type PrivacyState,
} from "@/components/settings/activity-privacy-settings";
import { WidgetStatus } from "@/components/settings/widget-status";
import { Article9ConsentCard } from "@/components/settings/article9-consent-card";
import { PremiumBadge } from "@/components/retention/premium-badge";
import { createClient } from "@/lib/supabase/client";
import { clearRacePredictions } from "@/lib/native/race-predictions";
import { clearDailyTraining } from "@/lib/native/daily-training";
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
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [recomputeLoading, setRecomputeLoading] = useState(false);
  const [recomputeResult, setRecomputeResult] = useState<string | null>(null);
  /**
   * Non-null only for admins. The fleet page is `notFound()` for everyone else,
   * so this is what it looks like for everyone else too — see /api/admin/me.
   */
  const [adminRole, setAdminRole] = useState<string | null>(null);
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
    /*
      The Hybrid Plan Engine's rollout switch lives at /admin/hpe-fleet, and
      that page was reachable only by typing its URL. The feature ships
      DISABLED (migration 040 seeds the flag off at 0%), so the control that
      makes the app's flagship feature visible to any athlete had no route into
      it from inside the app. A 404 for non-admins, so this reveals nothing.
    */
    void fetch("/api/admin/me")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setAdminRole(data?.role ?? null))
      .catch(() => setAdminRole(null));
  }, []);

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


  /** Both widgets, best-effort — no-ops off device. */
  const clearNativeWidgets = async () => {
    await clearRacePredictions().catch(() => {});
    await clearDailyTraining().catch(() => {});
  };

  const handleSignOut = async () => {
    // Same clearing the sidebar's sign-out does, and for the same reason: the
    // home-screen widgets read an App Group container that outlives the
    // webview, so without this the previous account's race times and named
    // training block stay on the phone's home screen after they sign out.
    // There were two sign-out buttons and only one of them did this.
    await clearNativeWidgets();
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
    /*
      The subscription sentence is not decoration. Deleting the account removes
      the Split Index side of a subscription and nothing else — a recurring
      charge lives with Apple, Google or Stripe, and an athlete who deletes their
      account believing that cancelled the billing will be charged again. App
      Store Guideline 5.1.1(v) asks that account deletion make the state of any
      subscription clear rather than leaving someone to discover it.
    */
    const confirmed = window.confirm(
      "Delete your account permanently?\n\n" +
        "All workouts, routes, scores, plans and profile data will be removed. This cannot be undone.\n\n" +
        "This does NOT cancel a paid subscription. If you subscribed in the app, cancel it in your " +
        "Apple or Google account settings; if you subscribed on the web, cancel it from Manage billing " +
        "before deleting."
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
      // Deleting the account and leaving its predictions on the home screen is
      // the worst version of this: the data is gone from the server and still
      // being displayed by the phone, with no account left to clear it.
      await clearNativeWidgets();
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
        Article 9 consent, and the one-action withdrawal the law requires.
        Placed with the other privacy controls rather than buried under the
        Hybrid Plan: an athlete looking for "how do I take that back" looks in
        Settings, not inside the feature they are trying to switch off.
      */}
      <Article9ConsentCard />

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
              {/*
                THIS CARD DOES NOT TAKE PAYMENT ANY MORE.

                It used to call `startStripeCheckout()` straight from a "Start
                14-Day Free Trial" button, with no platform check anywhere in
                this file. On an iPhone that is App Store Guideline 3.1.1 in its
                plainest form — and worse than it sounds, because
                `checkout.stripe.com` is not in capacitor.config.ts's
                `allowNavigation`, so Capacitor punts the whole thing out to
                Safari. An external browser opening a card form is precisely the
                steering Apple prohibits, and the UK storefront gets no benefit
                from the US external-link carve-out in 3.1.1(a).

                The comparison table below is fine — describing what Premium
                includes is not a purchase mechanism. Only the CTA changed: it
                now goes to /settings/billing, which renders `SkuPicker`, the
                one component that knows whether it is on a phone or the web.
                One paywall, one code path, one place to get the platform branch
                right.
              */}
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
              <Link href="/settings/billing">
                <Button className="w-full">Start {FREE_TRIAL_DAYS}-Day Free Trial</Button>
              </Link>
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
          {adminRole && (
            <Link href="/admin/hpe-fleet">
              <Button variant="outline" className="w-full">
                <Shield className="h-4 w-4" />
                Hybrid Plan fleet &amp; rollout
              </Button>
            </Link>
          )}
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
