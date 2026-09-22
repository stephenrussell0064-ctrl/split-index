"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Link from "next/link";
import { useDialog } from "@/components/ui/use-dialog";
import { formatIndex } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { CardioPersonalComparison } from "@/lib/scoring/cardio-activity";

/**
 * What the "vs you" number means, on tap.
 *
 * ## Why this exists
 *
 * The number is shown as two digits and a decimal with the label "vs you", and
 * nothing anywhere says what it is measured against or where its middle is. The
 * person who commissioned this app asked, of his own score: "does it average at
 * 50?" and "why is my easy run scoring 29.7, is this really that much worse
 * than my median run?".
 *
 * Both answers already existed inside `CardioPersonalComparison` — the sample
 * count, whether the comparison was effort-matched or fell back to pace, and
 * how alike the compared sessions actually were — and none of it was rendered
 * anywhere. The engine had been explaining itself to nobody.
 *
 * The second question is the one this is really for. The personal score is not
 * measured against your median session; it is measured against your sessions AT
 * A SIMILAR INTENSITY. A run at 92% of heart-rate reserve is judged against
 * your hard days, which is why a respectable pace can still read below 50. That
 * is a sentence, not a chart, and no graph would have answered it.
 */

const CENTRE_DISPLAY = 50;

export function PersonalScoreExplainer({
  score,
  comparison,
  onClose,
}: {
  /** The personal score on the stored 0–1000 scale. */
  score: number;
  comparison: CardioPersonalComparison | null;
  onClose: () => void;
}) {
  const { dialogRef, dialogProps } = useDialog(onClose, { label: "How your score against yourself works" });
  const shown = Number(formatIndex(score));
  const better = shown > CENTRE_DISPLAY;
  const level = shown >= 52.5 ? "above" : shown <= 47.5 ? "below" : "at";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:items-center sm:pb-4"
        onClick={onClose}
      >
        <motion.div
          ref={dialogRef}
          {...dialogProps}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          className="glass-strong w-full max-w-lg rounded-2xl border border-white/10 p-6 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">This session, against you</h2>
              <p className="mt-0.5 text-xs text-muted">
                Not how good it was against everyone — that is the other number.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close explanation"
              className="-m-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-muted hover:bg-white/5 hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* The anchor, stated before anything else. It is the single fact that
              makes every other number on this sheet readable. */}
          <p className="text-sm">
            <span className="font-semibold text-foreground">50 is your normal.</span>{" "}
            <span className="text-muted">
              Above it means better than your recent form, below it means worse. Half your sessions
              sit below 50 — that is what “normal” means, not a bad run.
            </span>
          </p>

          <Scale shown={shown} />

          <p className="mt-3 text-sm">
            This session read{" "}
            <span className={cn("font-semibold tabular-nums", better ? "text-success" : "text-warning")}>
              {shown.toFixed(1)}
            </span>
            <span className="text-muted">
              {level === "at"
                ? " — an ordinary day by your own standards."
                : level === "above"
                  ? " — better than your recent form."
                  : " — below your recent form."}
            </span>
          </p>

          {comparison && (
            <div className="mt-4 border-t border-white/5 pt-4">
              <p className="text-[10px] uppercase tracking-wider text-muted">What it was measured against</p>
              <p className="mt-1.5 text-sm text-muted">
                {comparison.comparedWith === "pace-only" ? (
                  <>
                    Your last{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {comparison.sampleCount}
                    </span>{" "}
                    {comparison.sampleCount === 1 ? "session" : "sessions"}, on pace alone. Too few of
                    them were recorded the way this one was, so it cannot tell whether today was
                    harder work for the same pace.
                  </>
                ) : (
                  <>
                    Your last{" "}
                    <span className="font-medium text-foreground tabular-nums">
                      {comparison.sampleCount}
                    </span>{" "}
                    {comparison.sampleCount === 1 ? "session" : "sessions"}{" "}
                    <span className="font-medium text-foreground">at a similar heart rate</span> — not
                    your median session. An easy run is judged against your easy runs, and a hard one
                    against your hard ones.
                  </>
                )}
              </p>

              {comparison.comparedWith !== "pace-only" && comparison.intensityMatch < 0.25 && (
                <p className="mt-2 text-xs text-warning">
                  You have not trained at this heart rate lately, so this reached across intensities
                  to find anything comparable. Treat it as rougher than usual.
                </p>
              )}

              <p className="mt-2 text-sm tabular-nums">
                <span className={cn("font-semibold", comparison.deltaPct > 0 ? "text-success" : "text-warning")}>
                  {comparison.deltaPct > 0 ? "+" : ""}
                  {comparison.deltaPct}%
                </span>
                <span className="text-muted"> against that baseline.</span>
              </p>
            </div>
          )}

          <Link
            href="/how-scoring-works#two-scores"
            className="mt-4 inline-flex min-h-11 items-center text-xs text-accent underline underline-offset-4"
          >
            How both scores are built
          </Link>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Where this session sits, with the athlete's own normal marked on it. */
function Scale({ shown }: { shown: number }) {
  const pct = Math.max(0, Math.min(100, shown));
  return (
    <div className="mt-4" aria-hidden>
      <div className="relative h-2 rounded-full bg-gradient-to-r from-warning/40 via-white/15 to-success/40">
        {/* your normal */}
        <div className="absolute top-1/2 h-4 w-px -translate-y-1/2 bg-white/50" style={{ left: "50%" }} />
        {/* this session */}
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-muted">
        <span>worse</span>
        <span>your normal · 50</span>
        <span>better</span>
      </div>
    </div>
  );
}
