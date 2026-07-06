"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { motion, useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartTooltipStyle, ChartEmptyState } from "@/components/analytics/charts";
import type { DistributionSlice } from "./types";

interface TrainingZonesChartProps {
  zones: DistributionSlice[];
  usesHr: boolean;
}

export function TrainingZonesChart({ zones, usesHr }: TrainingZonesChartProps) {
  const reducedMotion = useReducedMotion();
  const total = zones.reduce((s, d) => s + d.value, 0);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.26 }}
    >
      <Card className="flex h-full flex-col">
        <CardHeader className="mb-2">
          <div className="flex items-center justify-between">
            <CardTitle>Training Zones</CardTitle>
            <span className="text-[10px] uppercase tracking-wider text-muted">
              {usesHr ? "HR zones" : "Session types"}
            </span>
          </div>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          {total === 0 ? (
            <ChartEmptyState message="Add heart rate data to unlock HR zone breakdown" />
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={zones}
                    dataKey="value"
                    nameKey="name"
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={2}
                    animationDuration={reducedMotion ? 0 : 1100}
                  >
                    {zones.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} stroke="transparent" />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(value, name) => [value, name]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {zones
                  .filter((d) => d.value > 0)
                  .map((d) => (
                    <div key={d.name} className="flex items-center gap-2 text-xs">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: d.color }}
                      />
                      <span className="text-muted">{d.name}</span>
                      <span className="ml-auto tabular-nums">{d.value}</span>
                    </div>
                  ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
