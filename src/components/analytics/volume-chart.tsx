"use client";

import {
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
} from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import { formatDuration, formatDistance } from "@/lib/utils/format";
import type { VolumeWeek } from "./types";

type VolumeMetric = "load" | "duration" | "distance";

interface VolumeChartProps {
  data: VolumeWeek[];
  metric?: VolumeMetric;
}

export function VolumeChart({ data, metric = "load" }: VolumeChartProps) {
  const reducedMotion = useReducedMotion();
  const hasData = data.some((d) => d.load > 0 || d.duration > 0);

  const formatValue = (v: number) => {
    if (metric === "duration") return formatDuration(v);
    if (metric === "distance") return formatDistance(v);
    return `${v} AU`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.22 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-2">
          <CardTitle>Training Volume · 12W</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {!hasData ? (
            <ChartEmptyState message="Weekly load, duration, and distance charts populate as you train" />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 6" strokeOpacity={0.15} />
                <XAxis
                  dataKey="week"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 9 }}
                  interval="preserveStartEnd"
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10 }}
                  width={44}
                  tickFormatter={(v) =>
                    metric === "duration"
                      ? `${Math.round(v / 3600)}h`
                      : metric === "distance"
                        ? `${Math.round(v / 1000)}k`
                        : String(v)
                  }
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value) => [formatValue(Number(value)), ""]}
                  labelFormatter={(label) => `Week of ${label}`}
                />
                <Bar
                  dataKey={metric}
                  fill="#00e65f"
                  radius={[6, 6, 0, 0]}
                  animationDuration={reducedMotion ? 0 : 800}
                  animationEasing="ease-out"
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
