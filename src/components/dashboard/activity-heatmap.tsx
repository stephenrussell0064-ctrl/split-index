"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Flame } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { shiftDateKey } from "@/lib/utils/timezone";

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

/**
 * A calendar key back to a Date, at NOON.
 *
 * Only ever used to format a label. Noon is deliberate: midnight does not
 * exist on a spring-forward day in some zones, and the resulting Date silently
 * lands on the day before.
 */
function dateFromKey(key: string): Date {
  return new Date(`${key}T12:00:00`);
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

const LEVEL_NAMES = ["a rest day", "a light day", "a moderate day", "a hard day", "your hardest"];

/** What a screen reader, or a long-press tooltip, gets for one square. */
function describe(cell: Cell): string {
  if (cell.inFuture) return `${cell.label}, still to come`;
  if (cell.level === 0) return `${cell.label}, rest day`;
  const n = cell.workouts;
  return `${cell.label}, ${n} workout${n === 1 ? "" : "s"} — ${LEVEL_NAMES[cell.level]}`;
}

export function ActivityHeatmap({
  days,
  weeks = 16,
  className,
}: ActivityHeatmapProps) {
  const reducedMotion = useReducedMotion();

  /*
    THE READOUT USED TO BE HOVER-ONLY, IN A PHONE APP.

    Every square was a bare `motion.div` with `onMouseEnter`. On a touch
    device there is no hover, so the footer read "Hover a day for details"
    permanently and the per-day detail — the only place the number of
    workouts is written down — could not be reached at all. On the primary
    platform, 112 squares of the dashboard were decorative.

    They were also invisible to assistive tech: no role, no name, no way to
    focus one. A screen reader heard the heading, the active-day count, and
    then nothing.

    So a square is a button now: tap it, or arrow to it, and the footer says
    what it is. `selected` is what the athlete chose and persists; `hovered`
    is a transient pointer preview that never outlives the pointer.
  */
  const [selected, setSelected] = useState<Cell | null>(null);
  const [hovered, setHovered] = useState<Cell | null>(null);
  const readout = hovered ?? selected;

  const { grid, monthMarkers, activeDays, currentStreak } = useMemo(() => {
    const loadByDate = new Map(days.map((d) => [d.date, d]));
    const today = new Date();
    const todayKey = toKey(today);

    // grid ends on the Sunday of the current week
    const endKey = shiftDateKey(todayKey, 6 - mondayIndex(today));
    const startKey = shiftDateKey(endKey, -(weeks * 7 - 1));

    const maxLoad = Math.max(1, ...days.map((d) => d.load));

    const grid: Cell[][] = [];
    const monthMarkers: { col: number; label: string }[] = [];
    let lastMonth = -1;
    let activeDays = 0;

    for (let w = 0; w < weeks; w++) {
      const col: Cell[] = [];
      for (let d = 0; d < 7; d++) {
        // Calendar arithmetic, not millisecond arithmetic: adding 86,400,000ms
        // per day drifts an hour at every DST boundary and eventually
        // duplicates or skips a date, which on a 16-week grid is guaranteed.
        const key = shiftDateKey(startKey, w * 7 + d);
        const date = dateFromKey(key);
        const entry = loadByDate.get(key);
        // Keys are zero-padded ISO dates, so lexical order is calendar order.
        const inFuture = key > todayKey;
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
          label: date.toLocaleDateString("en-GB", {
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
    for (let i = 0; ; i++) {
      const entry = loadByDate.get(shiftDateKey(todayKey, -i));
      if (entry && entry.load > 0) currentStreak++;
      else if (i === 0) continue; // today can be a rest day without breaking streak
      else break;
    }

    return { grid, monthMarkers, activeDays, currentStreak };
  }, [days, weeks]);

  /*
    ONE TAB STOP, NOT 112.

    Standard roving-tabindex grid: Tab reaches the heatmap once, arrows move
    within it. Making every square focusable would technically be "keyboard
    accessible" and would in practice mean 112 presses of Tab to get past a
    decorative-ish panel — worse than what it replaces.
  */
  const [cursor, setCursor] = useState({ w: 0, d: 0 });
  const gridRef = useRef<HTMLDivElement>(null);
  const shouldFocusCursor = useRef(false);

  useEffect(() => {
    if (!shouldFocusCursor.current) return;
    shouldFocusCursor.current = false;
    const cell = grid[cursor.w]?.[cursor.d];
    if (!cell) return;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-cell="${cell.key}"]`)
      ?.focus();
  }, [cursor, grid]);

  const moveCursor = useCallback(
    (dw: number, dd: number) => {
      setCursor((c) => {
        const w = Math.min(grid.length - 1, Math.max(0, c.w + dw));
        const d = Math.min(6, Math.max(0, c.d + dd));
        return w === c.w && d === c.d ? c : { w, d };
      });
      shouldFocusCursor.current = true;
    },
    [grid.length]
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    moveCursor(move[0], move[1]);
  }

  const levelClasses = [
    "bg-white/[0.04]",
    "bg-accent/25",
    "bg-accent/45",
    "bg-accent/70",
    "bg-accent shadow-[0_0_8px_rgba(0,230,95,0.5)]",
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
                <Flame className="h-3 w-3" aria-hidden />
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
            aria-hidden
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
              aria-hidden
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
              ref={gridRef}
              role="grid"
              aria-label={`Training over the last ${weeks} weeks — ${activeDays} active days. Use the arrow keys to hear each day.`}
              onKeyDown={onKeyDown}
              className="grid"
              style={{ gridTemplateColumns: `repeat(${grid.length}, 1fr)`, columnGap: 3 }}
            >
              {grid.map((col, w) => (
                <div
                  key={w}
                  role="row"
                  className="grid"
                  style={{ gridTemplateRows: "repeat(7, 1fr)", rowGap: 3 }}
                >
                  {col.map((cell, d) => (
                    <motion.button
                      key={cell.key}
                      type="button"
                      role="gridcell"
                      data-cell={cell.key}
                      tabIndex={cursor.w === w && cursor.d === d ? 0 : -1}
                      aria-label={describe(cell)}
                      // `aria-selected`, not `aria-pressed`: the role here is
                      // gridcell, and a pressed state is only defined on a button.
                      aria-selected={selected?.key === cell.key}
                      initial={reducedMotion ? false : { opacity: 0, scale: 0.5 }}
                      animate={{ opacity: cell.inFuture ? 0.25 : 1, scale: 1 }}
                      transition={{
                        delay: reducedMotion ? 0 : 0.2 + w * 0.02 + d * 0.008,
                        duration: 0.3,
                      }}
                      onMouseEnter={() => !cell.inFuture && setHovered(cell)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => {
                        setCursor({ w, d });
                        setSelected(cell);
                      }}
                      onClick={() => setSelected(cell)}
                      className={cn(
                        "aspect-square rounded-[3px] transition-transform",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
                        cell.inFuture ? "bg-white/[0.02]" : levelClasses[cell.level],
                        !cell.inFuture && "hover:scale-125 hover:ring-1 hover:ring-white/30",
                        selected?.key === cell.key && "ring-1 ring-white/60"
                      )}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* footer: selected-day readout + legend */}
        <div className="flex items-center justify-between">
          {/*
            Polite, not assertive: arrowing across a row fires this on every
            square, and an assertive region would interrupt itself into noise.
            The button's own label is what a screen reader actually reads on
            focus — this line is here so a sighted touch user gets the same
            detail a mouse user always had.
          */}
          <p className="h-4 text-[10px] tabular-nums text-muted" aria-live="polite">
            {readout
              ? readout.level === 0
                ? `${readout.label} · rest day`
                : `${readout.label} · ${readout.workouts} workout${readout.workouts === 1 ? "" : "s"}`
              : "Tap a day for details"}
          </p>
          <div className="flex items-center gap-1.5" aria-hidden>
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
