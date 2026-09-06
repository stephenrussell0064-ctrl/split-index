"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import type { AttemptSelection, EventDayStep, RacePacing, TaperDay } from "@/lib/scoring/hpe";
import {
  buildPacingPlan,
  clockTime,
  deltaLabel,
  mmss,
  PACING_STRATEGIES,
  type PacingStrategy,
} from "./race-pacing";

/**
 * WP9 — the event-day view, closing assurance findings F12, F14 and F18.
 *
 * F14: "No event-day plan; weigh-in and re-warm-up unmodelled... Going from
 * four hours of sitting between attempts straight into 5k race pace is a
 * hamstring or calf strain waiting to happen."
 *
 * F12: the taper's carbohydrate guidance is normal high-carbohydrate eating,
 * NOT a loading protocol, and it is never a calorie target — non-negotiable
 * #5 forbids that under any configuration.
 *
 * F18: attempt selection and race pacing, the two core coach deliverables the
 * review flagged as absent.
 */

function fmtPace(secondsPerKm: number): string {
  const s = Math.round(secondsPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}/km`;
}

export function EventDayView({
  taper,
  eventDay,
  attempts,
  pacing,
  raceDistanceKm = 5,
}: {
  taper: TaperDay[];
  eventDay: EventDayStep[] | null;
  attempts: AttemptSelection[];
  pacing: RacePacing | null;
  /**
   * The race the splits are for. Five kilometres unless told otherwise, because
   * `racePacing` derives its pace as `target5kS / 5` — the target the intake
   * collects is a 5k target, and pacing a marathon off it would be fiction.
   */
  raceDistanceKm?: number;
}) {
  return (
    <div className="space-y-5">
      <Card>
        <h2 className="text-lg font-semibold tracking-tight">The last ten days</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Volume comes down, intensity stays up. Cutting both is detraining, not tapering.
        </p>
        <ol className="mt-4 space-y-2.5">
          {taper.map((day) => (
            <li key={day.day} className="flex gap-3">
              <span className="mt-0.5 w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted">
                {day.day === 0 ? "Day 0" : `D${day.day}`}
              </span>
              <p className="text-sm leading-relaxed text-foreground/85">{day.note}</p>
            </li>
          ))}
        </ol>
      </Card>

      {eventDay && (
        <Card glow="accent">
          <h2 className="text-lg font-semibold tracking-tight">Event day</h2>
          <ol className="mt-4 space-y-2.5">
            {eventDay.map((step) => (
              <li key={step.t} className="flex gap-3">
                <span className="mt-0.5 w-16 shrink-0 font-mono text-xs tabular-nums text-muted">{step.t}</span>
                <p className="text-sm leading-relaxed text-foreground/85">{step.note}</p>
              </li>
            ))}
          </ol>
        </Card>
      )}

      {attempts.length > 0 && (
        <Card>
          <h2 className="text-lg font-semibold tracking-tight">Attempt selection</h2>
          <p className="mt-1 text-sm text-muted">{attempts[0].note}</p>
          {/*
            No `min-w`, no scroller. 22rem is 352px inside a Card whose content
            box on a 390px phone is 318 — a guaranteed sideways swipe on the
            screen an athlete reads while warming up for an opener. Four short
            numeric columns fit 318px comfortably; the floor was never doing
            anything but forcing the overflow.
          */}
          <div className="mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-muted">
                  <th className="pb-2 font-medium">Lift</th>
                  <th className="pb-2 text-right font-medium">Opener</th>
                  <th className="pb-2 text-right font-medium">Second</th>
                  <th className="pb-2 text-right font-medium">Third</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.lift} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-2.5 font-medium">{a.lift.charAt(0).toUpperCase() + a.lift.slice(1)}</td>
                    <td className="py-2.5 text-right tabular-nums">{a.opener}kg</td>
                    <td className="py-2.5 text-right tabular-nums">{a.second}kg</td>
                    <td className="py-2.5 text-right tabular-nums">{a.third}kg</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {pacing && <RacePacingCard pacing={pacing} distanceKm={raceDistanceKm} />}
    </div>
  );
}

/**
 * The splits, under a strategy the athlete chooses.
 *
 * The engine hands over one number — target pace — and a sentence about the
 * first kilometre. That is a pace, not a plan: nobody runs an average, they run
 * kilometre one and then kilometre two, and the question on a start line is
 * what the watch should say at each of them.
 *
 * Every strategy here is rendered from the SAME target time, and the splits
 * always add up to it (`race-pacing.ts` guarantees that by construction, and
 * the tests pin it). Choosing a shape changes how the time is distributed and
 * nothing else — a control that quietly re-targeted the race would be
 * answering a question the athlete did not ask.
 */
function RacePacingCard({ pacing, distanceKm }: { pacing: RacePacing; distanceKm: number }) {
  const [strategy, setStrategy] = useState<PacingStrategy>("even");

  // The target time is the target pace over the race, which is exactly how the
  // engine derived the pace in the first place.
  const totalS = Math.round(pacing.targetPaceSPerKm * distanceKm);
  const plan = useMemo(() => buildPacingPlan(totalS, distanceKm, strategy), [totalS, distanceKm, strategy]);

  // The engine slows the opening kilometre when the race follows a meet. A
  // hard start is then directly against its advice — which is the athlete's
  // call to make, but only if they are told, at the moment they make it.
  const followsMeet = pacing.firstKmPaceSPerKm > pacing.targetPaceSPerKm + 0.5;
  const meta = PACING_STRATEGIES.find((s) => s.id === strategy)!;

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 className="text-lg font-semibold tracking-tight">Race pacing</h2>
        <p className="text-sm text-muted">
          <span className="font-semibold tabular-nums text-foreground">{clockTime(totalS)}</span> for {distanceKm}k ·{" "}
          <span className="tabular-nums">{fmtPace(pacing.targetPaceSPerKm)}</span> average
        </p>
      </div>

      <div className="mt-4 flex gap-1.5 rounded-2xl bg-white/[0.03] p-1.5" role="group" aria-label="Pacing strategy">
        {PACING_STRATEGIES.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setStrategy(s.id)}
            aria-pressed={strategy === s.id}
            className={cn(
              "min-h-11 flex-1 rounded-xl px-2 py-2 text-xs font-medium leading-tight transition-colors",
              strategy === s.id ? "bg-white/[0.08] text-foreground" : "text-muted hover:text-foreground"
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">{meta.summary}</p>

      {/* 20rem is 320px inside 318px: it scrolled by two pixels — a scrollbar
          and a jiggle for nothing. "On the clock" was what forced the width. */}
      <div className="mt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/[0.06] text-left text-xs uppercase tracking-wider text-muted">
              <th className="pb-2 font-medium">Split</th>
              <th className="pb-2 text-right font-medium">Time</th>
              <th className="pb-2 text-right font-medium">Pace</th>
              <th className="pb-2 text-right font-medium">Clock</th>
            </tr>
          </thead>
          <tbody>
            {plan.segments.map((seg) => (
              <tr key={seg.label} className="border-b border-white/[0.04] last:border-0">
                <td className="py-2.5 font-medium">{seg.label}</td>
                <td className="py-2.5 text-right tabular-nums">{mmss(seg.splitS)}</td>
                <td className="py-2.5 text-right">
                  <span className="tabular-nums">{mmss(seg.paceSPerKm)}</span>{" "}
                  <span
                    className={cn(
                      "text-xs tabular-nums",
                      Math.round(seg.deltaSPerKm) === 0
                        ? "text-muted/60"
                        : seg.deltaSPerKm < 0
                          ? "text-endurance"
                          : "text-muted"
                    )}
                  >
                    {deltaLabel(seg.deltaSPerKm)}
                  </span>
                </td>
                <td className="py-2.5 text-right font-semibold tabular-nums">{clockTime(seg.cumulativeS)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted/70">
        These add up to {clockTime(totalS)} exactly. Run the &ldquo;on the clock&rdquo; column — it is the one your watch
        shows, and it is the one that cannot drift.
      </p>

      {/* The engine's own advice, at the point where it is being overridden. */}
      {followsMeet && strategy === "fast_start" && (
        <p className="mt-3 rounded-xl border border-warning/25 bg-warning/[0.06] p-3 text-sm leading-relaxed text-warning/90">
          You are racing the same day as your meet. Your plan asks for an opening kilometre {fmtPace(pacing.firstKmPaceSPerKm)}
          {" "}— slower than target, not faster — because your expressed fitness is down after lifting. A hard start here
          is the one this block least supports.
        </p>
      )}

      <p className="mt-3 text-sm leading-relaxed text-muted">{pacing.note}</p>
    </Card>
  );
}
