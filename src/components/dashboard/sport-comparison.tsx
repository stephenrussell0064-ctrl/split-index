"use client";

import { motion, useReducedMotion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight, Minus } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import {
  formatHistoryPercentileContext,
  formatLiftRelativeStrength,
  type ExerciseScoreDisplay,
} from "@/lib/utils/scoring-display";
import type { SportComparisonStats } from "@/lib/utils/sport-comparison";

interface SportComparisonPanelProps {
  label: string;
  currentScore: number;
  comparison: SportComparisonStats;
  zone?: "gym" | "cardio";
  benchmarkContext?: string | null;
  exerciseBreakdown?: ExerciseScoreDisplay[];
  strengthContext?: string | null;
  className?: string;
}

export function SportComparisonPanel({
  label,
  currentScore,
  comparison,
  zone = "cardio",
  benchmarkContext,
  exerciseBreakdown,
  strengthContext,
  className,
}: SportComparisonPanelProps) {
  const reducedMotion = useReducedMotion();
  const { history, average, percentile, deltaVsAverage, total } = comparison;
  const maxVal = Math.max(currentScore, ...history, average, 1);
  const deltaColor =
    deltaVsAverage > 0 ? "text-success" : deltaVsAverage < 0 ? "text-danger" : "text-muted";
  const DeltaIcon =
    deltaVsAverage > 0 ? ArrowUpRight : deltaVsAverage < 0 ? ArrowDownRight : Minus;

  const barColor = zone === "gym" ? "bg-gym-accent" : "bg-cardio-accent";
  const textAccent = zone === "gym" ? "text-gym-accent" : "text-cardio-accent";

  return (
    <div className={cn("space-y-4", className)}>
      {benchmarkContext && (
        <p className="text-sm text-muted leading-relaxed">{benchmarkContext}</p>
      )}

      {strengthContext && zone === "gym" && (
        <p className="text-sm font-medium text-foreground/90">{strengthContext}</p>
      )}

      {exerciseBreakdown && exerciseBreakdown.length > 0 && (
        <div className="space-y-2">
          <p className="micro-label text-muted">Relative strength per lift</p>
          <ul className="space-y-1.5">
            {exerciseBreakdown.map((ex) => (
              <li
                key={ex.name}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white/[0.03] px-3 py-2 text-sm"
              >
                <span className="font-medium">{formatLiftRelativeStrength(ex.name, ex.relativeStrength)}</span>
                <span className="text-xs text-muted">{ex.benchmarkLabel}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {total > 0 ? (
        <>
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="micro-label text-muted">
                {formatHistoryPercentileContext(label, percentile, total)}
              </p>
              <span className={cn("text-sm font-semibold tabular-nums", deltaColor)}>
                <DeltaIcon className="inline h-3.5 w-3.5" />
                {formatTrend(deltaVsAverage)} vs avg
              </span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/5">
              <motion.div
                initial={reducedMotion ? { width: `${percentile}%` } : { width: 0 }}
                animate={{ width: `${percentile}%` }}
                transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.2 }}
                className={cn("absolute inset-y-0 left-0 rounded-full", barColor)}
              />
              <div
                className="absolute top-1/2 h-3 w-0.5 -translate-y-1/2 bg-white/60"
                style={{ left: `${percentile}%` }}
              />
            </div>
            <p className="mt-1.5 text-xs text-muted">
              Session avg{" "}
              <span className="tabular-nums font-medium">{formatIndex(average)}</span>
              {" · "}this session{" "}
              <span className={cn("tabular-nums font-semibold", textAccent)}>
                {formatIndex(currentScore)}
              </span>
            </p>
          </div>

          {history.length > 1 && (
            <div>
              <p className="micro-label text-muted mb-2">Sport history</p>
              <div className="flex items-end gap-1 h-10">
                {history.map((score, i) => (
                  <motion.div
                    key={i}
                    initial={reducedMotion ? { height: `${(score / maxVal) * 100}%` } : { height: 0 }}
                    animate={{ height: `${(score / maxVal) * 100}%` }}
                    transition={{ delay: 0.4 + i * 0.04, duration: 0.35 }}
                    className={cn(
                      "flex-1 rounded-t min-h-[3px]",
                      i === history.length - 1
                        ? barColor
                        : zone === "gym"
                          ? "bg-gym-accent/30"
                          : "bg-cardio-accent/30"
                    )}
                  />
                ))}
                <motion.div
                  initial={reducedMotion ? { height: `${(currentScore / maxVal) * 100}%` } : { height: 0 }}
                  animate={{ height: `${(currentScore / maxVal) * 100}%` }}
                  transition={{ delay: 0.7, duration: 0.4 }}
                  className={cn("flex-1 rounded-t ring-1 ring-white/20", barColor)}
                  title="This session"
                />
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">
          First {label.replace(" Index", "")} session logged — your history starts here.
        </p>
      )}
    </div>
  );
}

export function SportScoreSparkline({
  scores,
  zone = "cardio",
}: {
  scores: number[];
  zone?: "gym" | "cardio";
}) {
  if (scores.length === 0) return null;
  const max = Math.max(...scores, 1);
  const barClass = zone === "gym" ? "bg-gym-accent/50" : "bg-cardio-accent/50";

  return (
    <div className="flex items-end gap-0.5 h-6">
      {scores.map((s, i) => (
        <div
          key={i}
          className={cn("flex-1 rounded-t min-h-[2px]", barClass)}
          style={{ height: `${(s / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
