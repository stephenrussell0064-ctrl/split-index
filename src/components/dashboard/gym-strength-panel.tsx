"use client";

import { useState } from "react";
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
  const [useGL, setUseGL] = useState(false);

  const headlineScore =
    useGL && glPoints ? formatGL(glPoints) : dotsScore ? formatDOTS(dotsScore) : null;
  const headlineLabel = useGL ? "IPF GL Points" : "DOTS";

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
          <div className="text-right">
            <div className="inline-flex rounded-lg border border-gym-border/40 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setUseGL(false)}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  !useGL
                    ? "bg-gym-accent/20 text-gym-accent font-medium"
                    : "text-gym-muted hover:text-gym-text"
                )}
              >
                DOTS
              </button>
              <button
                type="button"
                onClick={() => setUseGL(true)}
                className={cn(
                  "rounded-md px-3 py-1.5 transition-colors",
                  useGL
                    ? "bg-gym-accent/20 text-gym-accent font-medium"
                    : "text-gym-muted hover:text-gym-text"
                )}
              >
                IPF GL
              </button>
            </div>
            {headlineScore && (
              <p className="mt-2 font-mono text-2xl font-semibold tabular-nums text-gym-text">
                {headlineScore}
              </p>
            )}
            <p className="text-[10px] text-gym-muted uppercase tracking-wider mt-0.5">
              {headlineLabel}
            </p>
          </div>
        )}

        {hasHistory && dotsScore != null && !showDotsGl && (
          <PremiumTease
            title={`DOTS ${formatDOTS(dotsScore)} · ${glPoints ? `GL ${formatGL(glPoints)}` : "IPF GL"}`}
            subtitle="Unlock DOTS percentile, IPF GL comparison, and ExRx tier labels with Premium."
            className="max-w-xs"
          >
            <div className="glass-gym rounded-xl p-4 text-right">
              <p className="font-mono text-2xl font-semibold tabular-nums text-gym-text">
                {formatDOTS(dotsScore)}
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
          ? `SBD total scored via ${useGL ? "IPF GL Points" : "DOTS"} · accessories via ExRx ratio tiers`
          : "Strength index shown — DOTS / GL tiers require Premium"}
      </p>
    </div>
  );
}
