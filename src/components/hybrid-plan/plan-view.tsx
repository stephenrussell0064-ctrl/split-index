"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { AthleteProfile, Finding, FindingId } from "@/lib/scoring/hpe";
import { ACWR_BLOCK, ACWR_FLOOR, ACWR_WARN } from "@/lib/scoring/hpe/constants";

/**
 * WP9 — plan UI: macrocycle → week → session, with the why-this-session
 * explainer.
 *
 * The explainer is the part that matters. Non-negotiable #7 says every
 * session must be traceable to a named diagnostic finding; a UI that renders
 * the prescription and drops the reason turns a defensible plan back into an
 * opaque one. Every session here carries its finding, and the finding text is
 * one tap away rather than buried.
 */

export interface PlanSessionView {
  kind: string;
  /** What the athlete calls it — "Push", "Legs". Falls back to the engine's kind. */
  label?: string;
  /** Why the session looks the way it does. Never rendered as an exercise. */
  notes?: string[];
  domain: "endurance" | "strength";
  day: string | null;
  slot: string | null;
  minutes: number;
  isQuality: boolean;
  findingId: FindingId;
  prescription: string;
  emphasisKey: string;
}

export interface PlanWeekView {
  week: number;
  phase: string;
  deload: boolean;
  enduranceMin: number;
  acwr: number;
  stressCapped: number;
  notes: string[];
  sessions: PlanSessionView[];
}

const PHASE_LABEL: Record<string, string> = {
  base: "Base",
  build: "Build",
  specific: "Specific",
  peak: "Peak",
  taper: "Taper",
};

const KIND_LABEL: Record<string, string> = {
  easy_run: "Easy run",
  recovery_run: "Recovery run",
  long_run: "Long run",
  threshold_run: "Threshold",
  interval_run: "Intervals",
  rep_run: "Reps",
  squat_heavy: "Squat (heavy)",
  squat_volume: "Squat (volume)",
  bench_heavy: "Bench (heavy)",
  bench_volume: "Bench (volume)",
  deadlift_heavy: "Deadlift (heavy)",
  deadlift_volume: "Deadlift (volume)",
  strength_maintenance: "Strength maintenance",
  weak_lift_exposure: "Weak-lift exposure",
};

/** ACWR is the one number on this screen that is a safety signal rather than a plan detail, so it gets a colour. */
function acwrTone(acwr: number): { label: string; className: string } {
  if (acwr > ACWR_BLOCK) return { label: "over ceiling", className: "text-danger" };
  if (acwr > ACWR_WARN) return { label: "elevated", className: "text-warning" };
  if (acwr < ACWR_FLOOR) return { label: "deliberately easy", className: "text-muted" };
  return { label: "in range", className: "text-endurance" };
}

function SessionRow({
  session,
  findingsById,
}: {
  session: PlanSessionView;
  findingsById: Map<string, Finding>;
}) {
  const [showWhy, setShowWhy] = useState(false);
  const finding = findingsById.get(session.findingId);

  return (
    <div className="rounded-2xl border border-white/[0.05] bg-white/[0.02] p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-block h-2 w-2 shrink-0 rounded-full",
              session.domain === "endurance" ? "bg-endurance" : "bg-strength"
            )}
          />
          {/* The athlete's own word for the session first. Someone who chose
              push/pull/legs and was shown "bench_volume" reasonably concluded
              the split had been ignored — the label is the only part they see. */}
          <span className="text-sm font-semibold">
            {session.label ?? KIND_LABEL[session.kind] ?? session.kind}
          </span>
          {session.label && KIND_LABEL[session.kind] && (
            <span className="text-xs text-muted/70">{KIND_LABEL[session.kind]}</span>
          )}
          {session.isQuality && (
            <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-warning">
              Quality
            </span>
          )}
        </div>
        <span className="text-xs text-muted">
          {session.day ? `${session.day}${session.slot ? ` ${session.slot}` : ""}` : "unscheduled"}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed text-foreground/85">{session.prescription}</p>

      {(session.notes?.length ?? 0) > 0 && (
        <ul className="mt-2 space-y-1">
          {session.notes!.map((n) => (
            <li key={n} className="text-xs leading-relaxed text-muted">
              {n}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setShowWhy((v) => !v)}
        className="mt-3 text-xs font-medium text-accent transition-colors hover:text-accent/80"
        aria-expanded={showWhy}
      >
        {showWhy ? "Hide why" : "Why this session?"}
      </button>

      {showWhy && (
        <div className="mt-2 rounded-xl border border-accent/20 bg-accent/[0.05] p-3">
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

export function PlanView({
  weeks,
  profile,
  initialWeek,
}: {
  weeks: PlanWeekView[];
  profile: AthleteProfile;
  initialWeek?: number;
}) {
  const [selectedWeek, setSelectedWeek] = useState(initialWeek ?? weeks[0]?.week ?? 1);
  const week = weeks.find((w) => w.week === selectedWeek) ?? weeks[0];
  const findingsById = new Map(profile.findings.map((f) => [f.id as string, f]));

  const peakMinutes = Math.max(...weeks.map((w) => w.enduranceMin), 1);

  if (!week) return null;

  return (
    <div className="space-y-5">
      {/* Macrocycle — the whole block at a glance. */}
      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Your block</h2>
            <p className="mt-1 text-sm text-muted">
              {weeks.length} weeks. Week 1 is exactly what you are already doing — the ramp is capped at 8% a week and
              every fourth week steps back.
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-end gap-[3px] overflow-x-auto pb-1">
          {weeks.map((w) => {
            const active = w.week === selectedWeek;
            return (
              <button
                key={w.week}
                type="button"
                onClick={() => setSelectedWeek(w.week)}
                title={`Week ${w.week} — ${PHASE_LABEL[w.phase] ?? w.phase}${w.deload ? ", deload" : ""}, ${w.enduranceMin}min`}
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

      {/* The selected week. */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-widest text-muted">
              {PHASE_LABEL[week.phase] ?? week.phase}
              {week.deload && " · deload"}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Week {week.week}</h2>
            <p className="mt-1 text-sm text-muted">
              {week.enduranceMin} min of running · {week.sessions.length} sessions
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium uppercase tracking-widest text-muted">Acute:chronic load</p>
            <p className={cn("mt-1 text-xl font-semibold tabular-nums", acwrTone(week.acwr).className)}>
              {week.acwr.toFixed(2)}
            </p>
            <p className="text-xs text-muted">{acwrTone(week.acwr).label}</p>
          </div>
        </div>

        {week.notes.length > 0 && (
          <ul className="mt-4 space-y-2">
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

        <div className="mt-4 space-y-3">
          {week.sessions.length === 0 ? (
            <p className="text-sm text-muted">No sessions this week.</p>
          ) : (
            week.sessions.map((session, i) => (
              <SessionRow key={`${session.kind}-${i}`} session={session} findingsById={findingsById} />
            ))
          )}
        </div>
      </Card>
    </div>
  );
}
