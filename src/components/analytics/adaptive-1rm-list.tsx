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
 * - The 1RM is the only large thing in the row and gets its own line.
 * - Context comes from a meter reading current against the athlete's own
 *   all-time best, which is the only honest yardstick available here — no
 *   population comparison is claimed, and the percentage and the gap in kg are
 *   both written out so the bar is never the only place a value lives.
 * - Heaviest first, so the main lifts lead and the order is stable between
 *   visits rather than an artifact of row order.
 * - Trend carries an icon *and* a word; color alone never states it.
 * - The bodyweight-only caveat is attached to the lifts it applies to instead
 *   of sitting in a paragraph above lifts it does not.
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
    <li className="rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex items-start justify-between gap-3">
        {/* Wraps rather than truncates: the name is the row's identity, and a
            clipped "Dumbbell Incline Bench Pr…" is indistinguishable from the
            barbell lift of the same name. */}
        <p className="min-w-0 flex-1 text-sm font-medium leading-snug text-foreground">
          {est.exerciseName}
        </p>
        <span className={cn("flex shrink-0 items-center gap-1 text-[11px] font-medium", className)}>
          <Icon className="h-3.5 w-3.5" aria-hidden />
          {label}
        </span>
      </div>

      <p className="mt-2 flex items-baseline gap-1.5">
        {/* Proportional figures: tabular-nums gives every digit the width of a
            zero, which reads loose at display size. The small paired numbers
            below stay tabular — those do sit in aligned pairs. */}
        <span className="index-display text-[2rem] font-semibold text-foreground [font-variant-numeric:proportional-nums]">
          {est.current1RmKg.toFixed(1)}
        </span>
        <span className="text-sm font-medium text-muted">kg</span>
        {addedLoadOnly && <AddedLoadTag />}
      </p>

      {hasScale && (
        <div className="mt-3">
          {/* Unfilled track is a dimmer step of the fill's own hue, so the
              whole bar reads as one scale. aria-hidden because the percentage
              and the gap are both written out beside it — the bar is never the
              only place a value lives. */}
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-accent/[0.18]" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${pctOfBest}%` }} />
          </div>
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[11px] text-muted">
            <span>
              {atBest ? (
                // The filled bar beside it already carries the accent — text
                // never wears the data colour, or the palette stops meaning
                // anything.
                <span className="font-medium text-foreground/80">At your all-time best</span>
              ) : (
                <>
                  <span className="tabular-nums text-foreground/80">{pctOfBest}%</span> of your best
                  {" · "}
                  <span className="tabular-nums">{gapKg.toFixed(1)} kg</span> to go
                </>
              )}
            </span>
            <span className="tabular-nums">Best {best.toFixed(1)} kg</span>
          </div>
        </div>
      )}

      {showConfidence && est.bandKg && (
        // 11px at full --muted, not a dimmed step: below about 4.5:1 this line
        // stops being readable on the near-black surface, and it is the one
        // that admits how precise the estimate actually is.
        <p className="mt-1.5 text-[11px] text-muted">
          Likely range{" "}
          <span className="tabular-nums">
            {est.bandKg[0].toFixed(1)}–{est.bandKg[1].toFixed(1)} kg
          </span>
        </p>
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

      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
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
