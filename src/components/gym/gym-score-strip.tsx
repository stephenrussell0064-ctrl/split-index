"use client";

import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { formatDOTS, formatGL, formatExRxTier } from "@/lib/utils/scoring-display";
import { PremiumTease } from "@/components/premium/premium-tease";
import { ScoringExplainerNote } from "@/components/scoring/scoring-explainer-note";
import { CollapsibleSection, SummaryPills } from "@/components/ui/collapsible-section";
import { SportComparisonBars } from "@/components/activities/sport-comparison-bars";
import { formatIndex } from "@/lib/utils/format";
import type { ExRxTier } from "@/lib/scoring/strength/ratio-tiers";

export interface GymLiftRow {
  name: string;
  estimated1RM: number;
  /** What recent training says this lift is worth today — absent on sessions scored before the 1RM split existed. */
  currentOneRM?: number;
  /** Best ever hit on this lift; a high-water mark, never lowered by a worse session. */
  allTimeOneRM?: number;
  relativeStrength: number;
  tier?: ExRxTier;
  tierLabel?: string;
}

interface GymScoreStripProps {
  strengthIndex: number | null;
  /** This workout's own SBD total — only the lifts logged in the latest session. */
  dotsScore?: number | null;
  glPoints?: number | null;
  /** Profile-wide: best-ever squat/bench/deadlift across every logged session. */
  overallDotsScore?: number | null;
  overallGlPoints?: number | null;
  overallLiftsLogged?: number;
  lifts?: GymLiftRow[];
  hasHistory: boolean;
  showDotsGl?: boolean;
  className?: string;
}

/**
 * The Lab's scores, in one strip.
 *
 * This replaces `GymStrengthPanel` on the Lab page. That panel opened the
 * tab with a 60px index, two stacked DOTS/IPF GL pairs, a collapsible
 * breakdown and a four-line explanation of what DOTS and GL are — about a
 * third of a phone screen before the first thing the athlete could DO, and
 * the owner's verdict was that the scores "take up too much space when u
 * first click on the tab".
 *
 * What survives: every number. The index is still the headline, the
 * bodyweight-adjusted pair is still beside it, the per-lift breakdown is
 * still one tap away. What changed is the arrangement — one row, the
 * all-time figure as the one you read and this session's as the small line
 * under it — and the prose, which is now a single link to the page that
 * explains it properly.
 */
export function GymScoreStrip({
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
}: GymScoreStripProps) {
  const hasOverall = overallDotsScore != null && overallDotsScore > 0;
  const hasSession = dotsScore != null && dotsScore > 0;
  const headlineDots = hasOverall ? (overallDotsScore as number) : hasSession ? (dotsScore as number) : null;
  const headlineGl = hasOverall ? overallGlPoints : glPoints;
  const partial = hasOverall && overallLiftsLogged != null && overallLiftsLogged < 3;

  return (
    <div className={cn("glass-gym rounded-2xl p-4 sm:p-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="micro-label whitespace-nowrap text-gym-muted">Strength Index</p>
          {hasHistory && strengthIndex !== null ? (
            <p className="index-display mt-1 text-4xl font-bold text-gym-accent sm:text-5xl">
              {formatIndex(strengthIndex)}
            </p>
          ) : (
            <p className="mt-1 text-base font-semibold text-gym-text/90">
              Log a session to unlock your index
            </p>
          )}
        </div>

        {hasHistory && headlineDots != null && showDotsGl && (
          <dl className="grid shrink-0 grid-cols-2 gap-x-4 text-right">
            <div>
              <dt className="text-[10px] uppercase tracking-wider text-gym-muted">
                DOTS{hasOverall ? " · best" : ""}
              </dt>
              <dd className="font-mono text-xl font-semibold tabular-nums text-gym-text sm:text-2xl">
                {formatDOTS(headlineDots)}
              </dd>
              {hasOverall && hasSession && (
                <dd className="text-[10px] tabular-nums text-gym-muted">today {formatDOTS(dotsScore as number)}</dd>
              )}
            </div>
            {headlineGl != null && (
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-gym-muted">
                  IPF GL{hasOverall ? " · best" : ""}
                </dt>
                <dd className="font-mono text-xl font-semibold tabular-nums text-gym-text sm:text-2xl">
                  {formatGL(headlineGl)}
                </dd>
                {hasOverall && hasSession && glPoints != null && (
                  <dd className="text-[10px] tabular-nums text-gym-muted">today {formatGL(glPoints)}</dd>
                )}
              </div>
            )}
          </dl>
        )}

        {hasHistory && hasSession && !showDotsGl && (
          <PremiumTease
            title="DOTS & IPF GL scoring"
            subtitle="Unlock DOTS percentile, IPF GL comparison, and ExRx tier labels with Premium."
            className="max-w-[10rem]"
          >
            <div className="rounded-xl border border-gym-border/40 px-3 py-2 text-right">
              <p className="font-mono text-xl font-semibold tabular-nums text-gym-text">•••</p>
              <p className="text-[10px] uppercase tracking-wider text-gym-muted">DOTS</p>
            </div>
          </PremiumTease>
        )}
      </div>

      {partial && (
        <p className="mt-1.5 text-[11px] text-gym-muted">
          Best-ever DOTS from {overallLiftsLogged}/3 lifts — log the rest of squat, bench and deadlift to complete it.
        </p>
      )}

      {lifts.length > 0 && showDotsGl && (
        <CollapsibleSection
          tone="gym"
          className="mt-3"
          title="Per-lift breakdown"
          count={`${lifts.length} lift${lifts.length === 1 ? "" : "s"}`}
          summary={
            <SummaryPills
              tone="gym"
              items={[...lifts]
                .sort((a, b) => b.relativeStrength - a.relativeStrength)
                .slice(0, 3)
                .map((lift) => ({
                  label: lift.name,
                  value: `${(lift.currentOneRM ?? lift.estimated1RM).toFixed(1)} kg`,
                }))}
              more={Math.max(0, lifts.length - 3)}
            />
          }
        >
          <ScoringExplainerNote href="/how-scoring-works#one-rm" className="mt-0 mb-3 text-gym-muted">
            The headline kg is your current 1RM — what recent training says you could lift today, so
            it falls after a worse block. &quot;Best&quot; is your all-time high-water mark, which
            only ever moves when you beat it.
          </ScoringExplainerNote>
          {/* Bar width uses relativeStrength (× bodyweight), not raw kg — the
              only unit that is comparable across different lifts. */}
          <SportComparisonBars
            zone="gym"
            items={lifts.map((lift) => {
              const tierLabel = lift.tierLabel ?? (lift.tier ? formatExRxTier(lift.tier) : null);
              const current = lift.currentOneRM ?? lift.estimated1RM;
              const allTime = lift.allTimeOneRM ?? lift.estimated1RM;
              return {
                label: lift.name,
                value: lift.relativeStrength,
                displayValue: `${current.toFixed(1)} kg`,
                sublabel: `best ${allTime.toFixed(1)} kg · ${lift.relativeStrength.toFixed(2)}× BW${tierLabel ? ` · ${tierLabel}` : ""}`,
              };
            })}
          />
        </CollapsibleSection>
      )}

      <p className="mt-3 text-[11px] text-gym-muted">
        {showDotsGl ? (
          <>
            DOTS and IPF GL are bodyweight-adjusted, on different scales.{" "}
            <Link href="/how-scoring-works#dots-gl" className="underline hover:text-gym-text">
              How these are scored
            </Link>
          </>
        ) : (
          <>Strength index shown — DOTS / GL tiers need Premium.</>
        )}
      </p>
    </div>
  );
}
