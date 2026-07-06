"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Flame } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

export interface HeatmapDay {
  /** yyyy-MM-dd */
  date: string;
  /** aggregated training load for the day */
  load: number;
  workouts: number;
}

interface ActivityHeatmapProps {
  days: HeatmapDay[];
  /** number of trailing weeks to render */
  weeks?: number;
  className?: string;
}

const DAY_MS = 86400000;
const DOW_LABELS = ["Mon", "Wed", "Fri"];
const MONTH_LABELS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 0 = Monday … 6 = Sunday */
function mondayIndex(d: Date): number {
  return (d.getDay() + 6) % 7;
}

interface Cell {
  key: string;
  label: string;
  level: number; // 0-4
  workouts: number;
  inFuture: boolean;
}

export function ActivityHeatmap({
  days,
  weeks = 16,
  className,
}: ActivityHeatmapProps) {
  const reducedMotion = useReducedMotion();
  const [hovered, setHovered] = useState<Cell | null>(null);

  const { grid, monthMarkers, activeDays, currentStreak } = useMemo(() => {
    const loadByDate = new Map(days.map((d) => [d.date, d]));
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // grid ends on the Sunday of the current week
    const end = new Date(today.getTime() + (6 - mondayIndex(today)) * DAY_MS);
    const start = new Date(end.getTime() - (weeks * 7 - 1) * DAY_MS);

    const maxLoad = Math.max(1, ...days.map((d) => d.load));

    const grid: Cell[][] = [];
    const monthMarkers: { col: number; label: string }[] = [];
    let lastMonth = -1;
    let activeDays = 0;

    for (let w = 0; w < weeks; w++) {
      const col: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        const date = new Date(start.getTime() + (w * 7 + d) * DAY_MS);
        const key = toKey(date);
        const entry = loadByDate.get(key);
        const inFuture = date.getTime() > today.getTime();
        const ratio = entry ? entry.load / maxLoad : 0;
        const level =
          !entry || entry.load <= 0
            ? 0
            : ratio > 0.75
              ? 4
              : ratio > 0.5
                ? 3
                : ratio > 0.25
                  ? 2
                  : 1;
        if (level > 0) activeDays++;
        if (d === 0 && date.getMonth() !== lastMonth) {
          lastMonth = date.getMonth();
          monthMarkers.push({ col: w, label: MONTH_LABELS[lastMonth] });
        }
        col.push({
          key,
          label: date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
          }),
          level,
          workouts: entry?.workouts ?? 0,
          inFuture,
        });
      }
      grid.push(col);
    }

    // consecutive training days counting back from today (yesterday keeps streak alive)
    let currentStreak = 0;
    for (let t = today.getTime(), i = 0; ; i++) {
      const entry = loadByDate.get(toKey(new Date(t - i * DAY_MS)));
      if (entry && entry.load > 0) currentStreak++;
      else if (i === 0) continue; // today can be a rest day without breaking streak
      else break;
    }

    return { grid, monthMarkers, activeDays, currentStreak };
  }, [days, weeks]);

  const levelClasses = [
    "bg-white/[0.04]",
    "bg-accent/25",
    "bg-accent/45",
    "bg-accent/70",
    "bg-accent shadow-[0_0_8px_rgba(99,102,241,0.5)]",
  ];

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Training Heatmap · {weeks}W</CardTitle>
          <div className="flex items-center gap-3 text-[10px] uppercase tracking-wider text-muted">
            <span className="tabular-nums">{activeDays} active days</span>
            {currentStreak > 1 && (
              <span className="flex items-center gap-1 text-warning">
                <Flame className="h-3 w-3" />
                <span className="tabular-nums">{currentStreak}d streak</span>
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-between gap-3">
        <div className="flex gap-2">
          {/* weekday gutter */}
          <div
            className="grid shrink-0 pt-4 text-[9px] text-muted"
            style={{ gridTemplateRows: "repeat(7, 1fr)", rowGap: 3 }}
          >
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} className="flex items-center leading-none">
                {i % 2 === 0 ? DOW_LABELS[i / 2] : ""}
              </span>
            ))}
          </div>

          <div className="min-w-0 flex-1">
            {/* month labels */}
            <div
              className="relative mb-1 grid h-3"
              style={{ gridTemplateColumns: `repeat(${grid.length}, 1fr)`, columnGap: 3 }}
            >
              {monthMarkers.map((m) => (
                <span
                  key={`${m.label}-${m.col}`}
                  className="text-[9px] leading-none text-muted"
                  style={{ gridColumnStart: m.col + 1 }}
                >
                  {m.label}
                </span>
              ))}
            </div>

            {/* cells */}
            <div
              className="grid"
              style={{ gridTemplateColumns: `repeat(${grid.length}, 1fr)`, columnGap: 3 }}
            >
              {grid.map((col, w) => (
                <div
                  key={w}
                  className="grid"
                  style={{ gridTemplateRows: "repeat(7, 1fr)", rowGap: 3 }}
                >
                  {col.map((cell, d) => (
                    <motion.div
                      key={cell.key}
                      initial={reducedMotion ? false : { opacity: 0, scale: 0.5 }}
                      animate={{ opacity: cell.inFuture ? 0.25 : 1, scale: 1 }}
                      transition={{
                        delay: reducedMotion ? 0 : 0.2 + w * 0.02 + d * 0.008,
                        duration: 0.3,
                      }}
                      onMouseEnter={() => !cell.inFuture && setHovered(cell)}
                      onMouseLeave={() => setHovered(null)}
                      className={cn(
                        "aspect-square rounded-[3px] transition-transform",
                        cell.inFuture ? "bg-white/[0.02]" : levelClasses[cell.level],
                        !cell.inFuture && "hover:scale-125 hover:ring-1 hover:ring-white/30"
                      )}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer: hover readout + legend */}
        <div className="flex items-center justify-between">
          <p className="h-4 text-[10px] tabular-nums text-muted">
            {hovered
              ? hovered.level === 0
                ? `${hovered.label} · rest day`
                : `${hovered.label} · ${hovered.workouts} workout${hovered.workouts === 1 ? "" : "s"}`
              : "Hover a day for details"}
          </p>
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] uppercase tracking-wider text-muted">Less</span>
            {levelClasses.map((c, i) => (
              <span key={i} className={cn("h-2 w-2 rounded-[2px]", c)} />
            ))}
            <span className="text-[9px] uppercase tracking-wider text-muted">More</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
