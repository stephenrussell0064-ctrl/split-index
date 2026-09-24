"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Flame } from "lucide-react";
import { Card } from "@/components/ui/card";
import { InfoHint } from "@/components/ui/info-hint";
import { ProgressRing } from "@/components/ui/progress-ring";
import { CountUp } from "@/components/dashboard/count-up";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { tierForScore } from "@/lib/scoring/split-strength-engine";

/**
 * The first thing on the home page, rebuilt around one complaint: nothing on
 * it said what any of the numbers were.
 *
 * The screen it replaces showed "79.3", "-0.1 · 7d" and "0/4" with no word
 * anywhere saying that the first is a score out of 100, that the second is a
 * week-on-week move in that score, or that the third counts sessions (user
 * feedback: "79.3 — it does not say what this score is, -0.1 — no indication
 * of what the score is and the same for 7d"). Every number here now carries
 * its own noun.
 *
 * "Standards rank — Top 12%" is gone from this card. A percentile against a
 * synthetic reference population is not a number lifters or runners use about
 * themselves (user feedback: "training rank is not a normal metric for
 * lifters or athletes"). The tier band beside the score says the same thing in
 * the vocabulary athletes actually use — Intermediate, Advanced, Elite — and
 * the rank itself still exists further down the page for anyone chasing it.
 *
 * The Engine and Lab halves are surfaced here rather than only in the trend
 * chart below the fold, because "what is my endurance vs my strength" is the
 * question this whole product is built to answer and the home page was
 * answering it nowhere on the first screen.
 */

/** Both are the raw 0–1000 internal scale; `formatIndex` does the display rescale. */
export interface IndexHeroProps {
  headlineLabel: string;
  headlineValue: number | null;
  weeklyTrend: number;
  hasHistory: boolean;
  engineIndex: number | null;
  labIndex: number | null;
  streak: number;
  streakAtRisk: boolean;
  weeklySessions: number;
  weeklyTarget?: number;
  /**
   * True when this index came from the onboarding questions rather than from
   * logged training.
   *
   * Shown, and labelled. The estimate used to be computed, stored, and then
   * hidden — the hero was gated on having activities, which calibration does
   * not create, so an athlete was given a number on the last onboarding screen
   * and then told on the next one that their index was unwritten. Showing it
   * silently would be the opposite error: a signup guess presented as measured
   * ability.
   */
  provisional?: boolean;
}

function SubIndex({
  label,
  caption,
  value,
  accentClass,
  hint,
}: {
  label: string;
  caption: string;
  value: number | null;
  accentClass: string;
  /** What this score is, for the "?" beside its label. */
  hint: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="micro-label flex items-center gap-1.5 text-muted/70">
        {label}
        <InfoHint label={`the ${label} score`} title={`Your ${label} score`}>
          {hint}
        </InfoHint>
      </div>
      <p className={cn("index-display mt-0.5 text-xl font-bold tabular-nums", accentClass)}>
        {value !== null ? formatIndex(value) : "TBC"}
      </p>
      <p className="truncate text-[10px] leading-tight text-muted">{caption}</p>
    </div>
  );
}

