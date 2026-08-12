"use client";

import { Card } from "@/components/ui/card";
import type { AttemptSelection, EventDayStep, RacePacing, TaperDay } from "@/lib/scoring/hpe";

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
}: {
  taper: TaperDay[];
  eventDay: EventDayStep[] | null;
  attempts: AttemptSelection[];
  pacing: RacePacing | null;
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
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[22rem] text-sm">
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

      {pacing && (
        <Card>
          <h2 className="text-lg font-semibold tracking-tight">Race pacing</h2>
          <div className="mt-3 flex flex-wrap gap-6">
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">Target</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">{fmtPace(pacing.targetPaceSPerKm)}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted">First kilometre</p>
              <p className="mt-0.5 text-xl font-semibold tabular-nums">{fmtPace(pacing.firstKmPaceSPerKm)}</p>
            </div>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">{pacing.note}</p>
        </Card>
      )}
    </div>
  );
}
