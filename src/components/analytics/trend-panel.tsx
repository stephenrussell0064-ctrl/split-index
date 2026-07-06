"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  CartesianGrid,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import { formatIndex } from "@/lib/utils/format";
import type { TrendGranularity, TrendPoint } from "./types";

const SERIES = [
  { key: "split", label: "Split", color: "#6366f1" },
  { key: "endurance", label: "Endurance", color: "#06b6d4" },
  { key: "strength", label: "Strength", color: "#a855f7" },
] as const;

interface TrendPanelProps {
  data: TrendPoint[];
  granularity: TrendGranularity;
}

export function TrendPanel({ data, granularity }: TrendPanelProps) {
  const reducedMotion = useReducedMotion();
  const title =
    granularity === "week"
      ? "Weekly Trends"
      : granularity === "month"
        ? "Monthly Trends"
        : "Yearly Trends";

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{title}</CardTitle>
            <div className="flex items-center gap-3">
              {SERIES.map((s) => (
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
            <ChartEmptyState message="Log workouts to unlock index trends across time" />
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <defs>
                  {SERIES.map((s) => (
                    <linearGradient
                      key={s.key}
                      id={`analytics-trend-${s.key}`}
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
                <CartesianGrid vertical={false} strokeDasharray="3 6" strokeOpacity={0.15} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  minTickGap={28}
                />
                <YAxis
                  domain={["auto", "auto"]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  width={44}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value, name) => [
                    formatIndex(Number(value)),
                    SERIES.find((s) => s.key === name)?.label ?? String(name),
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="endurance"
                  stroke="#06b6d4"
                  strokeWidth={1.5}
                  fill="url(#analytics-trend-endurance)"
                  animationDuration={reducedMotion ? 0 : 1400}
                />
                <Area
                  type="monotone"
                  dataKey="strength"
                  stroke="#a855f7"
                  strokeWidth={1.5}
                  fill="url(#analytics-trend-strength)"
                  animationDuration={reducedMotion ? 0 : 1400}
                />
                <Area
                  type="monotone"
                  dataKey="split"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  fill="url(#analytics-trend-split)"
                  animationDuration={reducedMotion ? 0 : 1400}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
