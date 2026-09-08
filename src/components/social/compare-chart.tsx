"use client";

import { ChartFigure } from "@/components/analytics/chart-figure";
import { describeComparison } from "@/lib/a11y/describe-series";
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
    <ChartFigure
      label="Split Index over time, both athletes"
      summary={describeComparison(
        series.map((s) => ({
          label: s.label,
          data: s.data.map((d) => ({ at: d.date, value: d.value })),
        }))
      )}
      /*
        One row per date with a column per athlete, rather than two tables. The
        question this chart answers is who is ahead on a given day, and that is
        a comparison across a row — two separate tables would make a reader hold
        one series in their head while reading the other.
      */
      columns={[
        { header: "Date", cell: (r: Record<string, string | number>) => String(r.date) },
        ...series.map((s, i) => ({
          header: s.label,
          cell: (r: Record<string, string | number>) =>
            r[`v${i}`] === undefined ? "no reading" : String(r[`v${i}`]),
        })),
      ]}
      rows={merged}
    >
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
          tickFormatter={(v) => formatIndex(Number(v))}
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
    </ChartFigure>
  );
}
