"use client";

import { motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Footprints,
  PersonStanding,
  Droplets,
  Ship,
  Bike,
  Snowflake,
  Dumbbell,
  Zap,
  PlusCircle,
  TrendingUp,
  HeartPulse,
  CalendarClock,
  Target,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils/cn";
import { PremiumTease } from "@/components/premium/premium-tease";
import { formatIndex, formatDuration, formatDistance } from "@/lib/utils/format";
import type { Activity, AIFeedback } from "@/types";

const sportMeta: Record<string, { icon: typeof Zap; color: string; bg: string }> = {
  running: { icon: Footprints, color: "text-endurance", bg: "bg-endurance/10" },
  walking: { icon: PersonStanding, color: "text-endurance", bg: "bg-endurance/10" },
  swimming: { icon: Droplets, color: "text-endurance", bg: "bg-endurance/10" },
  rowing: { icon: Ship, color: "text-endurance", bg: "bg-endurance/10" },
  bike_erg: { icon: Bike, color: "text-endurance", bg: "bg-endurance/10" },
  indoor_cycling: { icon: Bike, color: "text-endurance", bg: "bg-endurance/10" },
  ski_erg: { icon: Snowflake, color: "text-endurance", bg: "bg-endurance/10" },
  gym: { icon: Dumbbell, color: "text-strength", bg: "bg-strength/10" },
};

interface WorkoutListProps {
  activities: Activity[];
  scores?: Record<string, number>;
  className?: string;
}

export function RecentWorkouts({
  activities,
  scores = {},
  className,
}: WorkoutListProps) {
  const reducedMotion = useReducedMotion();

  if (activities.length === 0) {
    return (
      <Card className={cn("flex h-full flex-col", className)}>
        <CardHeader className="mb-3">
          <CardTitle>Latest Sessions</CardTitle>
        </CardHeader>
        <CardContent className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 py-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/10">
            <PlusCircle className="h-5 w-5 text-accent" />
          </div>
          <div>
            <p className="text-sm font-medium">The tape is empty</p>
            <p className="mt-1 text-xs text-muted">
              Your sessions will scroll here like a market feed.
            </p>
          </div>
          <Link
            href="/activities/new"
            className="text-xs font-medium text-accent transition-colors hover:text-accent/80"
          >
            Log your first workout →
          </Link>
        </CardContent>
      </Card>
    );
  }

  const rows = activities.slice(0, 6);

  return (
    <Card className={cn("flex h-full flex-col", className)}>
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Latest Sessions</CardTitle>
          <Link
            href="/activities"
            className="flex items-center gap-1 text-xs text-muted transition-colors hover:text-foreground"
          >
            View all <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        <div className="divide-y divide-white/[0.04]">
          {rows.map((activity, i) => {
            const meta = sportMeta[activity.sport] ?? {
              icon: Zap,
              color: "text-accent",
              bg: "bg-accent/10",
            };
            const Icon = meta.icon;
            const score = scores[activity.id];
            const prevScore =
              i + 1 < rows.length ? scores[rows[i + 1].id] : undefined;
            const delta =
              score !== undefined && prevScore !== undefined
                ? score - prevScore
                : null;

            return (
              <motion.div
                key={activity.id}
                initial={reducedMotion ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.2 + i * 0.06, duration: 0.4 }}
              >
                <Link
                  href={`/activities/${activity.id}`}
                  className="group flex items-center gap-3 px-1 py-2.5 transition-colors hover:bg-white/[0.03]"
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                      meta.bg
                    )}
                  >
                    <Icon className={cn("h-4 w-4", meta.color)} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium capitalize">
                      {activity.title ?? activity.sport.replace("_", " ")}
                    </p>
                    <p className="text-[11px] tabular-nums text-muted">
                      {new Date(activity.started_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                      {" · "}
                      {formatDuration(activity.duration_seconds)}
                      {activity.distance_meters
                        ? ` · ${formatDistance(activity.distance_meters)}`
                        : ""}
                    </p>
                  </div>

                  {score !== undefined && (
                    <div className="flex items-center gap-2 text-right">
                      <span className="font-mono text-sm font-semibold tabular-nums">
                        {formatIndex(score)}
                      </span>
                      {delta !== null && (
                        <span
                          className={cn(
                            "flex w-12 items-center justify-end gap-0.5 text-[11px] font-medium tabular-nums",
                            delta > 0 && "text-success",
                            delta < 0 && "text-danger",
                            delta === 0 && "text-muted"
                          )}
                        >
                          {delta > 0 ? (
                            <ArrowUpRight className="h-3 w-3" />
                          ) : delta < 0 ? (
                            <ArrowDownRight className="h-3 w-3" />
                          ) : (
                            <Minus className="h-3 w-3" />
                          )}
                          {Math.abs(Math.round(delta))}
                        </span>
                      )}
                    </div>
                  )}
                </Link>
              </motion.div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface AICoachCardProps {
  feedback: AIFeedback | null;
  isPremium?: boolean;
  className?: string;
}

const coachSections = [
  {
    key: "performance",
    title: "Performance",
    icon: TrendingUp,
    accent: "text-accent",
    bg: "bg-accent/10",
    getContent: (f: AIFeedback) =>
      [f.performance_explanation, f.score_change_reason].filter(Boolean).join(" "),
  },
  {
    key: "recovery",
    title: "Recovery",
    icon: HeartPulse,
    accent: "text-success",
    bg: "bg-success/10",
    getContent: (f: AIFeedback) => f.recovery_advice,
  },
  {
    key: "next",
    title: "Next Session",
    icon: CalendarClock,
    accent: "text-endurance",
    bg: "bg-endurance/10",
    getContent: (f: AIFeedback) => f.next_workout_recommendation,
  },
  {
    key: "longterm",
    title: "Long Term Advice",
    icon: Target,
    accent: "text-strength",
    bg: "bg-strength/10",
    getContent: (f: AIFeedback) => f.long_term_insight,
  },
] as const;

export function AICoachCard({
  feedback,
  isPremium = false,
  className,
}: AICoachCardProps) {
  const reducedMotion = useReducedMotion();

  if (!feedback) {
    return (
      <Card className={cn("relative flex h-full flex-col overflow-hidden", className)}>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 70% 60% at 0% 100%, rgba(168,85,247,0.1), transparent)",
          }}
        />
        <CardHeader className="relative mb-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent" />
            <CardTitle>AI Coach</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="relative flex min-h-0 flex-1 flex-col justify-between gap-4">
          <p className="text-sm leading-relaxed text-muted">
            Complete a workout to receive data-driven performance analysis,
            recovery guidance, and session recommendations after every activity.
          </p>
          {!isPremium && (
            <Link
              href="/settings/billing"
              className="text-sm font-medium text-accent transition-colors hover:text-accent/80"
            >
              Unlock with Premium for GPT-powered analysis →
            </Link>
          )}
        </CardContent>
      </Card>
    );
  }

  const coachCard = (
    <Card glow="accent" className={cn("relative flex h-full flex-col overflow-hidden", className)}>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 100% 0%, rgba(168,85,247,0.08), transparent)",
        }}
      />
      <CardHeader className="relative mb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-accent" />
            <CardTitle>AI Coach</CardTitle>
          </div>
          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted">
            {isPremium ? "Post-workout" : "Rules snippet"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="relative min-h-0 flex-1 space-y-2.5">
        {isPremium ? (
          coachSections.map((section, i) => {
            const Icon = section.icon;
            const content = section.getContent(feedback);

            return (
              <motion.div
                key={section.key}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + i * 0.08, duration: 0.35 }}
                className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3 backdrop-blur-sm"
              >
                <div className="mb-1.5 flex items-center gap-2">
                  <span
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                      section.bg
                    )}
                  >
                    <Icon className={cn("h-3.5 w-3.5", section.accent)} />
                  </span>
                  <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted">
                    {section.title}
                  </p>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">{content}</p>
              </motion.div>
            );
          })
        ) : (
          <>
            <PremiumTease
              title="Full AI Coach analysis"
              subtitle="Performance, recovery, and long-term insights — GPT-powered after every workout."
            >
              <div className="space-y-2">
                {coachSections.map((section) => {
                  const Icon = section.icon;
                  const content =
                    section.getContent(feedback) ||
                    "Detailed coaching insight available with Premium.";
                  return (
                    <div
                      key={section.key}
                      className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-3"
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-6 w-6 shrink-0 items-center justify-center rounded-lg",
                            section.bg
                          )}
                        >
                          <Icon className={cn("h-3.5 w-3.5", section.accent)} />
                        </span>
                        <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted">
                          {section.title}
                        </p>
                      </div>
                      <p className="text-sm leading-relaxed text-foreground/90">
                        {content}
                      </p>
                    </div>
                  );
                })}
              </div>
            </PremiumTease>
            {feedback.next_workout_recommendation && (
              <div className="rounded-xl border border-accent/20 bg-accent/5 p-3">
                <p className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted mb-1.5">
                  Free snippet
                </p>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {feedback.next_workout_recommendation}
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );

  return coachCard;
}
