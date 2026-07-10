"use client";

import { motion, useReducedMotion } from "motion/react";
import {
  TrendingDown,
  TrendingUp,
  Minus,
  Sparkles,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { CountUp } from "@/components/dashboard/count-up";
import { RecoveryGauge } from "@/components/dashboard/recovery-gauge";

interface SplitIndexHeroProps {
  value: number;
  weeklyTrend: number;
  monthlyTrend: number;
  enduranceIndex: number;
  strengthIndex: number;
  prediction: number;
  recovery: number;
  fatigue: number;
  hasHistory?: boolean;
  className?: string;
}

export function SplitIndexHero({
  value,
  weeklyTrend,
  monthlyTrend,
  enduranceIndex,
  strengthIndex,
  prediction,
  recovery,
  fatigue,
  hasHistory = true,
  className,
}: SplitIndexHeroProps) {
  const reducedMotion = useReducedMotion();
  if (!hasHistory) return null;

  const direction = weeklyTrend > 0 ? "up" : weeklyTrend < 0 ? "down" : "flat";
  const DirectionIcon =
    direction === "up" ? TrendingUp : direction === "down" ? TrendingDown : Minus;
  const directionColor =
    direction === "up"
      ? "text-success"
      : direction === "down"
        ? "text-danger"
        : "text-muted";
  const predictionDelta = prediction - value;

  return (
    <motion.section
      initial={reducedMotion ? false : { opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className={cn("relative", className)}
    >
      <div className="glass-strong glow-accent relative overflow-hidden rounded-3xl">
        {/* ambient sheen */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 90% at 18% 0%, rgba(99,102,241,0.14), transparent), radial-gradient(ellipse 40% 70% at 95% 100%, rgba(16,185,129,0.06), transparent)",
          }}
        />

        <div className="relative grid gap-8 p-6 sm:p-8 lg:grid-cols-[1fr_auto] lg:items-center">
          {/* ── Left: the ticker ── */}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span
                  className={cn(
                    "absolute inline-flex h-full w-full rounded-full bg-success opacity-60",
                    !reducedMotion && "animate-ping"
                  )}
                />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              <p className="text-xs font-medium uppercase tracking-[0.25em] text-muted">
                Split Index · Live
              </p>
            </div>

            <div className="mt-3 flex flex-wrap items-end gap-x-5 gap-y-3">
              <p className="index-display bg-gradient-to-br from-white via-white to-white/50 bg-clip-text text-7xl font-bold text-transparent md:text-8xl">
                <CountUp value={value} format={formatIndex} />
              </p>
              <div
                className={cn("mb-2 flex items-center gap-1.5", directionColor)}
              >
                <DirectionIcon className="h-6 w-6" strokeWidth={2.5} />
                <span className="text-xl font-semibold tabular-nums">
                  {formatTrend(weeklyTrend)}
                </span>
                <span className="mb-0.5 self-end text-[10px] font-medium uppercase tracking-wider text-muted">
                  7d
                </span>
              </div>
            </div>

            {/* stat strip */}
            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <HeroStat label="1W Change" value={weeklyTrend} kind="delta" delay={0.35} />
              <HeroStat label="1M Change" value={monthlyTrend} kind="delta" delay={0.45} />
              <HeroStat
                label="7D Forecast"
                value={prediction}
                kind="index"
                delay={0.55}
                hint={
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 tabular-nums",
                      predictionDelta > 0 && "text-success",
                      predictionDelta < 0 && "text-danger",
                      predictionDelta === 0 && "text-muted"
                    )}
                  >
                    {predictionDelta > 0 ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : predictionDelta < 0 ? (
                      <ArrowDownRight className="h-3 w-3" />
                    ) : (
                      <Minus className="h-3 w-3" />
                    )}
                    {formatTrend(predictionDelta)} projected
                  </span>
                }
                icon={<Sparkles className="h-3 w-3 text-accent" />}
              />
              <HeroStat
                label="Fatigue"
                value={fatigue}
                kind="percent"
                delay={0.65}
                hint={
                  <span className="text-muted">
                    {fatigue >= 60
                      ? "High load — ease off"
                      : fatigue >= 30
                        ? "Moderate load"
                        : "Fresh legs"}
                  </span>
                }
              />
            </div>

            {/* endurance / strength composition bars */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <ComponentBar label="Endurance" value={enduranceIndex} color="endurance" />
              <ComponentBar label="Strength" value={strengthIndex} color="strength" />
            </div>
          </div>

          {/* ── Right: recovery ring ── */}
          <div className="flex justify-center lg:pl-4">
            <RecoveryGauge score={recovery} />
          </div>
        </div>
      </div>
    </motion.section>
  );
}

function HeroStat({
  label,
  value,
  kind,
  delay,
  hint,
  icon,
}: {
  label: string;
  value: number;
  kind: "delta" | "index" | "percent";
  delay: number;
  hint?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const deltaColor =
    kind !== "delta"
      ? "text-foreground"
      : value > 0
        ? "text-success"
        : value < 0
          ? "text-danger"
          : "text-muted";

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="glass rounded-xl px-3.5 py-3"
    >
      <div className="flex items-center gap-1.5">
        {icon}
        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted">
          {label}
        </p>
      </div>
      <p className={cn("mt-1 text-xl font-semibold tabular-nums", deltaColor)}>
        {kind === "delta" && formatTrend(value)}
        {kind === "index" && formatIndex(value)}
        {kind === "percent" && `${Math.round(value)}%`}
      </p>
      {hint && <p className="mt-0.5 text-[10px]">{hint}</p>}
    </motion.div>
  );
}

function ComponentBar({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: "endurance" | "strength";
}) {
  const reducedMotion = useReducedMotion();
  const pct = Math.min(100, (value / 999) * 100);
  const barClass = color === "endurance" ? "bg-endurance" : "bg-strength";
  const textClass = color === "endurance" ? "text-endurance" : "text-strength";

  return (
    <div className="glass rounded-xl px-3.5 py-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted">
          {label}
        </span>
        <span className={cn("text-sm font-semibold tabular-nums", textClass)}>
          {formatIndex(value)}
        </span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/5">
        <motion.div
          initial={reducedMotion ? { width: `${pct}%` } : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1], delay: 0.5 }}
          className={cn("h-full rounded-full", barClass)}
        />
      </div>
    </div>
  );
}
