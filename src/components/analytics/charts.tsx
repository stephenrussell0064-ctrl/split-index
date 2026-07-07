"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  CartesianGrid,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { formatIndex } from "@/lib/utils/format";
import { designTokens } from "@/lib/design/tokens";

const CHART_COLORS = {
  split: designTokens.slate[400],
  endurance: designTokens.cardioAccentSoft,
  strength: designTokens.strengthAccentSoft,
  accent: designTokens.strengthAccent,
} as const;

export const chartTooltipStyle: React.CSSProperties = {
  background: `${designTokens.slate[950]}ee`,
  border: `1px solid ${designTokens.slate[700]}55`,
  borderRadius: "14px",
  fontSize: "12px",
  padding: "10px 14px",
  fontFamily: designTokens.fontData,
  boxShadow: "0 12px 40px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,255,255,0.05)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
};

export const chartGridStroke = `${designTokens.slate[600]}33`;
export const chartTickFill = designTokens.slate[400];

/* ── Single-series index trend (used by /analytics) ─────────────────────── */

interface IndexChartProps {
  data: { date: string; value: number }[];
  title?: string;
  color?: string;
}

export function IndexTrendChart({
  data,
  title = "Index Trend",
  color = CHART_COLORS.accent,
}: IndexChartProps) {
  const reducedMotion = useReducedMotion();

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-48 items-center justify-center text-sm text-muted">
            Log workouts to see your index trend
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 400, damping: 30, delay: 0.1 }}
    >
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={data}>
              <defs>
                <linearGradient id="indexGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: chartTickFill }}
              />
              <YAxis
                domain={["auto", "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: chartTickFill }}
                width={40}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value) => [formatIndex(Number(value)), "Index"]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill="url(#indexGradient)"
                animationDuration={reducedMotion ? 0 : 1000}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </motion.div>
  );
}

/* ── Multi-series trend panel (dashboard) ───────────────────────────────── */

export interface TrendPoint {
  date: string;
  split: number;
  endurance: number;
  strength: number;
}

const trendSeries = [
  { key: "split", label: "Split", color: CHART_COLORS.split },
  { key: "endurance", label: "Endurance", color: CHART_COLORS.endurance },
  { key: "strength", label: "Strength", color: CHART_COLORS.strength },
] as const;

export function SplitTrendPanel({ data }: { data: TrendPoint[] }) {
  const reducedMotion = useReducedMotion();

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="mb-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>Index Trend · 90D</CardTitle>
          <div className="flex items-center gap-3">
            {trendSeries.map((s) => (
              <span
                key={s.key}
                className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted"
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: s.color }}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {data.length < 2 ? (
          <ChartEmptyState message="Your index trend charts here after a couple of workouts" />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <defs>
                {trendSeries.map((s) => (
                  <linearGradient
                    key={s.key}
                    id={`trend-${s.key}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartTickFill }}
                minTickGap={32}
              />
              <YAxis
                domain={["auto", "auto"]}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: chartTickFill }}
                width={44}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value, name) => [
                  formatIndex(Number(value)),
                  trendSeries.find((s) => s.key === name)?.label ?? String(name),
                ]}
              />
              <Area
                type="monotone"
                dataKey="endurance"
                stroke={CHART_COLORS.endurance}
                strokeWidth={1.5}
                strokeOpacity={0.8}
                fill="url(#trend-endurance)"
                animationDuration={reducedMotion ? 0 : 1400}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="strength"
                stroke={CHART_COLORS.strength}
                strokeWidth={1.5}
                strokeOpacity={0.8}
                fill="url(#trend-strength)"
                animationDuration={reducedMotion ? 0 : 1400}
                animationEasing="ease-out"
              />
              <Area
                type="monotone"
                dataKey="split"
                stroke={CHART_COLORS.split}
                strokeWidth={2.5}
                fill="url(#trend-split)"
                animationDuration={reducedMotion ? 0 : 1400}
                animationEasing="ease-out"
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Sport balance radar (dashboard) ────────────────────────────────────── */

export interface RadarAxis {
  axis: string;
  endurance: number;
  strength: number;
}

export function SportBalanceRadar({ data }: { data: RadarAxis[] }) {
  const reducedMotion = useReducedMotion();

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between">
          <CardTitle>Balance Radar</CardTitle>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-endurance" />
              End
            </span>
            <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-strength" />
              Str
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {data.length < 3 ? (
          <ChartEmptyState message="Train 3+ disciplines to unlock your balance radar" />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={data} outerRadius="72%">
              <PolarGrid stroke={chartGridStroke} />
              <PolarAngleAxis
                dataKey="axis"
                tick={{ fontSize: 10, fill: chartTickFill }}
              />
              <PolarRadiusAxis domain={[0, 999]} tick={false} axisLine={false} />
              <Radar
                name="Endurance"
                dataKey="endurance"
                stroke={CHART_COLORS.endurance}
                fill={CHART_COLORS.endurance}
                fillOpacity={0.18}
                strokeWidth={1.5}
                animationDuration={reducedMotion ? 0 : 1200}
              />
              <Radar
                name="Strength"
                dataKey="strength"
                stroke={CHART_COLORS.strength}
                fill={CHART_COLORS.strength}
                fillOpacity={0.18}
                strokeWidth={1.5}
                animationDuration={reducedMotion ? 0 : 1200}
              />
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value, name) => [formatIndex(Number(value)), String(name)]}
              />
            </RadarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Shared zero-state ───────────────────────────────────────────────────── */

export function ChartEmptyState({ message }: { message: string }) {
  return (
    <div className="relative flex h-full min-h-[200px] items-center justify-center overflow-hidden rounded-xl">
      {/* faint decorative sparkline so empty ≠ gray box */}
      <svg
        aria-hidden
        viewBox="0 0 400 120"
        className="absolute inset-x-0 bottom-0 h-24 w-full opacity-[0.14]"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="empty-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00e65f" stopOpacity={0.7} />
            <stop offset="100%" stopColor="#00e65f" stopOpacity={0} />
          </linearGradient>
        </defs>
        <path
          d="M0 90 C40 70, 70 100, 110 80 S 180 40, 220 60 S 300 20, 340 45 S 380 30, 400 35 L400 120 L0 120 Z"
          fill="url(#empty-spark)"
        />
      </svg>
      <p className="relative max-w-[220px] text-center text-xs leading-relaxed text-muted">
        {message}
      </p>
    </div>
  );
}
