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
  const [saving, setSaving] = useState<Outcome | null>(null);
  const [error, setError] = useState(false);

  if (!sessionId) return null;

  async function record(next: Outcome) {
    setSaving(next);
    setError(false);
    // Optimistic: the athlete has told us what happened, and the value is
    // theirs either way. A failure puts it back.
    const previous = outcome;
    setOutcome(next);
    try {
      const res = await fetch("/api/hpe/session-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          completed: next !== "missed",
          metPrescription: next === "hit",
        }),
      });
      if (!res.ok) {
        setOutcome(previous);
        setError(true);
      }
    } catch {
      setOutcome(previous);
      setError(true);
    } finally {
      setSaving(null);
    }
  }

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
              disabled={saving !== null}
              onClick={() => record(option.value)}
              className={cn(
                "flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? option.value === "missed"
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-accent/40 bg-accent/10 text-accent"
                  : "border-white/10 text-muted hover:border-white/20 hover:text-foreground",
                saving !== null && "opacity-60"
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
