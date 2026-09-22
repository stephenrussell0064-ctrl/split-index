"use client";

import { TrendingUp, TrendingDown, Minus, Target } from "lucide-react";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { isBodyweightOnlyExercise } from "@/lib/scoring/weight-entry";
import { cn } from "@/lib/utils/cn";
import type { StrengthEstimate } from "./types";

/**
 * Adaptive 1RM, per lift.
 *
 * "I want the adaptive 1RM prediction for each exercise in the analytics page
 * redesigned and easier to read — currently it is ugly and hard to look at."
 *
 * What it was, measured at 375px: each lift was a two-line box holding four
 * numbers. Line one put the exercise name against a three-part cluster (trend
 * arrow, the 1RM, and the word "now"), so a name like "Barbell Bench Press"
 * squeezed the number it belonged to. Line two set "BEST 107.5 kg" beside a
 * bare "96.3–108.1 kg" with nothing saying the second was a confidence range.
 * Every one of those values was rendered between 10px and 14px, so the
 * prediction — the reason the section exists — was the same size as the labels
 * around it, and a dozen lifts arrived in whatever order the query returned
 * them, at identical weight, with two paragraphs of explainer stacked on top.
 * Nothing told the reader whether 99.8 kg was good.
 *
 * Same rule as the logbook and plan-view redesigns: primary content first, at
 * a size that says so; everything else subordinate but still visible.
 *
 * - Context comes from a meter reading current against the athlete's own
 *   all-time best, which is the only honest yardstick available here — no
 *   population comparison is claimed, and the percentage is written out so the
 *   bar is never the only place a value lives.
 * - Heaviest first, so the main lifts lead and the order is stable between
 *   visits rather than an artifact of row order.
 * - The bodyweight-only caveat is attached to the lifts it applies to instead
 *   of sitting in a paragraph above lifts it does not.
 *
 * ## Compressed again, 22 Sep 2026
 *
 * "They are too large and this impacts the UI visuals." The redesign above
 * fixed legibility and spent height doing it: five lines and 16px of padding
 * per lift, so a dozen lifts pushed everything below them off the page.
 *
 * Three lines now, at 10px padding. What went, and why none of it was the
 * information:
 *
 * - The name had a line to itself with the number on the next one, and both
 *   lines were mostly empty. They share a line now, name truncating rather
 *   than wrapping — at two-to-four columns a wrapped name moved the number.
 * - The 1RM came down from 2rem to 1.4rem. It is still by some way the largest
 *   thing on the row, which was the point of making it large.
 * - The trend WORD is now `sr-only`. Colour and an icon alone do not state a
 *   trend to a screen reader, which is why the word existed — it is still
 *   announced, just not drawn.
 * - "92% of your best · 4.1 kg to go" and "Best 107.5 kg" were two lines; they
 *   are one, and the gap in kg went because the percentage and the best are
 *   both there and the subtraction is not the reader's job.
 * - The confidence band was a fourth line reading "Likely range 96.3–108.1 kg".
 *   It is now "±5.9" on the same micro line: the same claim about precision,
 *   without restating two numbers the reader can already see bracketed.
 */

const TREND_META = {
  up: { Icon: TrendingUp, label: "Rising", className: "text-success" },
  down: { Icon: TrendingDown, label: "Falling", className: "text-danger" },
  flat: { Icon: Minus, label: "Steady", className: "text-muted" },
} as const;

/** Within this much of the all-time best, the gap is rounding noise, not a deficit worth reporting. */
const AT_BEST_TOLERANCE_KG = 0.05;

function trendMeta(trend: StrengthEstimate["trend"]) {
  return TREND_META[trend ?? "flat"];
}

function AddedLoadTag() {
  return (
    <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted">
      added
    </span>
  );
}

