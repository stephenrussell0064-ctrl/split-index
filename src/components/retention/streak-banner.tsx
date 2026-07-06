"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { Flame, AlertTriangle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { isMilestoneStreak } from "@/lib/retention/streak-utils";

interface StreakBannerProps {
  streak: number;
  atRisk: boolean;
  trainedToday: boolean;
  className?: string;
}

export function StreakBanner({
  streak,
  atRisk,
  trainedToday,
  className,
}: StreakBannerProps) {
  const reducedMotion = useReducedMotion();
  const milestone = isMilestoneStreak(streak);

  if (streak === 0 && !atRisk) return null;

  return (
    <Card
      className={cn(
        "relative overflow-hidden border-white/10",
        atRisk ? "border-warning/30 bg-warning/5" : "bg-white/[0.02]",
        className
      )}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 opacity-40",
          milestone &&
            "bg-[radial-gradient(ellipse_80%_80%_at_0%_50%,rgba(245,158,11,0.25),transparent)]"
        )}
      />
      <CardContent className="relative flex flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-4">
          <motion.div
            animate={
              reducedMotion || !milestone
                ? undefined
                : { scale: [1, 1.12, 1], rotate: [0, -6, 6, 0] }
            }
            transition={
              milestone
                ? { duration: 1.2, repeat: Infinity, repeatDelay: 2.5 }
                : undefined
            }
            className={cn(
              "flex h-12 w-12 items-center justify-center rounded-2xl",
              milestone ? "bg-warning/20" : "bg-accent/15"
            )}
          >
            <Flame
              className={cn(
                "h-6 w-6",
                milestone ? "text-warning" : "text-accent"
              )}
              fill={milestone ? "currentColor" : "none"}
            />
          </motion.div>
          <div>
            <p className="text-sm font-semibold">
              {streak > 0 ? (
                <>
                  <span className="tabular-nums">{streak}</span>-day training streak
                  {milestone && (
                    <span className="ml-2 text-warning">Milestone!</span>
                  )}
                </>
              ) : (
                "Keep your momentum"
              )}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              {atRisk
                ? "Train today to keep your streak alive"
                : trainedToday
                  ? "You showed up today — streak secured"
                  : "Log a session to start building consistency"}
            </p>
          </div>
        </div>

        {atRisk && (
          <Link
            href="/activities/new"
            className="inline-flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-2 text-sm font-medium text-warning transition-colors hover:bg-warning/20"
          >
            <AlertTriangle className="h-4 w-4" />
            Log workout
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
