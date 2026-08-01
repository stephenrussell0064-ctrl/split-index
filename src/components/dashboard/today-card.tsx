"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { Sun, AlertTriangle, ChevronRight } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { TodayPlan } from "@/lib/scoring/today-plan";

const INTENSITY_TONE: Record<TodayPlan["suggestedIntensity"], string> = {
  hard: "text-success",
  moderate: "text-warning",
  easy: "text-danger",
};

/**
 * The prescriptive layer (interference-engine brief, Part 3) — the daily
 * "what should I do today" hook the app previously lacked entirely.
 * Combines the Part 2 readiness suggestion, the athlete's own Tier 2 race
 * prediction (reused, not recalculated), and a deload nudge that only
 * appears when Part 1's interference data and Part 2's readiness both
 * point the same unfavorable way at once.
 */
export function TodayCard({ plan, className }: { plan: TodayPlan; className?: string }) {
  const reducedMotion = useReducedMotion();

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-2">
        <div className="flex items-center gap-2">
          <Sun className="h-4 w-4 text-accent" />
          <CardTitle>Today</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-center gap-3">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="space-y-3"
        >
          <p className={cn("text-sm font-medium", INTENSITY_TONE[plan.suggestedIntensity])}>
            {plan.suggestionLabel}
          </p>

          {plan.targetPaceLabel && (
            <p className="text-xs text-muted">{plan.targetPaceLabel}</p>
          )}

          {plan.deloadNudge && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{plan.deloadNudge}</span>
            </div>
          )}

          <Link
            href="/activities/new"
            className="group flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm transition-colors hover:border-accent/40 hover:bg-accent/10"
          >
            <span>Log today&apos;s session</span>
            <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
          </Link>
        </motion.div>
      </CardContent>
    </Card>
  );
}
