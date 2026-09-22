"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import Link from "next/link";
import { useDialog } from "@/components/ui/use-dialog";
import { ScoreTrendChart } from "@/components/scoring/score-trend-chart";
import { formatIndex } from "@/lib/utils/format";
import {
  nextStandardsTierTarget,
  percentileForScore,
  PERCENTILE_TO_SCORE,
} from "@/lib/scoring/percentile-framework";

/**
 * What the Engine and Lab numbers mean, on tap.
 *
 * ## Why these two share a sheet and the personal score does not
 *
 * Engine and Lab are the same KIND of number: an absolute score against
 * calibrated standards, on one 0–100 scale, with tier boundaries that mean the
 * same thing in both. "vs you" is a different question entirely — it centres on
 * the athlete's own moving median and has no tiers at all — which is why it has
 * its own sheet rather than a third mode of this one.
 *
 * ## What an athlete was actually shown before this
 *
 * A number and a tier word. Nothing said what the number was compared against,
 * what the tiers were, or how far the next one was — even though
 * `percentileForScore` and `nextStandardsTierTarget` had been sitting in
 * percentile-framework.ts the whole time, computing exactly that.
 *
 * The percentile is the honest part and is stated as such: these are calibrated
 * standards, not a poll of this app's users, so "better than 72% of athletes"
 * would be a claim about a population nobody sampled. It says "the 72nd
 * percentile of the standards" instead, which is what the number actually is.
 */

export function StandardsScoreExplainer({
  score,
  variant,
  seriesKey,
  tier,
  onClose,
}: {
  /** The score on the stored 0–1000 scale. */
  score: number;
  variant: "engine" | "lab";
  /** Sport for engine, exercise name for lab — the series to chart. */
  seriesKey?: string | null;
  tier?: string | null;
  onClose: () => void;
}) {
  const isEngine = variant === "engine";
  const title = isEngine ? "Your Engine score" : "Your Lab score";
  const { dialogRef, dialogProps } = useDialog(onClose, { label: `How ${title} works` });

  const shown = Number(formatIndex(score));
  const percentile = Math.round(percentileForScore(score));
  const next = nextStandardsTierTarget(score);

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
              <h2 className="font-semibold">{title}</h2>
              <p className="mt-0.5 text-xs text-muted">
                Against calibrated standards — not against your own recent form. That is the other
                number.
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

          <p className="text-sm text-muted">
            {isEngine ? (
              <>
                Every cardio session is first reduced to one number: the time it implies you could
                post at your sport&rsquo;s benchmark distance, had the effort been maximal, on flat
                ground, in fair weather. Hills, heat, cold and how hard your heart was working are
                all taken out before the comparison, so a hilly run in the cold is not punished for
                being one.
              </>
            ) : (
              <>
                Each lift is scored against its own calibrated anchor — the strength-to-bodyweight
                ratio that reads 50 for that exact movement. A lateral raise and a squat sit on
                different curves rather than sharing one multiplier. Your age and sex move the
                standard you are measured against, not your own number.
              </>
            )}
          </p>

          <TierScale shown={shown} />

          <p className="mt-3 text-sm">
            This read{" "}
            <span className="font-semibold tabular-nums text-foreground">{shown.toFixed(1)}</span>
            {tier && <span className="text-muted"> · {tier}</span>}
            <span className="text-muted">
              {" "}
              — the {percentile}
              {ordinal(percentile)} percentile of the standards.
            </span>
          </p>

          {/* Deliberately not "better than N% of users". These are calibrated
              standards, not a sample of this app's athletes, and claiming a
              population nobody measured would be the easiest lie here to tell. */}
          <p className="mt-1 text-[11px] text-muted">
            The standards come from published lifting and endurance tables, not from other people
            using this app.
          </p>

          {next && (
            <p className="mt-2 text-sm text-muted">
              <span className="font-medium text-foreground tabular-nums">
                {(next.pointsToClose / 10).toFixed(1)}
              </span>{" "}
              points to reach {next.label}.
            </p>
          )}

          <ScoreTrendChart
            kind={isEngine ? "cardio" : "strength"}
            seriesKey={seriesKey}
            metric="population"
            heading={isEngine ? "Your last {n} sessions in this sport" : "Your last {n} sessions on this lift"}
            seriesName={title}
            footnote={
              isEngine
                ? "This one does not move with you: a rise here is a real change in what you could post on race day."
                : "This one does not move with you: a rise here is a real change in what you could lift."
            }
          />

          <Link
            href="/how-scoring-works"
            className="mt-4 inline-flex min-h-11 items-center text-xs text-accent underline underline-offset-4"
          >
            How both scores are built
          </Link>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function ordinal(n: number): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return "th";
  return ["th", "st", "nd", "rd"][n % 10] ?? "th";
}

/**
 * The tier boundaries, with this score marked. The bands are the point: a bare
 * 0–100 bar says nothing about whether 62 is good.
 *
 * DERIVED, NOT TYPED OUT. The first draft of this hardcoded them and got two of
 * six wrong — Semi-Pro starts at 47.5 and Advanced at 72.5, not the round 50
 * and 70 they look like. A mislabelled scale is worse than no scale, and this
 * is the same table the score curve was calibrated against, so it should be
 * read rather than remembered.
 */
const BANDS = [
  { label: "Beginner", at: 0 },
  { label: "Intermediate", at: PERCENTILE_TO_SCORE[20] / 10 },
  { label: "Semi-Pro", at: PERCENTILE_TO_SCORE[50] / 10 },
  { label: "Advanced", at: PERCENTILE_TO_SCORE[80] / 10 },
  { label: "Elite", at: PERCENTILE_TO_SCORE[95] / 10 },
  { label: "World Class", at: PERCENTILE_TO_SCORE[99] / 10 },
];

function TierScale({ shown }: { shown: number }) {
  const pct = Math.max(0, Math.min(100, shown));
  return (
    <div className="mt-4" aria-hidden>
      <div className="relative h-2 overflow-hidden rounded-full bg-gradient-to-r from-white/10 via-white/20 to-success/50">
        {BANDS.slice(1).map((b) => (
          <div
            key={b.label}
            className="absolute top-0 h-full w-px bg-black/40"
            style={{ left: `${b.at}%` }}
          />
        ))}
        <div
          className="absolute top-1/2 h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
          style={{ left: `${pct}%` }}
        />
      </div>
      <div className="mt-1 flex justify-between text-[9px] text-muted">
        <span>Beginner</span>
        <span>Semi-Pro</span>
        <span>Advanced</span>
        <span>Elite</span>
      </div>
    </div>
  );
}
