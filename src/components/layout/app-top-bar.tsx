"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Crown } from "lucide-react";
import { NotificationBell } from "@/components/retention/notification-bell";
import { PremiumBadge } from "@/components/retention/premium-badge";
import { createClient } from "@/lib/supabase/client";
import { isPremiumUser } from "@/lib/retention/trial";

export function AppTopBar({ mode = "neutral" }: { mode?: "neutral" | "gym" | "cardio" }) {
  const [premium, setPremium] = useState(false);

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
        isPremiumUser(
          profile?.subscription_tier ?? "free",
          profile?.subscription_status ?? null
        )
      );
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const modeLabel =
    mode === "gym" ? "The Lab" : mode === "cardio" ? "The Engine" : null;

  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      {modeLabel && (
        <span
          className={
            mode === "gym"
              ? "micro-label text-gym-accent/80"
              : "micro-label text-cardio-accent/80"
          }
        >
          {modeLabel}
        </span>
      )}
      {!modeLabel && <span />}
      <div className="flex items-center gap-2">
      {premium ? (
        <PremiumBadge />
      ) : (
        <Link
          href="/settings/billing"
          className="inline-flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[10px] font-medium text-muted transition-colors hover:border-warning/30 hover:text-warning"
        >
          <Crown className="h-3 w-3" />
          Upgrade
        </Link>
      )}
      <NotificationBell />
      </div>
    </div>
  );
}
