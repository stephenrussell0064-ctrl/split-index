"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Flame } from "lucide-react";
import { Card } from "@/components/ui/card";
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
}

function SubIndex({
  label,
  caption,
  value,
  accentClass,
}: {
  label: string;
  caption: string;
  value: number | null;
  accentClass: string;
}) {
  return (
    <div className="min-w-0">
      <p className="micro-label text-muted/70">{label}</p>
      <p className={cn("index-display mt-0.5 text-xl font-bold tabular-nums", accentClass)}>
        {value !== null ? formatIndex(value) : "—"}
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
}: IndexHeroProps) {
  const reducedMotion = useReducedMotion();
  const showScore = hasHistory && headlineValue !== null;

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card glow="accent" padding="sm" className="relative overflow-hidden p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="micro-label text-muted">{headlineLabel}</p>
            {showScore ? (
              <>
                <div className="flex items-baseline gap-2">
                  <p className="index-display text-5xl font-bold leading-none tracking-tight sm:text-6xl">
                    <CountUp value={headlineValue} format={formatIndex} />
                  </p>
                  <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-foreground/80">
                    {tierForScore(headlineValue)}
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] leading-tight text-muted">
                  Strength + endurance, out of 100
                </p>
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
              </>
            ) : (
              <>
                <p className="headline-tight mt-0.5 text-xl font-bold">Nothing scored yet</p>
                <p className="mt-1 text-[11px] leading-tight text-muted">
                  Log a session and your Split Index appears here.
                </p>
              </>
            )}
          </div>

          <ProgressRing
            progress={weeklyTarget > 0 ? weeklySessions / weeklyTarget : 0}
            size={74}
            strokeWidth={6}
            colorClassName={weeklySessions >= weeklyTarget ? "text-success" : "text-accent"}
            trackClassName="text-white/8"
          >
            <div className="text-center">
              <p className="index-display text-base font-bold leading-none tabular-nums">
                {weeklySessions}
                <span className="text-[11px] text-muted">/{weeklyTarget}</span>
              </p>
              <p className="mt-0.5 text-[7px] font-semibold uppercase tracking-wider text-muted">
                Sessions
                <br />
                this week
              </p>
            </div>
          </ProgressRing>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/[0.06] pt-3">
          <SubIndex
            label="Engine"
            caption="Endurance score"
            value={engineIndex}
            accentClass="text-endurance"
          />
          <SubIndex
            label="Lab"
            caption="Strength score"
            value={labIndex}
            accentClass="text-strength"
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
