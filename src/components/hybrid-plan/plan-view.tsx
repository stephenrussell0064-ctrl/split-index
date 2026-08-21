"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { AthleteProfile, Finding } from "@/lib/scoring/hpe";
import { ACWR_BLOCK, ACWR_FLOOR, ACWR_WARN } from "@/lib/scoring/hpe/constants";
import { DayDetail } from "./day-detail";
import { WeekStrip } from "./week-strip";
import {
  buildPlanCalendar,
  formatMinutes,
  PHASE_LABEL,
  sessionTitle,
  unscheduledSessions,
  type PlanDayView,
  type PlanWeekView,
} from "./plan-calendar";

export type { PlanSessionView, PlanWeekView } from "./plan-calendar";

/**
 * WP9 — the plan, day first.
 *
 * This used to be macrocycle → week → a list of sessions with weekday names
 * attached, which answered "what does my block look like" and left "what am I
 * doing today" as something the athlete had to work out from a bar chart and
 * the word "Thu". The brief is the other way round: today, in full, is the
 * first thing on screen; the week is scannable around it; the block is the
 * context underneath.
 *
 * What has NOT changed: every session still carries the diagnostic finding
 * that bought its slot, resolved against `profile.findings` and one tap away.
 * Non-negotiable #7 is the reason this screen is defensible at all, and a
 * redesign that dropped it would be the same bug that shipped here once
 * already — a traceable block rendering as an unexplained calendar.
 */

/** ACWR is a safety signal rather than a plan detail, so it is the one number here with a colour. */
function acwrTone(acwr: number): { label: string; className: string } {
  if (acwr > ACWR_BLOCK) return { label: "over ceiling", className: "text-danger" };
  if (acwr > ACWR_WARN) return { label: "elevated", className: "text-warning" };
  if (acwr < ACWR_FLOOR) return { label: "deliberately easy", className: "text-muted" };
  return { label: "in range", className: "text-endurance" };
}

