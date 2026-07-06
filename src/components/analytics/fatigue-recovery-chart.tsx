"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ComposedChart,
  Area,
  Line,
  CartesianGrid,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import { formatPercent } from "@/lib/utils/format";
import type { FatigueRecoveryPoint } from "./types";

interface FatigueRecoveryChartProps {
  data: FatigueRecoveryPoint[];
}

export function FatigueRecoveryChart({ data }: FatigueRecoveryChartProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Fatigue & Recovery</CardTitle>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              ACWR overlay
            </span>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {data.length < 2 ? (
            <ChartEmptyState message="Recovery and fatigue trends appear after scoring workouts" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={data} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="recoveryGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fatigueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ef4444" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 6" strokeOpacity={0.15} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  minTickGap={32}
                />
                <YAxis
                  yAxisId="left"
                  domain={[0, 100]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  width={36}
                  tickFormatter={(v) => `${v}%`}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 2]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  width={32}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value, name) => {
                    if (name === "acwr") return [value ?? "—", "ACWR"];
                    return [formatPercent(Number(value)), String(name)];
                  }}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="recovery"
                  name="Recovery"
                  stroke="#10b981"
                  fill="url(#recoveryGrad)"
                  strokeWidth={2}
                  animationDuration={reducedMotion ? 0 : 1200}
                />
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="fatigue"
                  name="Fatigue"
                  stroke="#ef4444"
                  fill="url(#fatigueGrad)"
                  strokeWidth={2}
                  animationDuration={reducedMotion ? 0 : 1200}
                />
                <Line
                  yAxisId="right"
                  type="monotone"
                  dataKey="acwr"
                  name="acwr"
                  stroke="#f59e0b"
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                  dot={false}
                  connectNulls
                  animationDuration={reducedMotion ? 0 : 1400}
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
