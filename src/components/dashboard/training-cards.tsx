"use client";

import { useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { HeatmapDay } from "@/components/dashboard/activity-heatmap";

/* ── Training consistency ────────────────────────────────────────────────── */

const DAY_MS = 86400000;
const TARGET_SESSIONS_PER_WEEK = 4;

interface ConsistencyCardProps {
  days: HeatmapDay[];
  weeks?: number;
  className?: string;
}

export function ConsistencyCard({
  days,
  weeks = 8,
  className,
}: ConsistencyCardProps) {
  const reducedMotion = useReducedMotion();

  const { buckets, consistencyPct } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dowMon = (today.getDay() + 6) % 7;
    const thisMonday = new Date(today.getTime() - dowMon * DAY_MS);

    const buckets: { label: string; sessions: number; isCurrent: boolean }[] = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const monday = new Date(thisMonday.getTime() - w * 7 * DAY_MS);
      let sessions = 0;
      for (let d = 0; d < 7; d++) {
        const date = new Date(monday.getTime() + d * DAY_MS);
        const key = `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
        const entry = byDate.get(key);
        if (entry && entry.workouts > 0) sessions++;
      }
      buckets.push({
        label: monday.toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
        sessions,
        isCurrent: w === 0,
      });
    }

    // Completed weeks with zero sessions before this athlete's first-ever
    // activity in the lookback window aren't a consistency failure — they
    // just predate any training history — so they're excluded from the
    // average rather than counted as a miss (user feedback: this showed a
    // misleading 0% for a newer account with strong *recent* consistency,
    // since the fixed 8-week window included pre-activity weeks).
    const firstActiveIdx = buckets.findIndex((b) => b.sessions > 0);
    const completed = buckets
      .slice(0, -1) // exclude in-progress week
      .filter((_, i) => firstActiveIdx === -1 || i >= firstActiveIdx);
    // Partial credit per week (e.g. 2/4 sessions = 50%) rather than an
    // all-or-nothing "did this week hit target" binary — the binary version
    // could never read above 0% for an athlete consistently doing 2-3
    // sessions against a 4-session target, even though that's genuinely
    // solid training.
    const consistencyPct =
      completed.length > 0
        ? Math.round(
            (completed.reduce(
              (sum, b) => sum + Math.min(1, b.sessions / TARGET_SESSIONS_PER_WEEK),
              0
            ) /
              completed.length) *
              100
          )
        : 0;

    return { buckets, consistencyPct };
  }, [days, weeks]);

  const hasAny = buckets.some((b) => b.sessions > 0);

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Consistency · {weeks}W</CardTitle>
          <span
            className={cn(
              "text-sm font-semibold tabular-nums",
              consistencyPct >= 75
                ? "text-success"
                : consistencyPct >= 40
                  ? "text-warning"
                  : "text-muted"
            )}
          >
            {consistencyPct}%
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-end">
        <div className="relative flex h-28 items-end gap-1.5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 z-10 border-t border-dashed border-white/15"
            style={{ bottom: `${(TARGET_SESSIONS_PER_WEEK / 7) * 100}%` }}
          />
          {buckets.map((b, i) => {
            const pct = Math.min(100, (b.sessions / 7) * 100);
            const hitTarget = b.sessions >= TARGET_SESSIONS_PER_WEEK;
            return (
              <div
                key={b.label}
                className="group relative flex h-full flex-1 flex-col justify-end"
                title={`Week of ${b.label}: ${b.sessions} session${b.sessions === 1 ? "" : "s"}`}
              >
                <motion.div
                  initial={reducedMotion ? false : { height: 0 }}
                  animate={{ height: `${Math.max(pct, 4)}%` }}
                  transition={{
                    delay: reducedMotion ? 0 : 0.3 + i * 0.06,
                    duration: 0.6,
                    ease: [0.22, 1, 0.36, 1],
                  }}
                  className={cn(
                    "rounded-md transition-colors",
                    b.isCurrent
                      ? "bg-accent/40 group-hover:bg-accent/60"
                      : hitTarget
                        ? "bg-accent group-hover:bg-accent/80"
                        : b.sessions > 0
                          ? "bg-accent/25 group-hover:bg-accent/40"
                          : "bg-white/[0.05]"
                  )}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-3 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
          <span>{buckets[0]?.label}</span>
          <span>
            {hasAny
              ? `Target ${TARGET_SESSIONS_PER_WEEK}× / week`
              : "Log workouts to build your streak"}
          </span>
          <span>Now</span>
        </div>
      </CardContent>
    </Card>
  );
}

