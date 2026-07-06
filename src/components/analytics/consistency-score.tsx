"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, Target } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { formatPercent } from "@/lib/utils/format";
import { computeHitRate, computeSessionsPerWeek, computeStreak } from "./utils";
import type { AnalyticsActivity, HeatmapDay } from "./types";

interface ConsistencyScoreProps {
  activities: AnalyticsActivity[];
  heatmapDays: HeatmapDay[];
  targetSessionsPerWeek: number;
}

export function ConsistencyScore({
  activities,
  heatmapDays,
  targetSessionsPerWeek,
}: ConsistencyScoreProps) {
  const reducedMotion = useReducedMotion();

  const { weeklyBuckets, hitRate, streak, avgSessions } = useMemo(() => {
    const weeklyBuckets = computeSessionsPerWeek(activities, 8);
    const hitRate = computeHitRate(heatmapDays, targetSessionsPerWeek, 8);
    const streak = computeStreak(heatmapDays);
    const completed = weeklyBuckets.slice(0, -1);
    const avgSessions =
      completed.length > 0
        ? Math.round(
            (completed.reduce((s, b) => s + b.sessions, 0) / completed.length) * 10
          ) / 10
        : 0;
    return { weeklyBuckets, hitRate, streak, avgSessions };
  }, [activities, heatmapDays, targetSessionsPerWeek]);

  const hasData = weeklyBuckets.some((b) => b.sessions > 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.12 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-3">
          <div className="flex items-center justify-between">
            <CardTitle>Consistency</CardTitle>
            <span
              className={cn(
                "text-lg font-bold tabular-nums",
                hitRate >= 75 ? "text-success" : hitRate >= 40 ? "text-warning" : "text-muted"
              )}
            >
              {formatPercent(hitRate)}
            </span>
          </div>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="glass rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted">Avg / wk</p>
              <p className="mt-1 text-xl font-bold tabular-nums">{avgSessions}</p>
            </div>
            <div className="glass rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted flex items-center justify-center gap-1">
                <Flame className="h-3 w-3 text-warning" />
                Streak
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">{streak}d</p>
            </div>
            <div className="glass rounded-xl p-3 text-center">
              <p className="text-[10px] uppercase tracking-wider text-muted flex items-center justify-center gap-1">
                <Target className="h-3 w-3 text-accent" />
                Target
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {targetSessionsPerWeek}×
              </p>
            </div>
          </div>

          <div className="relative flex h-24 items-end gap-1.5">
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-white/15"
              style={{ bottom: `${(targetSessionsPerWeek / 7) * 100}%` }}
            />
            {weeklyBuckets.map((b, i) => {
              const pct = Math.min(100, (b.sessions / 7) * 100);
              const hitTarget = b.sessions >= targetSessionsPerWeek;
              return (
                <div
                  key={b.label}
                  className="group relative flex h-full flex-1 flex-col justify-end"
                  title={`${b.label}: ${b.sessions} sessions`}
                >
                  <motion.div
                    initial={reducedMotion ? false : { height: 0 }}
                    animate={{ height: `${Math.max(pct, hasData ? 4 : 0)}%` }}
                    transition={{
                      delay: reducedMotion ? 0 : 0.2 + i * 0.05,
                      duration: 0.6,
                      ease: [0.22, 1, 0.36, 1],
                    }}
                    className={cn(
                      "rounded-md",
                      hitTarget ? "bg-accent" : b.sessions > 0 ? "bg-accent/30" : "bg-white/[0.05]"
                    )}
                  />
                </div>
              );
            })}
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted text-center">
            {hasData
              ? `Hit-rate vs ${targetSessionsPerWeek}× / week target · last 8 weeks`
              : "Log workouts to track consistency"}
          </p>
        </CardContent>
      </Card>
    </motion.div>
  );
}
