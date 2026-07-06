"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { CountUp } from "@/components/dashboard/count-up";

interface CompositeIndexCardProps {
  value: number | null;
  weeklyTrend?: number;
  enduranceIndex?: number | null;
  strengthIndex?: number | null;
  hasHistory: boolean;
  className?: string;
}

export function CompositeIndexCard({
  value,
  weeklyTrend = 0,
  enduranceIndex,
  strengthIndex,
  hasHistory,
  className,
}: CompositeIndexCardProps) {
  const reducedMotion = useReducedMotion();

  if (!hasHistory || value === null) {
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className={cn(
          "glass-strong holographic-border relative overflow-hidden rounded-2xl p-6 text-center",
          className
        )}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_0%,rgba(99,102,241,0.1),transparent)]"
        />
        <div className="relative">
          <Sparkles className="mx-auto mb-3 h-6 w-6 text-accent/60" />
          <p className="micro-label text-muted mb-2">Split Index</p>
          <p className="text-lg font-semibold tracking-tight">
            Log workouts to build your index
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            50% endurance blend + 50% strength blend. Your hybrid score earns itself
            session by session — no baseline guesswork.
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={cn("glass rounded-2xl p-5 border border-white/[0.06]", className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="micro-label text-muted mb-1">Composite Split Index</p>
          <div className="flex items-baseline gap-3">
            <p className="index-display text-3xl font-bold tabular-nums">
              <CountUp value={value} format={formatIndex} />
            </p>
            {weeklyTrend !== 0 && (
              <span
                className={cn(
                  "text-sm font-semibold tabular-nums",
                  weeklyTrend > 0 ? "text-success" : "text-danger"
                )}
              >
                {formatTrend(weeklyTrend)} · 7d
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted">
            Earned aggregate · 50% endurance + 50% strength
          </p>
        </div>
        {(enduranceIndex != null || strengthIndex != null) && (
          <div className="flex gap-4 text-sm tabular-nums">
            {enduranceIndex != null && (
              <div>
                <p className="micro-label text-endurance/70">End</p>
                <p className="font-semibold text-endurance">{formatIndex(enduranceIndex)}</p>
              </div>
            )}
            {strengthIndex != null && (
              <div>
                <p className="micro-label text-strength/70">Str</p>
                <p className="font-semibold text-strength">{formatIndex(strengthIndex)}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
