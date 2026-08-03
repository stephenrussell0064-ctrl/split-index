"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { motion, useReducedMotion } from "framer-motion";
import { Flame, HeartPulse, Zap, Trophy, Medal, type LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MetricValue } from "@/components/ui/metric-label";
import { ProgressRing } from "@/components/ui/progress-ring";
import { CountUp } from "@/components/dashboard/count-up";
import { cn } from "@/lib/utils/cn";
import { formatIndex, formatTrend, formatPercent } from "@/lib/utils/format";
import { formatRecordValue, sportLabel } from "@/components/analytics/personal-records-table";
import type { RankPercentileResult } from "@/lib/retention/rank";
import type { PersonalRecord } from "@/types";

type Accent = "success" | "warning" | "danger" | "accent" | "muted";

const ACCENT_TEXT: Record<Accent, string> = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  accent: "text-accent",
  muted: "text-muted",
};

const ACCENT_BADGE: Record<Accent, string> = {
  success: "bg-success/15 text-success",
  warning: "bg-warning/15 text-warning",
  danger: "bg-danger/15 text-danger",
  accent: "bg-accent/15 text-accent",
  muted: "bg-white/8 text-muted",
};

function StatTile({
  icon: Icon,
  label,
  value,
  detail,
  accent = "muted",
  href,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  detail?: string;
  accent?: Accent;
  href?: string;
}) {
  const content = (
    <Card padding="sm" interactive className="h-full">
      <div className={cn("mb-2 flex h-9 w-9 items-center justify-center rounded-full", ACCENT_BADGE[accent])}>
        <Icon className="h-4.5 w-4.5" />
      </div>
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={cn("index-display mt-1 text-2xl font-bold tabular-nums", ACCENT_TEXT[accent])}>
        {value}
      </p>
      {detail && <p className="mt-0.5 truncate text-[11px] text-muted">{detail}</p>}
    </Card>
  );

  return href ? (
    <Link href={href} className="block h-full">
      {content}
    </Link>
  ) : (
    content
  );
}

export interface HeroStatWallProps {
  headlineLabel: string;
  headlineValue: number | null;
  weeklyTrend: number;
  hasHistory: boolean;
  recovery: number;
  fatigue: number;
  streak: number;
  streakAtRisk: boolean;
  trainedToday: boolean;
  weeklySessions: number;
  weeklyTarget?: number;
  /** "% of users/standard beaten". Null when not enough data exists yet, or gated for non-premium. */
  rankPercentile: RankPercentileResult | null;
  isPremium: boolean;
  latestPr: PersonalRecord | null;
}

/**
 * The dashboard's first-screen hero (user feedback: the front page "looks
 * empty and not relevant" — everything richer on this page (zone panels,
 * trend charts, recommendations) lives below the fold). One striking
 * headline number plus a dense, at-a-glance stat grid so the very first
 * screen already carries real signal, no scroll required.
 */
export function HeroStatWall({
  headlineLabel,
  headlineValue,
  weeklyTrend,
  hasHistory,
  recovery,
  fatigue,
  streak,
  streakAtRisk,
  trainedToday,
  weeklySessions,
  weeklyTarget = 4,
  rankPercentile,
  isPremium,
  latestPr,
}: HeroStatWallProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <Card glow="accent" padding="lg" className="relative overflow-hidden">
        <div className="flex flex-wrap items-center gap-6">
          <ProgressRing
            progress={weeklyTarget > 0 ? weeklySessions / weeklyTarget : 0}
            size={84}
            strokeWidth={7}
            colorClassName={weeklySessions >= weeklyTarget ? "text-success" : "text-accent"}
            trackClassName="text-white/8"
          >
            <div className="text-center">
              <p className="index-display text-lg font-bold tabular-nums leading-none">
                {weeklySessions}
                <span className="text-xs text-muted">/{weeklyTarget}</span>
              </p>
              <p className="mt-1 text-[8px] font-semibold uppercase tracking-wider text-muted">This week</p>
            </div>
          </ProgressRing>

          <div>
            <p className="micro-label mb-1 text-muted">{headlineLabel}</p>
            {hasHistory && headlineValue !== null ? (
              <div className="flex items-baseline gap-3">
                <MetricValue size="hero">
                  <CountUp value={headlineValue} format={formatIndex} />
                </MetricValue>
                {weeklyTrend !== 0 && (
                  <span
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      weeklyTrend > 0 ? "text-success" : "text-danger"
                    )}
                  >
                    {formatTrend(weeklyTrend)} · 7d
                  </span>
                )}
              </div>
            ) : (
              <p className="text-2xl font-semibold tracking-tight">
                Log your first workout to build your index
              </p>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatTile
            icon={HeartPulse}
            label="Recovery"
            value={formatPercent(recovery)}
            accent={recovery >= 70 ? "success" : recovery >= 40 ? "warning" : "danger"}
          />
          <StatTile
            icon={Zap}
            label="Fatigue"
            value={formatPercent(fatigue)}
            accent={fatigue <= 30 ? "success" : fatigue <= 60 ? "warning" : "danger"}
          />
          <StatTile
            icon={Flame}
            label="Streak"
            value={`${streak}d`}
            detail={streakAtRisk ? "At risk — log today" : trainedToday ? "Secured today" : undefined}
            accent={streakAtRisk ? "warning" : streak > 0 ? "accent" : "muted"}
            href={streakAtRisk ? "/activities/new" : undefined}
          />
          {isPremium && rankPercentile !== null ? (
            <StatTile
              icon={Trophy}
              label={rankPercentile.isPeerBased ? "Global rank" : "Standards rank"}
              value={`Top ${Math.max(1, 100 - rankPercentile.percentile)}%`}
              detail={
                rankPercentile.isPeerBased
                  ? `of ${rankPercentile.poolSize} athletes`
                  : "vs published standard"
              }
              accent="warning"
            />
          ) : (
            <StatTile
              icon={Trophy}
              label="Global rank"
              value={isPremium ? "—" : "Premium"}
              detail={isPremium ? "Not enough data yet" : "Unlock your rank"}
              accent="muted"
              href={isPremium ? undefined : "/settings/billing"}
            />
          )}
          {latestPr ? (
            <StatTile
              icon={Medal}
              label="Latest PR"
              value={formatRecordValue(latestPr)}
              detail={`${sportLabel(latestPr.sport)} · ${formatDistanceToNow(new Date(latestPr.achieved_at), { addSuffix: true })}`}
              accent="accent"
              href="/analytics"
            />
          ) : (
            <StatTile icon={Medal} label="Latest PR" value="—" detail="Set your first record" accent="muted" />
          )}
        </div>
      </Card>
    </motion.div>
  );
}
