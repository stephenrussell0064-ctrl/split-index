"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  Zap,
  Moon,
  Gauge,
  Brain,
  ChevronRight,
  HeartPulse,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";

interface RecommendationCardProps {
  /** latest AI next-workout recommendation, if any */
  aiRecommendation: string | null;
  recovery: number;
  fatigue: number;
  /** which side of the index is lagging, used to bias the fallback */
  weakerSide: "endurance" | "strength" | "balanced";
  className?: string;
}

interface Plan {
  icon: typeof Zap;
  tone: string;
  headline: string;
  detail: string;
}

function buildPlan(
  recovery: number,
  fatigue: number,
  weakerSide: RecommendationCardProps["weakerSide"]
): Plan {
  const focus =
    weakerSide === "endurance"
      ? "an endurance session — your strength side is ahead"
      : weakerSide === "strength"
        ? "a strength session — your endurance side is ahead"
        : "either discipline — your index is well balanced";

  if (recovery >= 67 && fatigue < 60) {
    return {
      icon: Zap,
      tone: "text-success",
      headline: "Green light — go hard",
      detail: `Recovery is high and fatigue is under control. Today is the day for ${focus}. Push intensity: intervals, threshold work, or heavy compound lifts.`,
    };
  }
  if (recovery >= 34) {
    return {
      icon: Gauge,
      tone: "text-warning",
      headline: "Steady volume day",
      detail: `You're moderately recovered. Favor ${focus}, but keep it aerobic zone 2 or moderate-load sets. Save max efforts for a greener day.`,
    };
  }
  return {
    icon: Moon,
    tone: "text-danger",
    headline: "Active recovery",
    detail:
      "Recovery is low — hard training now digs the hole deeper. A short walk, easy spin, or mobility work will move your index further than grinding through fatigue.",
  };
}

export function RecommendationCard({
  aiRecommendation,
  recovery,
  fatigue,
  weakerSide,
  className,
}: RecommendationCardProps) {
  const reducedMotion = useReducedMotion();
  const plan = buildPlan(recovery, fatigue, weakerSide);
  const Icon = aiRecommendation ? Brain : plan.icon;

  return (
    <Card
      glow="accent"
      className={cn("relative flex h-full flex-col overflow-hidden", className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 100% 0%, rgba(99,102,241,0.12), transparent)",
        }}
      />
      <CardHeader className="relative mb-3">
        <div className="flex items-center justify-between">
          <CardTitle>Today&apos;s Session</CardTitle>
          <span className="flex items-center gap-1 rounded-full bg-white/5 px-2 py-0.5 text-[9px] font-medium uppercase tracking-wider text-muted">
            <HeartPulse className="h-2.5 w-2.5" />
            {aiRecommendation ? "AI Coach" : "Auto-plan"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative flex min-h-0 flex-1 flex-col">
        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.5 }}
          className="flex-1"
        >
          {aiRecommendation ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Icon className="h-4 w-4 text-accent" />
                <p className="text-sm font-semibold">From your last analysis</p>
              </div>
              <p className="text-sm leading-relaxed text-muted">
                {aiRecommendation}
              </p>
            </>
          ) : (
            <>
              <div className="mb-2 flex items-center gap-2">
                <Icon className={cn("h-4 w-4", plan.tone)} />
                <p className={cn("text-sm font-semibold", plan.tone)}>
                  {plan.headline}
                </p>
              </div>
              <p className="text-sm leading-relaxed text-muted">{plan.detail}</p>
            </>
          )}
        </motion.div>

        <Link
          href="/activities/new"
          className="group mt-4 flex items-center justify-between rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm font-medium transition-colors hover:border-accent/40 hover:bg-accent/10"
        >
          <span>Log today&apos;s workout</span>
          <ChevronRight className="h-4 w-4 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent" />
        </Link>
      </CardContent>
    </Card>
  );
}
