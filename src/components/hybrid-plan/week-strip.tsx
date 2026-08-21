"use client";

import { format } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatMinutes, type PlanDayView } from "./plan-calendar";

/**
 * The week around today, and the way to any other day in it.
 *
 * Seven fixed columns at 375px — the whole point is that the eye lands on the
 * same place every time, so the columns do not resize with their content. Each
 * one carries the weekday, the date, and a load bar; the bar is the only
 * scanning aid that answers "which day is the big one" without reading.
 *
 * Rest days are rendered as rest, not as blanks. A day with no bar and a "Rest"
 * word under it is a prescription the athlete can see; an empty cell is a hole
 * they have to interpret.
 */

export function WeekStrip({
  days,
  selectedIso,
  onSelect,
  onPreviousWeek,
  onNextWeek,
  hasPreviousWeek,
  hasNextWeek,
  weekLabel,
}: {
  /** Exactly the seven days of one week, Monday first. */
  days: PlanDayView[];
  selectedIso: string;
  onSelect: (iso: string) => void;
  onPreviousWeek: () => void;
  onNextWeek: () => void;
  hasPreviousWeek: boolean;
  hasNextWeek: boolean;
  weekLabel: string;
}) {
  // Scaled against the biggest day in THIS week, not the block: the bar is a
  // within-week comparison ("Saturday is the long one"), and normalising it to
  // a peak week 9 weeks away would flatten every bar in a deload week to
  // nothing and read as an error.
  const peak = Math.max(...days.map((d) => d.totalMinutes), 1);

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onPreviousWeek}
          disabled={!hasPreviousWeek}
          aria-label="Previous week"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>

        <p className="micro-label text-center text-muted">{weekLabel}</p>

        <button
          type="button"
          onClick={onNextWeek}
          disabled={!hasNextWeek}
          aria-label="Next week"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted transition-colors hover:bg-white/[0.05] hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      <div className="mt-2 grid grid-cols-7 gap-1">
        {days.map((day) => {
          const selected = day.iso === selectedIso;
          const isToday = day.offsetDays === 0;
          const past = day.offsetDays < 0;
          const hasEndurance = day.sessions.some((s) => s.domain === "endurance");
          const hasStrength = day.sessions.some((s) => s.domain === "strength");

          return (
            <button
              key={day.iso}
              type="button"
              onClick={() => onSelect(day.iso)}
              aria-current={selected ? "date" : undefined}
              aria-label={`${format(day.date, "EEEE d MMMM")}${
                day.isRest ? ", rest day" : `, ${formatMinutes(day.totalMinutes)}`
              }`}
              className={cn(
                "flex min-h-[4.75rem] flex-col items-center gap-1 rounded-xl px-0.5 py-2 transition-colors",
                selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                past && !selected && "opacity-45"
              )}
            >
              <span
                className={cn(
                  "micro-label text-[9px]",
                  isToday ? "text-accent" : selected ? "text-foreground" : "text-muted/60"
                )}
              >
                {format(day.date, "EEEEE")}
              </span>
              <span
                className={cn(
                  "font-display text-base font-bold leading-none tabular-nums",
                  isToday ? "text-accent" : selected ? "text-foreground" : "text-muted"
                )}
              >
                {format(day.date, "d")}
              </span>

              {/* Load, at a glance. Fixed-height track so every column has the
                  same baseline and the bars are comparable down the row. */}
              <span aria-hidden className="mt-0.5 flex h-6 w-full items-end justify-center gap-[2px]">
                {day.isRest ? (
                  <span className="mb-[2px] h-[2px] w-3 rounded-full bg-muted/30" />
                ) : (
                  <>
                    {hasEndurance && (
                      <span
                        className="w-1.5 rounded-full bg-cardio-accent/70"
                        style={{ height: `${barHeight(day, "endurance", peak)}px` }}
                      />
                    )}
                    {hasStrength && (
                      <span
                        className="w-1.5 rounded-full bg-gym-accent/70"
                        style={{ height: `${barHeight(day, "strength", peak)}px` }}
                      />
                    )}
                  </>
                )}
              </span>

              <span
                className={cn(
                  "text-[9px] leading-none tabular-nums",
                  selected ? "text-muted" : "text-muted/50"
                )}
              >
                {day.isRest ? "Rest" : `${Math.round(day.totalMinutes)}m`}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function barHeight(day: PlanDayView, domain: "endurance" | "strength", peak: number): number {
  const minutes = day.sessions
    .filter((s) => s.domain === domain)
    .reduce((sum, s) => sum + s.minutes, 0);
  // A floor of 4px: a 20-minute session in a week peaking at 150 would round
  // to a bar you cannot see, which reads as a rest day.
  return Math.max(4, Math.round((minutes / peak) * 24));
}
