"use client";

import { useReducedMotion } from "framer-motion";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { formatIndex, formatTrend } from "@/lib/utils/format";
import { chartGridStroke, chartTickFill, chartTooltipStyle, type TrendPoint } from "@/components/analytics/charts";
import { designTokens } from "@/lib/design/tokens";
import { cn } from "@/lib/utils/cn";

interface EngineLabTrendCardProps {
  /** Ascending by date — same series the 90-day trend panel further down the page uses. */
  data: TrendPoint[];
  currentEndurance: number;
  currentStrength: number;
  enduranceWeight: number;
  hasHistory: boolean;
  className?: string;
}

/** Change over the last `weeks` data points (one point per active day, so this is approximate, not exact calendar weeks). */
function recentDelta(data: TrendPoint[], key: "endurance" | "strength", points = 6): number | null {
  if (data.length < 2) return null;
  const backIdx = Math.max(0, data.length - 1 - points);
  if (backIdx === data.length - 1) return null;
  return data[data.length - 1][key] - data[backIdx][key];
}

/**
 * Replaces the old tilting-bar seesaw (user feedback: "very little data for
 * something which is so big... does not look great right now"). Same
 * Engine/Lab balance concept, now backed by a real dual-line trend chart
 * plus current values and recent deltas, instead of a thin bar with two
 * numbers at either end.
 */
export function EngineLabTrendCard({
  data,
  currentEndurance,
  currentStrength,
  enduranceWeight,
  hasHistory,
  className,
}: EngineLabTrendCardProps) {
  const reducedMotion = useReducedMotion();
  const endPct = Math.round(enduranceWeight * 100);
  const strPct = 100 - endPct;

  if (!hasHistory || data.length < 2) {
    return (
      <Card padding="lg" className={cn("text-center", className)}>
        <p className="micro-label mb-2 text-muted">Engine vs Lab</p>
        <p className="text-lg font-semibold tracking-tight">
          Log a few cardio and gym sessions to see your balance trend
        </p>
      </Card>
    );
  }

  const enduranceDelta = recentDelta(data, "endurance");
  const strengthDelta = recentDelta(data, "strength");
  const recent = data.slice(-16);

  return (
    <Card padding="lg" className={className}>
      <CardHeader className="mb-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>Engine vs Lab</CardTitle>
          <div className="flex items-center gap-4 text-[10px] uppercase tracking-wider text-muted">
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: designTokens.cardioAccentSoft }} />
              Engine · {endPct}% weight
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: designTokens.strengthAccentSoft }} />
              Lab · {strPct}% weight
            </span>
          </div>
        </div>
      </CardHeader>

      <div className="mb-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-3xl font-bold tabular-nums text-cardio-accent">{formatIndex(currentEndurance)}</p>
          {enduranceDelta !== null && enduranceDelta !== 0 && (
            <p
              className={cn(
                "text-xs font-medium tabular-nums",
                enduranceDelta >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatTrend(enduranceDelta)} recent
            </p>
          )}
        </div>
        <div>
          <p className="text-3xl font-bold tabular-nums text-strength-accent">{formatIndex(currentStrength)}</p>
          {strengthDelta !== null && strengthDelta !== 0 && (
            <p
              className={cn(
                "text-xs font-medium tabular-nums",
                strengthDelta >= 0 ? "text-success" : "text-danger"
              )}
            >
              {formatTrend(strengthDelta)} recent
            </p>
          )}
        </div>
      </div>

      <div
        role="img"
        aria-label={`Engine vs Lab trend chart over ${recent.length} recent sessions`}
      >
        <ResponsiveContainer width="100%" height={170}>
          <AreaChart data={recent} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <defs>
              <linearGradient id="engineGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={designTokens.cardioAccentSoft} stopOpacity={0.3} />
                <stop offset="100%" stopColor={designTokens.cardioAccentSoft} stopOpacity={0} />
              </linearGradient>
              <linearGradient id="labGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={designTokens.strengthAccentSoft} stopOpacity={0.3} />
                <stop offset="100%" stopColor={designTokens.strengthAccentSoft} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: chartTickFill }} />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 10, fill: chartTickFill }}
              width={32}
              tickFormatter={(v) => formatIndex(Number(v))}
            />
            <Tooltip
              contentStyle={chartTooltipStyle}
              formatter={(value, name) => [formatIndex(Number(value)), name === "endurance" ? "Engine" : "Lab"]}
            />
            <Area
              type="monotone"
              dataKey="endurance"
              stroke={designTokens.cardioAccentSoft}
              strokeWidth={2}
              fill="url(#engineGrad)"
              animationDuration={reducedMotion ? 0 : 900}
            />
            <Area
              type="monotone"
              dataKey="strength"
              stroke={designTokens.strengthAccentSoft}
              strokeWidth={2}
              fill="url(#labGrad)"
              animationDuration={reducedMotion ? 0 : 900}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}
