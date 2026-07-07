"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import { formatIndex } from "@/lib/utils/format";
import type { ProjectionPoint } from "./types";

interface ProjectionChartProps {
  data: ProjectionPoint[];
}

export function ProjectionChart({ data }: ProjectionChartProps) {
  const reducedMotion = useReducedMotion();
  const forecastStart = data.findIndex((d) => d.isForecast && d.projected != null);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 }}
    >
      <Card className="flex h-full flex-col" glow="accent">
        <CardHeader className="mb-2">
          <CardTitle>Fitness Projections · 7D / 30D</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {data.length < 3 ? (
            <ChartEmptyState message="Projections unlock after a few logged workouts" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 6" strokeOpacity={0.15} />
                <XAxis
                  dataKey="date"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
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
                    value != null ? formatIndex(Number(value)) : "—",
                    name === "split" ? "Actual" : "Forecast",
                  ]}
                />
                {forecastStart > 0 && (
                  <ReferenceLine
                    x={data[forecastStart]?.date}
                    stroke="rgba(148,163,184,0.3)"
                    strokeDasharray="4 4"
                  />
                )}
                <Line
                  type="monotone"
                  dataKey="split"
                  stroke="#fafafa"
                  strokeWidth={2.5}
                  dot={{ r: 2, fill: "#fafafa" }}
                  animationDuration={reducedMotion ? 0 : 1200}
                />
                <Line
                  type="monotone"
                  dataKey="projected"
                  stroke="#10b981"
                  strokeWidth={2}
                  strokeDasharray="8 4"
                  dot={{ r: 3, fill: "#10b981" }}
                  connectNulls
                  animationDuration={reducedMotion ? 0 : 1400}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
