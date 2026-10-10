"use client";

import { useState } from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * "How did that go?" — the only thing that has ever written to
 * `hpe_session_feedback`.
 *
 * The table has existed since migration 040 with two readers and no writers, so
 * everything downstream was built and inert: `autoregulate` (F16) returned a
 * volume multiplier of 1 every single time, `applyLowCapacityDay` (F17) was
 * reachable only from its own tests, and fleet monitoring reported 100%
 * abandonment for every athlete by construction. The plan could not adapt to
 * the athlete because nothing ever told it what the athlete did.
 *
 * DELIBERATELY THREE BUTTONS, NOT A FORM. The moment to capture this is
 * seconds after a session, on a phone, by someone who is tired — anything that
 * takes longer than one tap does not get filled in, and an adaptive engine fed
 * by nobody is the state this is fixing.
 *
 * The distinction between the first two buttons is the one the engine actually
 * needs: "completed AND met prescription" versus "completed but did not". A
 * session finished at eighty per cent is not a skipped session and is not a
 * successful one, and `autoregulate` steps the next week back only on a run of
 * the middle case.
 */

type Outcome = "hit" | "short" | "missed";

const OPTIONS: { value: Outcome; label: string; hint: string }[] = [
  { value: "hit", label: "Nailed it", hint: "Completed as prescribed" },
  { value: "short", label: "Came up short", hint: "Completed, but under the target" },
  { value: "missed", label: "Missed it", hint: "Did not do this session" },
];

/**
 * Session RPE, 1-10, offered once the athlete has said the session happened.
 *
 * The route has validated and stored `sessionRpe` since the control was
 * written, and `computeAdherence` averages it into `meanSessionRpe` — but no
 * client ever sent it, so the number was null for every athlete and the
 * adherence metric was permanently blind to how hard the week felt. Still
 * optional, still one tap, and never shown for a missed session: there is no
 * effort to rate.
 */
const RPE_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export function SessionFeedbackControl({
  sessionId,
  initial = null,
  className,
}: {
  /** The stored `hpe_sessions` id. Null when the plan has not been persisted yet — the control hides rather than posting into nothing. */
  sessionId: string | null;
  initial?: Outcome | null;
  className?: string;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(initial);
  const [rpe, setRpe] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  if (!sessionId) return null;

  /**
   * One row per session, upserted — so every post carries the whole answer.
   * Rating the effort re-sends the outcome it belongs to, and choosing a
   * different outcome keeps the rating unless the session is now "missed".
   */
  async function post(next: Outcome, nextRpe: number | null) {
    setSaving(true);
    setError(false);
    // Optimistic: the athlete has told us what happened, and the value is
    // theirs either way. A failure puts it back.
    const previousOutcome = outcome;
    const previousRpe = rpe;
    setOutcome(next);
    setRpe(nextRpe);
    try {
      const res = await fetch("/api/hpe/session-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          completed: next !== "missed",
          metPrescription: next === "hit",
          sessionRpe: next === "missed" ? null : nextRpe,
        }),
      });
      if (!res.ok) {
        setOutcome(previousOutcome);
        setRpe(previousRpe);
        setError(true);
      }
    } catch {
      setOutcome(previousOutcome);
      setRpe(previousRpe);
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  const record = (next: Outcome) => post(next, next === "missed" ? null : rpe);
  const rate = (value: number) => {
    if (!outcome || outcome === "missed") return;
    void post(outcome, value);
  };

  return (
    <div className={cn("mt-3", className)}>
      <p className="micro-label mb-1.5 text-muted/70">How did it go?</p>
      <div className="flex flex-wrap gap-1.5">
        {OPTIONS.map((option) => {
          const active = outcome === option.value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.hint}
              aria-pressed={active}
              disabled={saving}
              onClick={() => record(option.value)}
              className={cn(
                "flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? option.value === "missed"
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-accent/40 bg-accent/10 text-accent"
                  : "border-white/10 text-muted hover:border-white/20 hover:text-foreground",
                saving && "opacity-60"
              )}
            >
              {active &&
                (option.value === "missed" ? (
                  <X className="h-3 w-3" aria-hidden />
                ) : (
                  <Check className="h-3 w-3" aria-hidden />
                ))}
              {option.label}
            </button>
          );
        })}
      </div>
      {outcome && outcome !== "missed" && (
        <div className="mt-2">
          <p className="micro-label mb-1 text-muted/70">How hard was it? (optional)</p>
          <div
            role="radiogroup"
            aria-label="Session RPE, 1 easy to 10 maximal"
            className="flex flex-wrap gap-1"
          >
            {RPE_OPTIONS.map((value) => {
              const active = rpe === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`RPE ${value}`}
                  disabled={saving}
                  onClick={() => rate(value)}
                  className={cn(
                    "flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums transition-colors",
                    active
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-white/10 text-muted hover:border-white/20 hover:text-foreground",
                    saving && "opacity-60"
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {error && (
        <p className="mt-1.5 text-xs text-danger">
          That didn&apos;t save. Tap again when you have signal.
        </p>
      )}
      {outcome && !error && (
        <p className="mt-1.5 text-xs text-muted">
          Next week&apos;s volume takes this into account.
        </p>
      )}
    </div>
  );
}