export function PlanView({
  weeks,
  profile,
  planStart,
}: {
  weeks: PlanWeekView[];
  profile: AthleteProfile;
  /**
   * When this plan was generated — what week 1 is anchored to. A live plan is
   * generated now; a stored plan read back while generation is paused was
   * generated whenever `storedPlan.generatedAt` says, and anchoring that one
   * to today would relabel the week the athlete is actually in.
   */
  planStart: Date;
}) {
  // `new Date()` once, at mount. Deliberately not re-derived on every render:
  // a calendar that silently changed identity mid-session would move the
  // athlete's selection out from under them.
  const [mountedAt] = useState(() => new Date());

  const calendar = useMemo(
    () => buildPlanCalendar(weeks, planStart, mountedAt),
    [weeks, planStart, mountedAt]
  );

  // Today when today is in the block; otherwise the nearest end of it, so the
  // screen always opens on a real day rather than on nothing.
  const [selectedIso, setSelectedIso] = useState(() => {
    if (calendar.todayIndex >= 0) return calendar.days[calendar.todayIndex]!.iso;
    const first = calendar.days[0];
    const last = calendar.days[calendar.days.length - 1];
    if (!first || !last) return "";
    return first.offsetDays > 0 ? first.iso : last.iso;
  });

  const findingsById = useMemo(
    () => new Map<string, Finding>(profile.findings.map((f) => [f.id as string, f])),
    [profile.findings]
  );

  if (calendar.days.length === 0) {
    return (
      <Card>
        <h2 className="text-lg font-semibold tracking-tight">No days in this block</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          The plan came back without any weeks in it. That is a bug rather than an empty schedule — there is nothing
          here to train.
        </p>
      </Card>
    );
  }

  const selectedIndex = Math.max(
    0,
    calendar.days.findIndex((d) => d.iso === selectedIso)
  );
  const selected = calendar.days[selectedIndex]!;
  const week = weeks.find((w) => w.week === selected.weekNumber) ?? weeks[0]!;
  const phaseLabel = PHASE_LABEL[week.phase] ?? week.phase;

  const weekDays = calendar.days.filter((d) => d.weekNumber === selected.weekNumber);
  const weekNumbers = [...new Set(calendar.days.map((d) => d.weekNumber))].sort((a, b) => a - b);
  const weekPosition = weekNumbers.indexOf(selected.weekNumber);

  const stray = unscheduledSessions(week);
  const tone = acwrTone(week.acwr);

  const jumpToWeek = (offset: number) => {
    const target = weekNumbers[weekPosition + offset];
    if (target == null) return;
    const days = calendar.days.filter((d) => d.weekNumber === target);
    // Land on the same weekday, so paging through weeks compares like with like.
    const sameWeekday = days.find((d) => d.dayName === selected.dayName);
    setSelectedIso((sameWeekday ?? days[0])!.iso);
  };

  return (
    <div className="space-y-5">
      {/* Today is out of the block entirely. Say which way, and when. */}
      {calendar.todayIndex < 0 && calendar.firstDay && calendar.lastDay && (
        <Card glow="none">
          <h2 className="text-base font-semibold tracking-tight">
            {calendar.days[0]!.offsetDays > 0 ? "This block has not started yet" : "This block has finished"}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted">
            {calendar.days[0]!.offsetDays > 0
              ? `It runs from ${format(calendar.firstDay, "d MMMM")} to ${format(calendar.lastDay, "d MMMM")}. Nothing below is for today.`
              : `It ran from ${format(calendar.firstDay, "d MMMM")} to ${format(calendar.lastDay, "d MMMM")}. Everything below has already been and gone — update your intake to build the next one.`}
          </p>
        </Card>
      )}

      {/* ---- The day itself. First on screen, biggest thing on it. ---- */}
      <Card glow={selected.offsetDays === 0 && !selected.isRest ? "accent" : "none"} padding="md">
        <DayDetail day={selected} findingsById={findingsById} weekPhaseLabel={phaseLabel} />
      </Card>

      {/* ---- The week around it. ---- */}
      <Card padding="sm">
        <WeekStrip
          days={weekDays}
          selectedIso={selected.iso}
          onSelect={setSelectedIso}
          onPreviousWeek={() => jumpToWeek(-1)}
          onNextWeek={() => jumpToWeek(1)}
          hasPreviousWeek={weekPosition > 0}
          hasNextWeek={weekPosition < weekNumbers.length - 1}
          weekLabel={`Week ${week.week} of ${weekNumbers.length} · ${phaseLabel}${week.deload ? " · deload" : ""}`}
        />

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-white/[0.06] pt-4">
          <p className="text-sm text-muted">
            {week.enduranceMin} min of running · {week.sessions.length} sessions ·{" "}
            {weekDays.filter((d) => d.isRest).length} rest
          </p>
          <p className="text-xs text-muted">
            Load ratio{" "}
            <span className={cn("font-semibold tabular-nums", tone.className)}>{week.acwr.toFixed(2)}</span>{" "}
            <span className="text-muted/70">({tone.label})</span>
          </p>
        </div>

        {week.notes.length > 0 && (
          <ul className="mt-3 space-y-2">
            {week.notes.map((note) => (
              <li
                key={note}
                className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2 text-xs leading-relaxed text-muted"
              >
                {note}
              </li>
            ))}
          </ul>
        )}

        {/* A session the scheduler could not place is a fact about the week.
            Hiding it would make the day view quietly lossy — the athlete would
            see six sessions where the engine selected seven. */}
        {stray.length > 0 && (
          <div className="mt-3 rounded-xl border border-warning/20 bg-warning/[0.06] p-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-warning">Not placed on a day</p>
            <ul className="mt-1.5 space-y-1">
              {stray.map((s, i) => (
                <li key={`${s.kind}-${i}`} className="text-xs leading-relaxed text-foreground/85">
                  {sessionTitle(s)} — {formatMinutes(s.minutes)}. Your available days did not leave room for it.
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ---- The block. Context, subordinate but visible. ---- */}
      <BlockOverview
        weeks={weeks}
        days={calendar.days}
        selectedWeek={selected.weekNumber}
        onSelectWeek={(weekNumber) => {
          const days = calendar.days.filter((d) => d.weekNumber === weekNumber);
          const sameWeekday = days.find((d) => d.dayName === selected.dayName);
          setSelectedIso((sameWeekday ?? days[0])!.iso);
        }}
      />
    </div>
  );
}

/**
 * The whole block at a glance — what the old screen led with, now underneath
 * the day it exists to explain.
 */
function BlockOverview({
  weeks,
  days,
  selectedWeek,
  onSelectWeek,
}: {
  weeks: PlanWeekView[];
  days: PlanDayView[];
  selectedWeek: number;
  onSelectWeek: (week: number) => void;
}) {
  const peakMinutes = Math.max(...weeks.map((w) => w.enduranceMin), 1);
  const firstOfWeek = new Map<number, PlanDayView>();
  for (const day of days) if (!firstOfWeek.has(day.weekNumber)) firstOfWeek.set(day.weekNumber, day);

  return (
    <Card>
      <h2 className="text-base font-semibold tracking-tight">Your block</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        {weeks.length} weeks. Week 1 is exactly what you are already doing — the ramp is capped at 8% a week and every
        fourth week steps back.
      </p>

      <div className="mt-4 flex items-end gap-[3px] overflow-x-auto pb-1">
        {weeks.map((w) => {
          const active = w.week === selectedWeek;
          const start = firstOfWeek.get(w.week);
          return (
            <button
              key={w.week}
              type="button"
              onClick={() => onSelectWeek(w.week)}
              title={`Week ${w.week}${start ? ` — from ${format(start.date, "d MMM")}` : ""} — ${
                PHASE_LABEL[w.phase] ?? w.phase
              }${w.deload ? ", deload" : ""}, ${w.enduranceMin}min`}
              aria-label={`Week ${w.week}, ${PHASE_LABEL[w.phase] ?? w.phase}${w.deload ? ", deload week" : ""}`}
              aria-current={active ? "true" : undefined}
              className={cn(
                "group relative flex min-w-[1.35rem] flex-1 flex-col items-center gap-1 rounded-t-md transition-opacity",
                active ? "opacity-100" : "opacity-55 hover:opacity-85"
              )}
            >
              <span
                className={cn(
                  "w-full rounded-t-md",
                  w.deload ? "bg-muted/40" : w.phase === "taper" ? "bg-accent/60" : "bg-endurance/70",
                  active && "ring-2 ring-accent ring-offset-1 ring-offset-background"
                )}
                style={{ height: `${Math.max(6, (w.enduranceMin / peakMinutes) * 88)}px` }}
              />
              <span className="text-[0.6rem] tabular-nums text-muted">{w.week}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[0.65rem] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-endurance/70" /> build
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-muted/40" /> deload
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-sm bg-accent/60" /> taper
        </span>
      </div>
    </Card>
  );
}
