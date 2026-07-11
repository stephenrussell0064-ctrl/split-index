"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ShieldAlert, HeartPulse } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PremiumTease } from "@/components/premium/premium-tease";
import { cn } from "@/lib/utils/cn";
import { computeRecentLoads } from "@/lib/scoring/service";
import { calculateACWR } from "@/lib/scoring/engine";
import {
  injuryRisk,
  optimalWeeklyLoadTarget,
  hrvAdjustedRisk,
  type InjuryRiskResult,
} from "@/lib/scoring/injury-risk";
import type { AnalyticsScore } from "./types";

const ZONE_STYLE: Record<InjuryRiskResult["zone"], string> = {
  Undertraining: "text-muted",
  Optimal: "text-success",
  Caution: "text-warning",
  Danger: "text-danger",
};

/** ACWR needs a real chronic baseline — with less than this much logged history, the 8-28-day window is mostly/entirely empty and the ratio collapses toward a meaningless, structurally-fixed extreme (acute / (acute/4) = 4) rather than reflecting genuine overreaching. */
const MIN_DAYS_OF_HISTORY = 14;

function daysSinceOldest(scores: AnalyticsScore[]): number {
  const oldest = scores.reduce<number | null>((min, s) => {
    const t = new Date(s.created_at).getTime();
    return min === null || t < min ? t : min;
  }, null);
  return oldest === null ? 0 : (Date.now() - oldest) / 86400000;
}

function ReadoutContent({
  risk,
  displayIndex,
  acuteLoad,
  chronicWeekly,
  hrvToday,
  hrvBaseline,
}: {
  risk: InjuryRiskResult;
  displayIndex: number;
  acuteLoad: number;
  chronicWeekly: number;
  hrvToday?: number | null;
  hrvBaseline?: number | null;
}) {
  const target = optimalWeeklyLoadTarget(chronicWeekly);
  const overTarget = acuteLoad > target;
  const hasHrv = hrvToday != null && hrvBaseline != null;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="glass rounded-xl p-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted">Injury Risk Index</p>
        <p className={cn("mt-1 text-2xl font-bold tabular-nums", ZONE_STYLE[risk.zone])}>
          {displayIndex}
          <span className="text-sm text-muted">/95</span>
        </p>
        <p className={cn("mt-0.5 text-xs font-medium", ZONE_STYLE[risk.zone])}>{risk.zone}</p>
      </div>
      <div className="glass rounded-xl p-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted">Relative Risk</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{risk.relativeRisk}×</p>
        <p className="mt-0.5 text-xs text-muted">vs. baseline</p>
      </div>
      <div className="glass rounded-xl p-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted">ACWR</p>
        <p className="mt-1 text-2xl font-bold tabular-nums">{risk.acwr}</p>
        <p className="mt-0.5 text-xs text-muted">acute ÷ chronic</p>
      </div>
      <p className="sm:col-span-3 text-xs leading-relaxed text-muted">
        {overTarget
          ? `Keep this week under ~${target} AU (currently ${Math.round(acuteLoad)}) to return to optimal.`
          : `This week's load (${Math.round(acuteLoad)} AU) is within the optimal target of ~${target} AU.`}
      </p>
      <p className="sm:col-span-3 text-[10px] uppercase tracking-wider text-muted">
        {hasHrv ? "Load + HRV (high precision)" : "Load-based (add HRV for precision)"}
      </p>
    </div>
  );
}

function HrvInput({ hrvToday }: { hrvToday?: number | null }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");

  async function submit() {
    const hrvMs = Number(value);
    if (!Number.isFinite(hrvMs) || hrvMs <= 0) return;
    setStatus("saving");
    try {
      const res = await fetch("/api/recovery/hrv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hrvMs }),
      });
      if (!res.ok) throw new Error("failed");
      setStatus("saved");
      setValue("");
      router.refresh();
    } catch {
      setStatus("error");
    }
  }

  return (
    <div className="mt-3 flex items-center gap-2 border-t border-white/5 pt-3">
      <HeartPulse className="h-3.5 w-3.5 shrink-0 text-muted" />
      <input
        type="number"
        inputMode="decimal"
        placeholder={hrvToday != null ? `Today: ${hrvToday} ms` : "Morning HRV (ms) — optional"}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="h-8 w-full max-w-[220px] rounded-lg glass px-3 text-xs text-foreground placeholder:text-muted"
      />
      <button
        type="button"
        onClick={submit}
        disabled={status === "saving" || !value}
        className="rounded-lg bg-accent/15 px-3 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
      >
        {status === "saving" ? "Saving…" : "Log"}
      </button>
      {status === "error" && <span className="text-[10px] text-danger">Couldn&apos;t save</span>}
    </div>
  );
}

export function InjuryRiskPanel({
  scores,
  isPremium,
  hrvToday,
  hrvBaseline,
}: {
  scores: AnalyticsScore[];
  isPremium: boolean;
  hrvToday?: number | null;
  hrvBaseline?: number | null;
}) {
  const { risk, displayIndex, acuteLoad, chronicWeekly, daysOfHistory } = useMemo(() => {
    const loads = scores.map((s) => ({ load_score: s.load_score, created_at: s.created_at }));
    const { acute, chronic } = computeRecentLoads(loads);
    const acwr = calculateACWR(acute, chronic);
    const r = injuryRisk(acwr);
    return {
      risk: r,
      displayIndex: hrvAdjustedRisk(r.index, hrvToday, hrvBaseline),
      acuteLoad: acute,
      chronicWeekly: chronic,
      daysOfHistory: daysSinceOldest(scores),
    };
  }, [scores, hrvToday, hrvBaseline]);

  // Count alone isn't enough — 5 sessions logged this week still has an
  // empty 8-28-day chronic window, which mathematically forces ACWR to a
  // fixed, misleadingly extreme ~4.0 regardless of actual training pattern.
  const hasEnoughData = scores.length >= 3 && daysOfHistory >= MIN_DAYS_OF_HISTORY;

  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
      <Card>
        <CardHeader className="mb-3">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-warning" />
            <CardTitle>Recovery &amp; Injury Risk</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          {!hasEnoughData ? (
            <p className="text-sm text-muted">
              Log workouts consistently for 2+ weeks to unlock your injury risk index — ACWR needs
              a real training-load baseline, not just this week&apos;s sessions, to mean anything.
            </p>
          ) : isPremium ? (
            <ReadoutContent
              risk={risk}
              displayIndex={displayIndex}
              acuteLoad={acuteLoad}
              chronicWeekly={chronicWeekly}
              hrvToday={hrvToday}
              hrvBaseline={hrvBaseline}
            />
          ) : (
            <PremiumTease
              title="Injury Risk Index"
              subtitle="ACWR-based recovery accountability — unlock your relative risk and optimal load target with Premium."
            >
              <ReadoutContent
                risk={{ index: 32, relativeRisk: 2.1, acwr: 1.7, zone: "Caution" }}
                displayIndex={32}
                acuteLoad={610}
                chronicWeekly={450}
              />
            </PremiumTease>
          )}
          {isPremium && hasEnoughData && <HrvInput hrvToday={hrvToday} />}
        </CardContent>
      </Card>
    </motion.div>
  );
}
