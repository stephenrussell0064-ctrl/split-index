"use client";

import { cn } from "@/lib/utils/cn";
import {
  formatDOTS,
  formatGL,
  formatExRxTier,
  formatLiftBreakdownLine,
} from "@/lib/utils/scoring-display";
import { PremiumTease } from "@/components/premium/premium-tease";
import { formatIndex } from "@/lib/utils/format";
import type { ExRxTier } from "@/lib/scoring/strength/ratio-tiers";

interface LiftRow {
  name: string;
  estimated1RM: number;
  relativeStrength: number;
  tier?: ExRxTier;
  tierLabel?: string;
}

interface GymStrengthPanelProps {
  strengthIndex: number | null;
  dotsScore?: number | null;
  glPoints?: number | null;
  lifts?: LiftRow[];
  hasHistory: boolean;
  showDotsGl?: boolean;
  className?: string;
}

export function GymStrengthPanel({
  strengthIndex,
  dotsScore,
  glPoints,
  lifts = [],
  hasHistory,
  showDotsGl = true,
  className,
}: GymStrengthPanelProps) {
  return (
    <div className={cn("glass-gym rounded-2xl p-6 sm:p-8", className)}>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
        <div>
          <p className="micro-label text-gym-muted mb-1">Strength Index</p>
          {hasHistory && strengthIndex !== null ? (
            <p className="index-display text-5xl font-bold text-gym-accent sm:text-6xl">
              {formatIndex(strengthIndex)}
            </p>
          ) : (
            <p className="text-lg font-semibold text-gym-text/90">
              Log workouts to unlock DOTS scoring
            </p>
          )}
        </div>

        {hasHistory && dotsScore != null && showDotsGl && (
          <div
            className="text-right"
            title="DOTS and IPF GL use different scales — don't compare them to each other, only track each over time."
          >
            <div className="flex items-baseline justify-end gap-4">
              <div>
                <p className="font-mono text-2xl font-semibold tabular-nums text-gym-text">
                  {formatDOTS(dotsScore)}
                </p>
                <p className="text-[10px] text-gym-muted uppercase tracking-wider mt-0.5">
                  DOTS
                </p>
              </div>
              {glPoints != null && (
                <div>
                  <p className="font-mono text-2xl font-semibold tabular-nums text-gym-text">
                    {formatGL(glPoints)}
                  </p>
                  <p className="text-[10px] text-gym-muted uppercase tracking-wider mt-0.5">
                    IPF GL
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {hasHistory && dotsScore != null && !showDotsGl && (
          <PremiumTease
            title="DOTS & IPF GL scoring"
            subtitle="Unlock DOTS percentile, IPF GL comparison, and ExRx tier labels with Premium."
            className="max-w-xs"
          >
            <div className="glass-gym rounded-xl p-4 text-right">
              <p className="font-mono text-2xl font-semibold tabular-nums text-gym-text">
                •••
              </p>
              <p className="text-[10px] text-gym-muted uppercase tracking-wider mt-0.5">
                DOTS
              </p>
            </div>
          </PremiumTease>
        )}
      </div>

      {lifts.length > 0 && showDotsGl && (
        <div className="border-t border-gym-border/30 pt-4 mt-4">
          <p className="micro-label text-gym-muted mb-3">Per-lift breakdown</p>
          <ul className="space-y-2">
            {lifts.map((lift) => (
              <li
                key={lift.name}
                className="flex flex-wrap items-center justify-between gap-2 text-sm"
              >
                <span className="text-gym-text/90">
                  {formatLiftBreakdownLine(
                    lift.name,
                    lift.estimated1RM,
                    lift.relativeStrength,
                    lift.tierLabel ??
                      (lift.tier ? formatExRxTier(lift.tier) : undefined)
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="mt-4 text-xs text-gym-muted leading-relaxed">
        {showDotsGl
          ? "SBD total scored via DOTS and IPF GL (different scales — track each over time) · accessories via ExRx ratio tiers"
          : "Strength index shown — DOTS / GL tiers require Premium"}
      </p>
    </div>
  );
}
