"use client";

import { useCallback, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { formatSplitBreakdown } from "@/lib/utils/scoring-display";
import { CountUp } from "@/components/dashboard/count-up";
import { SplitWeightSlider } from "@/components/dashboard/split-weight-slider";

import { PremiumTease } from "@/components/premium/premium-tease";

interface SplitBalanceGaugeProps {
  splitIndex: number | null;
  enduranceIndex: number | null;
  strengthIndex: number | null;
  headlineLabel?: string;
  weeklyTrend?: number;
  enduranceWeight?: number;
  hasHistory: boolean;
  showBreakdown?: boolean;
  editableWeight?: boolean;
  onWeightChange?: (enduranceWeight: number) => void;
  className?: string;
}

export function SplitBalanceGauge({
  splitIndex,
  enduranceIndex,
  strengthIndex,
  headlineLabel = "Split Index",
  weeklyTrend = 0,
  enduranceWeight = 0.5,
  hasHistory,
  showBreakdown = true,
  editableWeight = false,
  onWeightChange,
  className,
}: SplitBalanceGaugeProps) {
  const reducedMotion = useReducedMotion();
  const [localWeight, setLocalWeight] = useState(enduranceWeight);

  const endW = editableWeight ? localWeight : enduranceWeight;
  const endIdx = enduranceIndex ?? 0;
  const strIdx = strengthIndex ?? 0;
  const endPct = Math.round(endW * 100);
  const strPct = 100 - endPct;

  // Tilt: positive = strength-heavy, negative = cardio-heavy
  const tilt =
    endIdx + strIdx > 0 ? ((strIdx - endIdx) / (endIdx + strIdx)) * 18 : 0;

  const handleWeight = useCallback(
    (w: number) => {
      setLocalWeight(w);
      onWeightChange?.(w);
    },
    [onWeightChange]
  );

  if (!hasHistory || splitIndex === null) {
    return (
      <motion.div
        initial={reducedMotion ? false : { opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className={cn(
          "glass rounded-2xl border border-white/[0.06] p-6 text-center",
          className
        )}
      >
        <p className="micro-label text-muted mb-2">{headlineLabel}</p>
        <p className="text-lg font-semibold tracking-tight">
          Log workouts to build your index
        </p>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted">
          Cardio and strength blend into one hybrid score — adjust the balance below
          once you have history.
        </p>
        {editableWeight && (
          <div className="mt-6 max-w-sm mx-auto">
            <SplitWeightSlider
              enduranceWeight={localWeight}
              onChange={handleWeight}
            />
          </div>
        )}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className={cn(
        "glass-strong relative overflow-hidden rounded-2xl border border-white/[0.06] p-6 sm:p-8",
        className
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <p className="micro-label text-muted mb-1">{headlineLabel}</p>
          <div className="flex items-baseline gap-3">
            <p className="index-display text-4xl font-bold tabular-nums sm:text-5xl">
              <CountUp value={splitIndex} format={formatIndex} />
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
            {formatSplitBreakdown(endIdx, strIdx, endPct)}
          </p>
        </div>
      </div>

      {/* Seesaw gauge — Lab / Engine breakdown */}
      {showBreakdown ? (
        <div className="relative mx-auto max-w-lg h-32 mb-4">
          <div className="absolute left-1/2 bottom-2 -translate-x-1/2 z-10">
            <div className="flex flex-col items-center">
              <span className="index-display text-lg font-bold tabular-nums text-foreground/90">
                {formatIndex(splitIndex)}
              </span>
              <div className="w-0 h-0 border-l-[10px] border-r-[10px] border-b-[14px] border-l-transparent border-r-transparent border-b-white/20" />
            </div>
          </div>

          <motion.div
            className="absolute left-4 right-4 top-1/2 h-1 rounded-full bg-white/10 origin-center"
            initial={false}
            animate={{ rotate: reducedMotion ? tilt : tilt }}
            transition={{ type: "spring", stiffness: 120, damping: 14 }}
            style={{ transformOrigin: "center center" }}
          >
            <div className="absolute -left-1 top-1/2 -translate-y-1/2 -translate-x-full flex flex-col items-end pr-3">
              <span className="micro-label text-cardio-accent/80">Engine</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-cardio-accent">
                {formatIndex(endIdx)}
              </span>
            </div>

            <div className="absolute -right-1 top-1/2 -translate-y-1/2 translate-x-full flex flex-col items-start pl-3">
              <span className="micro-label text-strength-accent/80">Lab</span>
              <span className="font-mono text-sm font-semibold tabular-nums text-strength-accent">
                {formatIndex(strIdx)}
              </span>
            </div>
          </motion.div>

          <div className="absolute bottom-0 left-0 right-0 flex justify-between px-2 text-[10px] text-muted">
            <span>{endPct}% weight</span>
            <span>{strPct}% weight</span>
          </div>
        </div>
      ) : (
        <PremiumTease
          title="Lab / Engine breakdown"
          subtitle="Premium unlocks the full Lab / Engine breakdown and blend weights."
          className="mb-4"
        >
          <div className="relative mx-auto max-w-lg h-32">
            <div className="absolute left-4 right-4 top-1/2 h-1 rounded-full bg-white/10" />
            <div className="absolute left-0 top-1/2 -translate-y-1/2 text-cardio-accent text-sm font-mono">
              •••
            </div>
            <div className="absolute right-0 top-1/2 -translate-y-1/2 text-strength-accent text-sm font-mono">
              •••
            </div>
          </div>
        </PremiumTease>
      )}

      {editableWeight && (
        <SplitWeightSlider enduranceWeight={localWeight} onChange={handleWeight} />
      )}
    </motion.div>
  );
}
