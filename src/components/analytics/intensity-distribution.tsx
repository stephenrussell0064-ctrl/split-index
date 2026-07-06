"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import type { DistributionSlice } from "./types";

interface IntensityDistributionProps {
  sessionTypes: DistributionSlice[];
  rpeBands: DistributionSlice[];
}

function DonutChart({ data, title }: { data: DistributionSlice[]; title: string }) {
  const reducedMotion = useReducedMotion();
  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="flex h-full flex-col">
      <p className="mb-2 text-[10px] uppercase tracking-wider text-muted">{title}</p>
      {total === 0 ? (
        <ChartEmptyState message="Session intensity data builds from logged workouts" />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={72}
                paddingAngle={2}
                animationDuration={reducedMotion ? 0 : 1000}
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} stroke="transparent" />
                ))}
              </Pie>
              <Tooltip
                contentStyle={chartTooltipStyle}
                formatter={(value, name) => [value, name]}
              />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {data
              .filter((d) => d.value > 0)
              .map((d) => (
                <span
                  key={d.name}
                  className="flex items-center gap-1.5 text-[10px] text-muted"
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: d.color }}
                  />
                  {d.name} ({d.value})
                </span>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

export function IntensityDistribution({
  sessionTypes,
  rpeBands,
}: IntensityDistributionProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.24 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-2">
          <CardTitle>Intensity Distribution</CardTitle>
        </CardHeader>
        <CardContent className="grid min-h-0 flex-1 gap-6 sm:grid-cols-2">
          <DonutChart data={sessionTypes} title="Session types" />
          <DonutChart data={rpeBands} title="RPE bands" />
        </CardContent>
      </Card>
    </motion.div>
  );
}
