"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import type { EventOrderResult } from "@/lib/scoring/hpe";

/**
 * WP9 — the Stage F trade-off screen.
 *
 * Assurance finding F11 (Critical) is the whole reason this screen exists in
 * this shape: "Maximal deadlift attempts with fatigued erectors, compromised
 * bracing and depleted glycogen are not merely lighter — they are the highest-
 * risk lumbar loading scenario in the sport, attempted in the worst possible
 * state. A coach does not let an athlete trade that off against a priority
 * weighting."
 *
 * So race-first is presented as a SAFETY BLOCK, not as the cheaper option
 * with a warning attached. The cost figures for both orders are still shown —
 * hiding them would be paternalistic and the athlete can find them anyway —
 * but choosing the blocked order requires typing the confirmation phrase.
 * A checkbox is dismissed without reading; typing is not.
 */

const CONFIRM_PHRASE = "I ACCEPT THE RISK";

export function EventOrderDecision({
  order,
  onOverride,
  overridden = false,
}: {
  order: EventOrderResult;
  onOverride?: (confirmed: boolean) => void;
  overridden?: boolean;
}) {
  const [typed, setTyped] = useState("");
  const [expanded, setExpanded] = useState(false);
  const matches = typed.trim().toUpperCase() === CONFIRM_PHRASE;

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

  return (
    <Card>
      <h2 className="text-lg font-semibold tracking-tight">Which event first?</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Both events on one day means one of them is done tired. This is what each order costs.
      </p>

      <div className="mt-5 space-y-3">
        {order.options.map((option) => {
          const recommended = option.order === order.recommended;
          return (
            <div
              key={option.order}
              className={cn(
                "rounded-2xl border p-4",
                recommended
                  ? "border-endurance/30 bg-endurance/[0.06]"
                  : option.safe
                    ? "border-white/[0.06] bg-white/[0.02]"
                    : "border-danger/30 bg-danger/[0.06]"
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{option.order}</span>
                {recommended && (
                  <span className="rounded-full bg-endurance/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-endurance">
                    Recommended
                  </span>
                )}
                {!option.safe && (
                  <span className="rounded-full bg-danger/20 px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wider text-danger">
                    Safety block
                  </span>
                )}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-xs text-muted">Total</p>
                  <p className="font-semibold tabular-nums">
                    {option.totalKg.toFixed(1)}kg
                    {option.totalCostKg > 0.05 && (
                      <span className="ml-1.5 text-xs font-normal text-danger">−{option.totalCostKg.toFixed(1)}kg</span>
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted">5k</p>
                  <p className="font-semibold tabular-nums">
                    {fmt(option.fiveKS)}
                    {option.fiveKCostS > 0.5 && (
                      <span className="ml-1.5 text-xs font-normal text-danger">+{option.fiveKCostS.toFixed(0)}s</span>
                    )}
                  </p>
                </div>
              </div>

              {!option.safe && (
                <p className="mt-3 text-sm leading-relaxed text-danger/90">{option.safetyNote}</p>
              )}
            </div>
          );
        })}
      </div>

      {order.safetyConstrained && (
        <p className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm leading-relaxed text-muted">
          The recommendation above is <span className="font-semibold text-foreground">safety-constrained, not
          cost-optimal</span>. Note also that federation weigh-in timing often forces the meet-first order regardless
          of preference.
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-muted/70">{order.confidenceNote}</p>

      {/* The override. Deliberately buried one interaction deep and gated on
          typed confirmation — a checkbox next to a safety block is a checkbox
          people tick without reading. */}
      {order.safetyConstrained && onOverride && (
        <div className="mt-5 border-t border-white/[0.06] pt-4">
          {overridden ? (
            <div className="rounded-2xl border border-danger/30 bg-danger/[0.06] p-4">
              <p className="text-sm font-semibold text-danger">Racing first, against the recommendation.</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Your event-day plan now instructs conservative deadlift attempts. Reduce every one of them — bracing
                and erector function are measurably impaired after a maximal 5k.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => {
                  setTyped("");
                  onOverride(false);
                }}
              >
                Go back to the recommended order
              </Button>
            </div>
          ) : !expanded ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-xs font-medium text-muted transition-colors hover:text-foreground"
            >
              I need to race first anyway
            </button>
          ) : (
            <div>
              <p className="text-sm leading-relaxed text-foreground/90">
                Racing first means maximal deadlifts on fatigued erectors. This is a lumbar injury risk, not a
                performance trade-off, and it is why the engine will not choose it for you.
              </p>
              <p className="mt-3 text-sm text-muted">
                Type <span className="font-mono font-semibold text-foreground">{CONFIRM_PHRASE}</span> to override.
              </p>
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                aria-label={`Type ${CONFIRM_PHRASE} to override the safety recommendation`}
                className="mt-2 font-mono"
              />
              <div className="mt-3 flex gap-2">
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={!matches}
                  onClick={() => onOverride(true)}
                >
                  Override
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setExpanded(false);
                    setTyped("");
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
