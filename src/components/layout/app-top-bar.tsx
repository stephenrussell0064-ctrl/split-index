"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Crown, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { NotificationBell } from "@/components/retention/notification-bell";
import { PremiumBadge } from "@/components/retention/premium-badge";
import { AccountMenu } from "@/components/layout/account-menu";
import { createClient } from "@/lib/supabase/client";
import { hasPaidAccess } from "@/lib/retention/trial";
import { navigateBack } from "@/lib/utils/navigate-back";
import { subscribeToEntitlementChanges } from "@/lib/premium/entitlement-events";

function BackButton() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <button
      type="button"
      onClick={() => navigateBack(router, pathname)}
      aria-label="Back"
      // h-11 w-11, not h-9: 44pt is Apple's minimum and this is the control
      // the athlete taps more than any other. The negative margin keeps the
      // chevron sitting where it always did while the hit area grows around it.
      className="-ml-3 flex h-11 w-11 items-center justify-center rounded-full text-foreground/80 transition-colors hover:bg-white/8 hover:text-foreground"
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );
}

export function AppTopBar({
  mode = "neutral",
  showBack = false,
}: {
  mode?: "neutral" | "gym" | "cardio";
  showBack?: boolean;
}) {
  const [premium, setPremium] = useState(false);

  /*
   * Re-read on demand, not only on mount.
   *
   * This used to be a single effect with an empty dependency array, so the
   * header decided once whether to show the Premium badge or the Upgrade link
   * and never revisited it. After paying, the athlete stayed on the same
   * screen — the confirmation renders in place — so nothing remounted and the
   * Upgrade link sat there beside a message thanking them for upgrading.
   */
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => subscribeToEntitlementChanges(reload), [reload]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("subscription_tier, subscription_status")
        .eq("user_id", user.id)
        .single();

      if (cancelled) return;
      setPremium(
        hasPaidAccess({
          subscription_tier: profile?.subscription_tier ?? "free",
          subscription_status: profile?.subscription_status ?? null,
        })
      );
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  // The plain word first, the product's name second — the same order as the
  // toggle at the top of the Train tab, so the two never disagree about where
  // the athlete is.
  const modeLabel =
    mode === "gym" ? "Strength · The Lab" : mode === "cardio" ? "Endurance · The Engine" : null;

  return (
    <div className="mb-4 flex items-center justify-between gap-2">
      <div className="flex items-center gap-1.5">
        {showBack && <BackButton />}
        {modeLabel && (
          <span
            className={cn(
              "text-xs font-semibold",
              mode === "gym" ? "text-gym-accent/90" : "text-cardio-accent/90"
            )}
          >
            {modeLabel}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1">
        {premium ? (
          <PremiumBadge />
        ) : (
          <Link
            href="/settings/billing"
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-muted transition-colors hover:border-warning/30 hover:text-warning"
          >
            <Crown className="h-3 w-3" />
            Upgrade
          </Link>
        )}
        <NotificationBell />
        {/*
          The avatar, and behind it Profile, Settings, Help & guide and Sign
          out. The "?" that used to sit here is inside the menu: the guide is
          still one tap from everywhere, and the top bar stops being five
          icons wide on a phone. The small "?" beside every explained score is
          untouched — that is the help people actually use.
        */}
        <AccountMenu />
      </div>
    </div>
  );
}
