"use client";

import { cn } from "@/lib/utils/cn";
import { formatDOTS, formatGL, formatExRxTier } from "@/lib/utils/scoring-display";
import { PremiumTease } from "@/components/premium/premium-tease";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { SportComparisonBars } from "@/components/activities/sport-comparison-bars";
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
  /** This workout's own SBD total — only the lifts logged in the latest session. */
  dotsScore?: number | null;
  glPoints?: number | null;
  /** Profile-wide: best-ever squat/bench/deadlift across every logged session. */
  overallDotsScore?: number | null;
  overallGlPoints?: number | null;
  overallLiftsLogged?: number;
  lifts?: LiftRow[];
  hasHistory: boolean;
  showDotsGl?: boolean;
  className?: string;
}

function DotsGlPair({
  dotsScore,
  glPoints,
}: {
  dotsScore: number;
  glPoints?: number | null;
}) {
  return (
    <div className="flex items-baseline justify-end gap-4">
      <div>
        <p className="font-mono text-2xl font-semibold tabular-nums text-gym-text">
          {formatDOTS(dotsScore)}
        </p>
        <p className="text-[10px] text-gym-muted uppercase tracking-wider mt-0.5">DOTS</p>
      </div>
      {glPoints != null && (
        <div>
          <p className="font-mono text-2xl font-semibold tabular-nums text-gym-text">
            {formatGL(glPoints)}
          </p>
          <p className="text-[10px] text-gym-muted uppercase tracking-wider mt-0.5">IPF GL</p>
        </div>
      )}
    </div>
  );
}

export function GymStrengthPanel({
  strengthIndex,
  dotsScore,
  glPoints,
  overallDotsScore,
  overallGlPoints,
  overallLiftsLogged,
  lifts = [],
  hasHistory,
  showDotsGl = true,
  className,
}: GymStrengthPanelProps) {
  const hasOverall = overallDotsScore != null && overallDotsScore > 0;
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
          <div className="text-right space-y-3">
            <div>
              <p className="text-[10px] text-gym-muted uppercase tracking-wider mb-1">
                This workout
              </p>
              <DotsGlPair dotsScore={dotsScore} glPoints={glPoints} />
            </div>
            {hasOverall && (
              <div className="border-t border-gym-border/30 pt-3">
                <p className="text-[10px] text-gym-accent uppercase tracking-wider mb-1">
                  Your best · all-time
                  {overallLiftsLogged != null && overallLiftsLogged < 3 && (
                    <span className="text-gym-muted normal-case tracking-normal">
                      {" "}
                      ({overallLiftsLogged}/3 lifts logged)
                    </span>
                  )}
                </p>
                <DotsGlPair
                  dotsScore={overallDotsScore as number}
                  glPoints={overallGlPoints}
                />
              </div>
            )}
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
          {/* Bar width uses relativeStrength (× bodyweight), not raw kg —
              the only unit that's actually comparable across different
              lifts (user feedback, Slice 10: "the comparison between the
              different scoring of their sports"). A 60kg bench and a
              140kg deadlift can both be a strong lift for the same
              athlete; a raw-kg bar would make deadlift dominate every
              chart regardless of relative strength. */}
          <SportComparisonBars
            zone="gym"
            items={lifts.map((lift) => {
              const tierLabel = lift.tierLabel ?? (lift.tier ? formatExRxTier(lift.tier) : null);
              return {
                label: lift.name,
                value: lift.relativeStrength,
                displayValue: `${lift.estimated1RM.toFixed(1)} kg`,
                sublabel: `${lift.relativeStrength.toFixed(2)}× BW${tierLabel ? ` · ${tierLabel}` : ""}`,
              };
            })}
          />
        </div>
      )}

      {showDotsGl ? (
        <ScoringExplainerNote href="/how-scoring-works#dots-gl" className="text-gym-muted">
          DOTS and IPF GL are bodyweight-adjusted formulas — they let you compare your total fairly
          against lifters of any size. Different scales, so track each on its own over time rather
          than comparing DOTS to GL directly. &quot;This workout&quot; uses only the squat/bench/deadlift
          logged in that session; &quot;Your best · all-time&quot; combines your single best-ever lift of
          each, even if they came from different sessions.
        </ScoringExplainerNote>
      ) : (
        <p className="mt-4 text-xs text-gym-muted leading-relaxed">
          Strength index shown — DOTS / GL tiers require Premium
        </p>
      )}
    </div>
  );
}
