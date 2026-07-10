"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { ShieldAlert } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PremiumTease } from "@/components/premium/premium-tease";
import { cn } from "@/lib/utils/cn";
import { computeRecentLoads } from "@/lib/scoring/service";
import { calculateACWR } from "@/lib/scoring/engine";
import { injuryRisk, optimalWeeklyLoadTarget, type InjuryRiskResult } from "@/lib/scoring/injury-risk";
import type { AnalyticsScore } from "./types";

const ZONE_STYLE: Record<InjuryRiskResult["zone"], string> = {
  Undertraining: "text-muted",
  Optimal: "text-success",
  Caution: "text-warning",
  Danger: "text-danger",
};

function ReadoutContent({
  risk,
  acuteLoad,
  chronicWeekly,
}: {
  risk: InjuryRiskResult;
  acuteLoad: number;
  chronicWeekly: number;
}) {
  const target = optimalWeeklyLoadTarget(chronicWeekly);
  const overTarget = acuteLoad > target;

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <div className="glass rounded-xl p-4 text-center">
        <p className="text-[10px] uppercase tracking-wider text-muted">Injury Risk Index</p>
        <p className={cn("mt-1 text-2xl font-bold tabular-nums", ZONE_STYLE[risk.zone])}>
          {risk.index}
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
    </div>
  );
}

export function InjuryRiskPanel({
  scores,
  isPremium,
}: {
  scores: AnalyticsScore[];
  isPremium: boolean;
}) {
  const { risk, acuteLoad, chronicWeekly } = useMemo(() => {
    const loads = scores.map((s) => ({ load_score: s.load_score, created_at: s.created_at }));
    const { acute, chronic } = computeRecentLoads(loads);
    const acwr = calculateACWR(acute, chronic);
    return { risk: injuryRisk(acwr), acuteLoad: acute, chronicWeekly: chronic };
  }, [scores]);

  const hasEnoughData = scores.length >= 3;

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
              Log a few more sessions to unlock your injury risk index — it needs training-load history to compute ACWR.
            </p>
          ) : isPremium ? (
            <ReadoutContent risk={risk} acuteLoad={acuteLoad} chronicWeekly={chronicWeekly} />
          ) : (
            <PremiumTease
              title="Injury Risk Index"
              subtitle="ACWR-based recovery accountability — unlock your relative risk and optimal load target with Premium."
            >
              <ReadoutContent
                risk={{ index: 32, relativeRisk: 2.1, acwr: 1.7, zone: "Caution" }}
                acuteLoad={610}
                chronicWeekly={450}
              />
            </PremiumTease>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
