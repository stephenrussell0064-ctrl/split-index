"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { animate, motion } from "framer-motion";
import { Check, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatIndex } from "@/lib/utils/format";
import { MilestoneToast } from "@/components/retention/milestone-toast";
import { SportComparisonPanel } from "@/components/dashboard/sport-comparison";
import type { SportComparisonStats } from "@/lib/utils/sport-comparison";
import type { ScoreBreakdown, SportType } from "@/types";
import type { ExerciseScoreDisplay } from "@/lib/utils/scoring-display";
import { formatSplitBreakdown } from "@/lib/utils/scoring-display";
import { cn } from "@/lib/utils/cn";
import { CardioEnrichmentPanel } from "@/components/activities/cardio-enrichment-panel";
import type { CardioEnrichment } from "@/lib/scoring/cardio";

export interface ScoreResultSummary {
  sport: SportType;
  sportLabel: string;
  sportIndex: number;
  splitIndex: number;
  previousSplitIndex: number;
  splitIndexDelta: number;
  enduranceIndex: number;
  strengthIndex: number;
  sportComparison: SportComparisonStats;
  isFirstSportSession: boolean;
  benchmarkContext?: string | null;
  strengthContext?: string | null;
  splitBreakdownLabel?: string | null;
  dotsScore?: number | null;
  glPoints?: number | null;
  useGL?: boolean;
  exerciseBreakdown?: ExerciseScoreDisplay[];
  scoreBreakdown?: ScoreBreakdown;
  cardioEnrichment?: CardioEnrichment;
}

const REDIRECT_AFTER_MS = 6200;

function useCountUp(target: number, delay: number): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    const controls = animate(0, target, {
      duration: 1.1,
      delay,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [target, delay]);
  return value;
}

export function SuccessScreen({
  result,
  onLogAnother,
  isPremium = false,
  skipRedirect = false,
  redirectPath = "/dashboard",
}: {
  result: ScoreResultSummary;
  onLogAnother: () => void;
  isPremium?: boolean;
  skipRedirect?: boolean;
  redirectPath?: string;
}) {
  const router = useRouter();
  const sportIndex = useCountUp(result.sportIndex, 0.55);
  const isGym = result.sport === "gym";
  const zone = isGym ? "gym" : "cardio";

  useEffect(() => {
    if (skipRedirect) return;
    const timer = setTimeout(() => router.push(redirectPath), REDIRECT_AFTER_MS);
    return () => clearTimeout(timer);
  }, [router, skipRedirect, redirectPath]);

  return (
    <>
      <MilestoneToast
        previousIndex={result.previousSplitIndex}
        currentIndex={result.splitIndex}
      />
      <div className="py-8 text-center sm:py-12">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35 }}
          className={cn(
            "mx-auto mb-8 flex h-14 w-14 items-center justify-center rounded-full border",
            isGym
              ? "bg-gym-accent/10 border-gym-accent/25"
              : "bg-cardio-accent/10 border-cardio-accent/25"
          )}
        >
          <Check
            className={cn("h-7 w-7", isGym ? "text-gym-accent" : "text-cardio-accent")}
            strokeWidth={2.5}
          />
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15, duration: 0.4 }}
          className={cn(
            "mx-auto max-w-md rounded-2xl border p-8 sm:p-10 text-left",
            isGym
              ? "border-gym-border/40 bg-gym-bg-elevated/80"
              : "border-cardio-border/40 bg-cardio-bg-elevated/90"
          )}
        >
          <p className="micro-label mb-4 text-muted text-center">Session scored</p>
          <p
            className={cn(
              "index-display text-center text-6xl font-bold sm:text-7xl",
              isGym ? "text-gym-accent" : "text-cardio-accent"
            )}
          >
            {sportIndex}
          </p>
          <p className="mt-2 text-center text-sm font-medium">{result.sportLabel}</p>
          {isGym && result.strengthContext && (
            <p className="mt-2 text-center text-sm text-muted">{result.strengthContext}</p>
          )}

          {!isGym && result.cardioEnrichment && (
            <div className="mt-6">
              <CardioEnrichmentPanel enrichment={result.cardioEnrichment} />
            </div>
          )}

          <div className="mt-8 border-t border-white/10 pt-6">
            <SportComparisonPanel
              label={result.sportLabel}
              currentScore={result.sportIndex}
              comparison={result.sportComparison}
              zone={zone}
              benchmarkContext={result.benchmarkContext}
              exerciseBreakdown={result.exerciseBreakdown}
              strengthContext={isGym ? undefined : result.strengthContext}
            />
          </div>

          <div className="mt-8 border-t border-white/10 pt-6">
            <p className="micro-label mb-2 text-muted">Composite Split Index</p>
            <p className="index-display text-2xl font-bold tabular-nums text-foreground/90">
              {formatIndex(result.splitIndex)}
            </p>
            <p className="mt-1 text-xs text-muted">
              {result.splitBreakdownLabel ??
                formatSplitBreakdown(
                  result.enduranceIndex,
                  result.strengthIndex
                )}
            </p>
          </div>
        </motion.div>

        {!isPremium && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="mx-auto mt-6 max-w-md rounded-xl border border-warning/20 bg-warning/5 px-5 py-4"
          >
            <div className="flex items-start gap-3 text-left">
              <Crown className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-medium">Unlock AI Coach analysis</p>
                <p className="mt-1 text-xs text-muted">
                  Premium explains every score factor — tied to your actual breakdown,
                  not generic motivation.
                </p>
                <Link
                  href="/settings/billing"
                  className="mt-2 inline-block text-xs font-medium text-accent hover:text-accent/80"
                >
                  Start 14-day free trial →
                </Link>
              </div>
            </div>
          </motion.div>
        )}

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.6 }}
          className="mt-8 space-y-4 text-center"
        >
          {!skipRedirect && (
            <p className="text-xs text-muted">
              Taking you to {redirectPath === "/gym" ? "The Lab" : redirectPath === "/cardio" ? "The Engine" : "your dashboard"}…
            </p>
          )}
          <div className="flex justify-center gap-3">
            <Button variant="secondary" onClick={() => router.push(redirectPath)}>
              {redirectPath === "/gym"
                ? "Open The Lab"
                : redirectPath === "/cardio"
                  ? "Open The Engine"
                  : "View dashboard"}
            </Button>
            {!skipRedirect && (
              <Button variant="ghost" onClick={onLogAnother}>
                Log another
              </Button>
            )}
          </div>
        </motion.div>
      </div>
    </>
  );
}
