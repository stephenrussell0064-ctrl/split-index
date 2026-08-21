"use client";

import { useState } from "react";
import { format, isToday, isTomorrow, isYesterday } from "date-fns";
import { cn } from "@/lib/utils/cn";
import type { Finding } from "@/lib/scoring/hpe";
import {
  exerciseLines,
  formatMinutes,
  sessionMetrics,
  sessionSubtitle,
  sessionTitle,
  type PlanDayView,
  type PlanSessionView,
} from "./plan-calendar";

/**
 * One day, in full.
 *
 * The brief for the logbook redesign applies here unchanged: primary content
 * first, at a size that says so, everything else subordinate but visible. The
 * primary content of a training day is the prescription — how far, how fast,
 * how hard, how long — so that goes at the top of each session at display
 * size, and the sentence the engine wrote goes underneath as the detail.
 *
 * The "why" stays one tap away rather than being dropped. Non-negotiable #7
 * says every session is traceable to a named diagnostic finding, and a screen
 * that renders the prescription and loses the reason turns a defensible plan
 * back into an opaque calendar — which is exactly the bug this view is
 * replacing.
 */

/** Rest is content. It gets the same card, the same weight, and a reason. */
function RestDay({ day }: { day: PlanDayView }) {
  return (
    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      <p className="micro-label text-muted/70">Rest day</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight">Nothing scheduled</p>
      {day.restReason && (
        <p className="mt-2 text-sm leading-relaxed text-foreground/80">{day.restReason}</p>
      )}
    </div>
  );
}

