"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  Legend,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import { formatIndex } from "@/lib/utils/format";
import type { MovingAveragePoint } from "./types";

interface MovingAverageChartProps {
  data: MovingAveragePoint[];
}

export function MovingAverageChart({ data }: MovingAverageChartProps) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-2">
          <CardTitle>Moving Averages · 7D / 28D</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {data.length < 7 ? (
            <ChartEmptyState message="Need at least a week of data for moving averages" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <LineChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 6" strokeOpacity={0.15} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  minTickGap={32}
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
                  formatter={(value) =>
                    value != null ? [formatIndex(Number(value)), ""] : ["—", ""]
                  }
                />
                <Legend
                  wrapperStyle={{ fontSize: 10, paddingTop: 8 }}
                  formatter={(v) => (
                    <span className="text-muted uppercase tracking-wider">{v}</span>
                  )}
                />
                <Line
                  type="monotone"
                  dataKey="split"
                  name="Split"
                  stroke="#6366f1"
                  strokeWidth={1}
                  strokeOpacity={0.35}
                  dot={false}
                  animationDuration={reducedMotion ? 0 : 1200}
                />
                <Line
                  type="monotone"
                  dataKey="splitMa7"
                  name="7-day MA"
                  stroke="#6366f1"
                  strokeWidth={2.5}
                  dot={false}
                  connectNulls
                  animationDuration={reducedMotion ? 0 : 1400}
                />
                <Line
                  type="monotone"
                  dataKey="splitMa28"
                  name="28-day MA"
                  stroke="#06b6d4"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  connectNulls
                  animationDuration={reducedMotion ? 0 : 1600}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
