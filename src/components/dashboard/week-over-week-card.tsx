"use client";

import { useMemo } from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { HeatmapDay } from "@/components/dashboard/activity-heatmap";

const DAY_MS = 86400000;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface WeekOverWeekCardProps {
  days: HeatmapDay[];
  className?: string;
}

/**
 * Replaces the 50/50 Composition card (now redundant with EngineLabTrendCard
 * showing the same endurance/strength split, per user feedback about
 * irrelevant/duplicated widgets). This-week-vs-last is always populated as
 * soon as any activity exists, and is a genuinely actionable "am I trending
 * up or down" signal rather than a static snapshot.
 */
export function WeekOverWeekCard({ days, className }: WeekOverWeekCardProps) {
  const { thisWeek, lastWeek } = useMemo(() => {
    const byDate = new Map(days.map((d) => [d.date, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dow = (today.getDay() + 6) % 7;
    const thisMonday = new Date(today.getTime() - dow * DAY_MS);
    const lastMonday = new Date(thisMonday.getTime() - 7 * DAY_MS);

    function sumWeek(monday: Date) {
      let load = 0;
      let workouts = 0;
      for (let d = 0; d < 7; d++) {
        const date = new Date(monday.getTime() + d * DAY_MS);
        const entry = byDate.get(dateKey(date));
        if (entry) {
          load += entry.load;
          workouts += entry.workouts;
        }
      }
      return { load, workouts };
    }

    return { thisWeek: sumWeek(thisMonday), lastWeek: sumWeek(lastMonday) };
  }, [days]);

  const loadDelta =
    lastWeek.load > 0 ? Math.round(((thisWeek.load - lastWeek.load) / lastWeek.load) * 100) : null;
  const Icon = loadDelta === null || loadDelta === 0 ? Minus : loadDelta > 0 ? TrendingUp : TrendingDown;
  const color =
    loadDelta === null || loadDelta === 0 ? "text-muted" : loadDelta > 0 ? "text-success" : "text-danger";

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-2">
        <CardTitle>This Week vs Last</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-center gap-3">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-2xl font-bold tabular-nums">{thisWeek.workouts}</p>
            <p className="text-[10px] uppercase tracking-wider text-muted">sessions this week</p>
          </div>
          <p className="text-sm tabular-nums text-muted">{lastWeek.workouts} last week</p>
        </div>
        <div className="flex items-center justify-between border-t border-white/5 pt-3">
          <p className="text-xs text-muted">Training load</p>
          <span className={cn("flex items-center gap-1 text-xs font-semibold tabular-nums", color)}>
            <Icon className="h-3.5 w-3.5" />
            {loadDelta === null ? `${thisWeek.load} AU` : `${loadDelta > 0 ? "+" : ""}${loadDelta}%`}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