export function IndexHero({
  headlineLabel,
  headlineValue,
  weeklyTrend,
  hasHistory,
  engineIndex,
  labIndex,
  streak,
  streakAtRisk,
  weeklySessions,
  weeklyTarget = 4,
  provisional = false,
}: IndexHeroProps) {
  const reducedMotion = useReducedMotion();
  /*
   * A provisional index does NOT count as a score.
   *
   * It is derived from the answers given at signup — training age, rough
   * weekly volume, a self-reported lift — and nothing the athlete has
   * actually done. It used to be shown as a number with "Estimated from your
   * answers" underneath, which is honest labelling of a dishonest shape: the
   * eye takes the 62 and not the caption, and the first thing a new athlete
   * sees is a performance figure for training they have not done. Worse, it
   * moves when they log their first real session, so the app appears to have
   * marked them down for turning up.
   *
   * TBC is the truthful rendering. The number returns the moment there is a
   * logged session behind it.
   */
  const showScore = hasHistory && headlineValue !== null && !provisional;

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card glow="accent" padding="sm" className="relative overflow-hidden p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {/*
              The "?" is the answer to the complaint above, one tap from the
              number: what it is, what it is out of, and what the word beside
              it means. The caption underneath stays — it is the answer for
              people who never tap anything.
            */}
            {/* A div, not a p: the "?" opens a sheet with its own paragraphs, and a p cannot contain them. */}
            <div className="micro-label flex items-center gap-1.5 text-muted">
              {headlineLabel}
              <InfoHint label={headlineLabel}>
                <p>
                  Your strength and your endurance, combined into one number out of 100. It is
                  worked out from the sessions you log, and it changes a little after every one.
                </p>
                <p>
                  The word beside it — from Beginner up to World Class — is the band that number
                  falls into. The two smaller scores underneath are the two halves it is made
                  from.
                </p>
              </InfoHint>
            </div>
            {showScore ? (
              <>
                {/*
                  Wraps rather than clips. At 320px the score and the tier pill
                  together wanted 184px in 164, and the Card's `overflow-hidden`
                  cut "ADVANCED" off mid-word — the athlete's rank, missing, on
                  the first thing they see. It drops to its own line instead.
                */}
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <p className="index-display text-5xl font-bold leading-none tracking-tight sm:text-6xl">
                    <CountUp value={headlineValue} format={formatIndex} />
                  </p>
                  <span className="min-w-0 rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
                    {tierForScore(headlineValue)}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-tight text-muted">
                  Strength + endurance, out of 100
                </p>
                {provisional ? (
                  <p className="mt-0.5 text-[11px] font-medium leading-tight text-warning">
                    Estimated from your answers — log a session to make it real
                  </p>
                ) : (
                  <p
                    className={cn(
                      "mt-0.5 text-[11px] font-medium tabular-nums",
                      weeklyTrend > 0 ? "text-success" : weeklyTrend < 0 ? "text-danger" : "text-muted"
                    )}
                  >
                    {weeklyTrend === 0
                      ? "No change over the last 7 days"
                      : `${formatTrend(weeklyTrend)} over the last 7 days`}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="index-display text-5xl font-bold leading-none tracking-tight sm:text-6xl">
                  TBC
                </p>
                <p className="mt-1.5 text-[11px] leading-tight text-muted">
                  Strength + endurance, out of 100
                </p>
                <p className="mt-0.5 text-[11px] font-medium leading-tight text-warning">
                  Log an activity to calculate your Split Index score
                </p>
              </>
            )}
          </div>

          {/*
            THE LABEL INSIDE THE RING WAS 7px, AND THE RING HAD NO NAME.

            "Sessions this week" was set at 7px across two lines inside a 74px
            ring — a size nobody reads, so the ring effectively showed a bare
            "3/4". And the ring itself carried no accessible name at all: the
            SVG has no role or label, so a screen reader got the digits and
            nothing to attach them to.

            Dropping the caption outright would leave sighted users with the
            same bare "3/4". So the wrapper carries the whole sentence for
            assistive tech, the visible caption becomes one legible word, and
            the inner text is hidden from the accessibility tree because the
            wrapper already says all of it — otherwise it is announced twice.

            Labelled from here rather than by adding a prop to ProgressRing:
            it is one caller that needs this, and components/ui is another
            session's lane this week.
          */}
          <div
            role="img"
            aria-label={`${weeklySessions} of ${weeklyTarget} sessions logged this week`}
          >
            <ProgressRing
              progress={weeklyTarget > 0 ? weeklySessions / weeklyTarget : 0}
              size={74}
              strokeWidth={6}
              colorClassName={weeklySessions >= weeklyTarget ? "text-success" : "text-accent"}
              trackClassName="text-white/8"
            >
              <div className="text-center" aria-hidden>
                <p className="index-display text-base font-bold leading-none tabular-nums">
                  {weeklySessions}
                  <span className="text-[11px] text-muted">/{weeklyTarget}</span>
                </p>
                <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  Sessions
                </p>
              </div>
            </ProgressRing>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-3">
          {/*
            Plain word as the label, product name as the caption — it was the
            other way round ("Engine" over "Endurance score"), which is the
            order that made a new athlete ask what an engine had to do with
            running. Same words, same order, as the tab bar.
          */}
          <SubIndex
            label="Endurance"
            caption="The Engine · out of 100"
            value={provisional ? null : engineIndex}
            accentClass="text-endurance"
            hint={
              <p>
                How your running, cycling, rowing and swimming compare with published standards
                for your age and sex, out of 100. Built from the endurance sessions you log — the
                app calls this side of your training The Engine.
              </p>
            }
          />
          <SubIndex
            label="Strength"
            caption="The Lab · out of 100"
            value={provisional ? null : labIndex}
            accentClass="text-strength"
            hint={
              <p>
                How your lifting compares with published strength standards for your bodyweight,
                age and sex, out of 100. Built from the gym sessions you log — the app calls this
                side of your training The Lab.
              </p>
            }
          />
          <div className="min-w-0">
            <p className="micro-label text-muted/70">Streak</p>
            <p
              className={cn(
                "index-display mt-0.5 flex items-center gap-1 text-xl font-bold tabular-nums",
                streakAtRisk ? "text-warning" : streak > 0 ? "text-foreground" : "text-muted"
              )}
            >
              <Flame className="h-3.5 w-3.5 shrink-0" />
              {streak}
            </p>
            <p className="truncate text-[10px] leading-tight text-muted">
              {streakAtRisk ? "Log today to keep it" : streak === 1 ? "Day in a row" : "Days in a row"}
            </p>
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