function SessionBlock({
  session,
  findingsById,
  defaultOpen,
}: {
  session: PlanSessionView;
  findingsById: Map<string, Finding>;
  /** The one session of the day opens its reasoning by default; a second one does not, or the card becomes a wall. */
  defaultOpen: boolean;
}) {
  const [showWhy, setShowWhy] = useState(defaultOpen);
  const finding = findingsById.get(session.findingId);
  const metrics = sessionMetrics(session);
  const primary = metrics.filter((m) => m.tier === "primary");
  const secondary = metrics.filter((m) => m.tier === "secondary");
  const exercises = exerciseLines(session);
  const subtitle = sessionSubtitle(session);
  const isEndurance = session.domain === "endurance";

  return (
    <div className="relative rounded-2xl border border-white/[0.06] bg-white/[0.02] p-5">
      {/* The same 2px identity rail the logbook uses, in the same place, so
          a prescribed session and a logged one read as the same species. */}
      <span
        aria-hidden
        className={cn(
          "absolute inset-y-3 left-0 w-[2px] rounded-full",
          isEndurance ? "bg-cardio-accent/70" : "bg-gym-accent/70"
        )}
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("micro-label", isEndurance ? "text-cardio-accent" : "text-gym-accent")}>
          {isEndurance ? "Engine" : "Lab"}
        </span>
        {session.slot && <span className="micro-label text-muted/60">{session.slot}</span>}
        {session.isQuality && (
          <span className="micro-label rounded-full bg-warning/15 px-2 py-0.5 text-warning">Quality</span>
        )}
      </div>

      {/* The session's name at display size — the thing being asked of them today. */}
      <h3 className="mt-2 text-2xl font-semibold leading-tight tracking-tight">{sessionTitle(session)}</h3>
      {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}

      {/* The prescription's numbers, before its prose. */}
      {primary.length > 0 && (
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {primary.map((metric) => (
            <div key={metric.key}>
              <dt className="micro-label text-[9px] text-muted/60">{metric.label}</dt>
              <dd
                className={cn(
                  "mt-1 font-display text-2xl font-bold leading-none tabular-nums",
                  metric.key === "distance"
                    ? isEndurance
                      ? "text-cardio-accent"
                      : "text-gym-accent"
                    : "text-foreground"
                )}
              >
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {secondary.length > 0 && (
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-1.5">
          {secondary.map((metric) => (
            <div key={metric.key} className="flex items-baseline gap-2">
              <dt className="micro-label text-[9px] text-muted/60">{metric.label}</dt>
              <dd
                className={cn(
                  "text-[15px] font-semibold tabular-nums",
                  metric.key === "pace" && isEndurance ? "text-cardio-accent" : "text-foreground"
                )}
              >
                {metric.value}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {/* A gym session is a list of exercises and reads as one. An endurance
          session is a single instruction and reads as one. Same data either
          way — `prescription.text` — presented as what it actually is. */}
      {exercises.length > 0 ? (
        <ul className="mt-4 space-y-1.5">
          {exercises.map((line, i) => (
            <li key={line} className="flex gap-3 text-sm leading-relaxed text-foreground/90">
              <span className="w-4 shrink-0 font-mono text-xs tabular-nums text-muted/50">{i + 1}</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[15px] leading-relaxed text-foreground/90">{session.prescription}</p>
      )}

      {/* No separate "heart-rate band from ..." line. The engine's own sentence
          already names the source inline — printing it twice produced "band
          from physiological easy band from HR reserve", which is noise where
          restraint was the whole point. */}

      {(session.notes?.length ?? 0) > 0 && (
        <ul className="mt-3 space-y-1.5">
          {session.notes!.map((note) => (
            <li key={note} className="text-xs leading-relaxed text-muted">
              {note}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowWhy((v) => !v)}
        aria-expanded={showWhy}
        className="mt-4 inline-flex min-h-11 items-center text-sm font-medium text-accent transition-colors hover:text-accent/80"
      >
        {showWhy ? "Hide why" : "Why this session?"}
      </button>

      {showWhy && (
        <div className="mt-1 rounded-xl border border-accent/20 bg-accent/[0.05] p-4">
          {finding ? (
            <>
              <p className="text-sm leading-relaxed text-foreground/90">{finding.text}</p>
              <p className="mt-2 font-mono text-[0.65rem] uppercase tracking-wider text-muted/60">
                finding: {finding.id} · emphasis: {session.emphasisKey.replace(/_/g, " ")}
              </p>
            </>
          ) : (
            // Should be unreachable: the database refuses a session without a
            // finding. If it ever renders, say so plainly rather than showing
            // an empty box that looks like a loading state.
            <p className="text-sm text-muted">
              This session&apos;s diagnostic finding could not be loaded. That is a bug — a session without a reason
              behind it should never have been prescribed.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** "Today", "Tomorrow", "Yesterday", or the weekday — whichever is the shortest true thing to say. */
export function dayRelativeLabel(date: Date): string {
  if (isToday(date)) return "Today";
  if (isTomorrow(date)) return "Tomorrow";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "EEEE");
}

export function DayDetail({
  day,
  findingsById,
  weekPhaseLabel,
}: {
  day: PlanDayView;
  findingsById: Map<string, Finding>;
  weekPhaseLabel: string;
}) {
  const past = day.offsetDays < 0;

  return (
    <div className={cn(past && "opacity-70")}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="micro-label text-muted/70">
            Week {day.weekNumber} · {weekPhaseLabel}
            {day.deload && " · deload"}
          </p>
          <h2 className="mt-1 text-3xl font-bold tracking-tight">{dayRelativeLabel(day.date)}</h2>
          <p className="mt-1 text-sm text-muted">{format(day.date, "EEEE d MMMM")}</p>
        </div>
        {day.totalMinutes > 0 && (
          <div className="text-right">
            <p className="micro-label text-[9px] text-muted/60">Total</p>
            <p className="mt-1 font-display text-xl font-bold tabular-nums leading-none">
              {formatMinutes(day.totalMinutes)}
            </p>
          </div>
        )}
      </div>

      {past && (
        <p className="mt-3 text-xs text-muted/70">
          This day has already passed. It is here so the week reads whole, not because there is anything left to do.
        </p>
      )}

      <div className="mt-4 space-y-3">
        {day.isRest ? (
          <RestDay day={day} />
        ) : (
          day.sessions.map((session, i) => (
            <SessionBlock
              key={`${session.kind}-${session.slot ?? "x"}-${i}`}
              session={session}
              findingsById={findingsById}
              defaultOpen={day.sessions.length === 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