function LiftRow({ est, showConfidence }: { est: StrengthEstimate; showConfidence: boolean }) {
  const { Icon, label, className } = trendMeta(est.trend);
  const best = Math.max(est.allTime1RmKg, est.current1RmKg);
  // A lift with no usable best can't be put on a scale — show the number and
  // skip the meter rather than drawing a bar against a denominator of zero.
  const hasScale = best > 0;
  const pctOfBest = hasScale ? Math.min(100, Math.round((est.current1RmKg / best) * 100)) : 0;
  const gapKg = best - est.current1RmKg;
  const atBest = gapKg <= AT_BEST_TOLERANCE_KG;
  const addedLoadOnly = isBodyweightOnlyExercise(est.exerciseName);

  return (
    <li className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      {/* Name and number share a line. They were stacked with the number on its
          own row at 2rem, which is what made a dozen lifts scroll: the name line
          was mostly empty and the number line was mostly empty, twice per lift. */}
      <div className="flex items-baseline gap-2">
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium leading-tight text-foreground">
          {est.exerciseName}
        </p>
        {addedLoadOnly && <AddedLoadTag />}
        <Icon className={cn("h-3.5 w-3.5 shrink-0", className)} aria-hidden />
        {/* The trend word is still said, just not drawn — colour and an icon
            alone do not state it to a screen reader, which is why the word was
            there. Keeping it visible cost a whole line per lift. */}
        <span className="sr-only">{label}</span>
        <span className="shrink-0 index-display text-[1.4rem] font-semibold leading-none text-foreground [font-variant-numeric:proportional-nums]">
          {est.current1RmKg.toFixed(1)}
        </span>
        <span className="shrink-0 text-[11px] font-medium text-muted">kg</span>
      </div>

      {hasScale && (
        <>
          {/* Unfilled track is a dimmer step of the fill's own hue, so the whole
              bar reads as one scale. aria-hidden because every value it encodes
              is written out on the line below it. */}
          <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-accent/[0.18]" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${pctOfBest}%` }} />
          </div>
          {/* One micro line carries what used to take two, plus the confidence
              band that had a line of its own below them. */}
          <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 text-[10.5px] leading-tight text-muted">
            {atBest ? (
              <span className="font-medium text-foreground/80">At your best</span>
            ) : (
              <span>
                <span className="tabular-nums text-foreground/80">{pctOfBest}%</span> of best
              </span>
            )}
            {/* The unit rides on the last number rather than each one: three
                bare figures in a row read as three unrelated quantities. */}
            <span className="tabular-nums">
              best {best.toFixed(1)}
              {!(showConfidence && est.bandKg) && " kg"}
            </span>
            {showConfidence && est.bandKg && (
              <span className="tabular-nums">
                ±{((est.bandKg[1] - est.bandKg[0]) / 2).toFixed(1)} kg
              </span>
            )}
          </p>
        </>
      )}
    </li>
  );
}

export function AdaptiveOneRmList({
  strengthEstimates,
  showConfidence,
}: {
  strengthEstimates: StrengthEstimate[];
  showConfidence: boolean;
}) {
  if (strengthEstimates.length === 0) return null;

  // Heaviest first — a stable, meaningful order that puts the main lifts at
  // the top. The source query returns whatever order it likes, which meant the
  // list could reshuffle between visits for no reason the reader could see.
  const ordered = [...strengthEstimates].sort(
    (a, b) => b.current1RmKg - a.current1RmKg || a.exerciseName.localeCompare(b.exerciseName)
  );
  const hasAddedLoadOnly = ordered.some((est) => isBodyweightOnlyExercise(est.exerciseName));

  return (
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Target className="h-3.5 w-3.5 text-accent" aria-hidden />
          Adaptive 1RM
        </h4>
        <span className="shrink-0 text-[11px] text-muted">
          {ordered.length} lift{ordered.length === 1 ? "" : "s"}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        What your recent training says you could lift today, against the heaviest you have ever hit.
      </p>
      <ScoringExplainerNote href="/how-scoring-works#one-rm" className="mb-3 mt-1.5">
        The big number falls when your sessions do;{" "}
        <strong className="not-italic text-foreground/90">Best</strong> only moves when you beat it.
      </ScoringExplainerNote>

      <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ordered.map((est) => (
          <LiftRow key={est.exerciseName} est={est} showConfidence={showConfidence} />
        ))}
      </ul>

      {hasAddedLoadOnly && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Lifts tagged <span className="font-medium uppercase tracking-wider">added</span> (Pull Up,
          Push Up, Dip, Muscle Up) show the extra weight a weighted version would need to be equally
          hard for one rep — not your bodyweight itself.
        </p>
      )}
    </section>
  );
}
