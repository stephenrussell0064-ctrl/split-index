"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { chartTooltipStyle } from "@/components/analytics/charts";
import { formatIndex } from "@/lib/utils/format";
import type { CompareSeries } from "@/lib/social/types";

interface CompareChartProps {
  series: CompareSeries[];
  height?: number;
}

export function CompareChart({ series, height = 260 }: CompareChartProps) {
  const hasData = series.some((s) => s.data.length >= 2);

  if (!hasData) {
    return (
      <div className="flex h-48 items-center justify-center rounded-xl text-sm text-muted">
        Both athletes need index history to compare trends
      </div>
    );
  }

  const dateSet = new Set<string>();
  for (const s of series) {
    for (const point of s.data) dateSet.add(point.date);
  }
  const dates = Array.from(dateSet);

  const merged = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    series.forEach((s, i) => {
      const point = s.data.find((d) => d.date === date);
      if (point) row[`v${i}`] = point.value;
    });
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={merged} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} strokeDasharray="3 6" stroke="rgba(148,163,184,0.12)" />
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
          formatter={(value) => [formatIndex(Number(value)), "Index"]}
        />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 8 }}
          formatter={(value) => {
            const idx = Number(String(value).replace("v", ""));
            return series[idx]?.label ?? value;
          }}
        />
        {series.map((s, i) => (
          <Line
            key={s.label}
            type="monotone"
            dataKey={`v${i}`}
            name={`v${i}`}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
            animationDuration={900}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
