"use client";

import { motion, useReducedMotion } from "framer-motion";
import { Swords, Crown, Target } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatIndex } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";
import type { NextRankTarget } from "@/lib/retention/rank";

interface NextRankCardProps {
  /** A real peer to overtake, a standards-based next-tier target when the pool is too small for peer rank to feel earned, or null when genuinely #1 in a real, sizable pool. */
  target: NextRankTarget | null;
  className?: string;
}

/**
 * The dashboard's "beat others" competitive hook (user feedback: they want
 * "a competitive element to want to improve their score as well as beat
 * others"). A concrete, closeable gap — not just an abstract percentile —
 * gives a specific target to chase. Falls back to a standards-based target
 * (Slice C) rather than a hollow "you're #1 of 3" claim when the real pool
 * of scored athletes is too small for peer rank to mean anything yet.
 */
export function NextRankCard({ target, className }: NextRankCardProps) {
  const reducedMotion = useReducedMotion();

  const icon =
    target?.type === "peer" ? (
      <Swords className="h-3.5 w-3.5 text-muted" />
    ) : target?.type === "standard" ? (
      <Target className="h-3.5 w-3.5 text-muted" />
    ) : (
      <Crown className="h-3.5 w-3.5 text-warning" />
    );

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between">
          <CardTitle>{target?.type === "standard" ? "Reach The Next Tier" : "Beat The Next Rank"}</CardTitle>
          {icon}
        </div>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col justify-center gap-3">
        {target?.type === "peer" ? (
          <>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold tabular-nums">
                {target.pointsToClose}
                <span className="ml-1 text-lg font-normal text-muted">pts</span>
              </p>
              <p className="text-xs font-medium uppercase tracking-wider text-muted">
                to next rank
              </p>
            </div>
            <motion.div
              initial={reducedMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="h-2 origin-left overflow-hidden rounded-full bg-white/5"
            >
              <div className="h-full w-full rounded-full bg-gradient-to-r from-accent/40 to-accent" />
            </motion.div>
            <p className="text-xs text-muted">
              The athlete just above you sits at {formatIndex(target.nextIndex)} — close the gap.
            </p>
          </>
        ) : target?.type === "standard" ? (
          <>
            <div className="flex items-end justify-between">
              <p className="text-3xl font-bold tabular-nums">
                {target.pointsToClose}
                <span className="ml-1 text-lg font-normal text-muted">pts</span>
              </p>
              <p className="text-xs font-medium uppercase tracking-wider text-muted">
                to {target.tierLabel}
              </p>
            </div>
            <motion.div
              initial={reducedMotion ? false : { scaleX: 0 }}
              animate={{ scaleX: 1 }}
              transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
              className="h-2 origin-left overflow-hidden rounded-full bg-white/5"
            >
              <div className="h-full w-full rounded-full bg-gradient-to-r from-accent/40 to-accent" />
            </motion.div>
            <p className="text-xs text-muted">
              Not enough athletes ranked yet for a peer target — this is measured against the
              published strength/endurance standard instead.
            </p>
          </>
        ) : (
          <>
            <p className="text-2xl font-bold tracking-tight text-warning">You&apos;re #1</p>
            <p className="text-xs text-muted">
              Nobody&apos;s ahead of you globally right now — keep training to defend it.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
