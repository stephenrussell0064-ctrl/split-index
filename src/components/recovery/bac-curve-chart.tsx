"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useReducedMotion } from "framer-motion";
import {
  ChartEmptyState,
  chartGridStroke,
  chartTickFill,
  chartTooltipStyle,
  chartTooltipItemStyle,
  chartTooltipLabelStyle,
} from "@/components/analytics/charts";

export interface BacChartPoint {
  /** Epoch ms. */
  t: number;
  /** g/L. */
  bac: number;
}

/**
 * The estimated blood-alcohol curve for the most recent drinking episode.
 *
 * The chart's job is to make "still processing this" legible at a glance —
 * the shape, the peak, and where now sits on it. It is deliberately NOT
 * labelled against any legal limit and carries no driving threshold line:
 * a Widmark estimate can sit either side of a measured breath test by more
 * than the entire UK limit, and a training app drawing a line at 0.8 g/L
 * would be read as permission by somebody at some point.
 */
export function BacCurveChart({
  points,
  nowMs,
  sessionMs,
}: {
  points: BacChartPoint[];
  nowMs: number;
  sessionMs?: number | null;
}) {
  const reducedMotion = useReducedMotion();

  if (points.length < 2) {
    return <ChartEmptyState message="No drinks logged in the last 48 hours." />;
  }

  const timeLabel = (t: number) =>
    new Date(t).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <defs>
            <linearGradient id="bacFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
              <stop offset="100%" stopColor="#f59e0b" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={chartGridStroke} vertical={false} />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={timeLabel}
            tick={{ fill: chartTickFill, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={40}
          />
          <YAxis
            tick={{ fill: chartTickFill, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v: number) => v.toFixed(2)}
          />
          <Tooltip
            contentStyle={chartTooltipStyle}
            // The container style sets a dark background but not the text
            // colours inside it; without these two the label and the value
            // inherit Recharts' own, which are chosen for the white tooltip it
            // ships with. chart-tooltips-are-readable.test.ts enforces the set.
            labelStyle={chartTooltipLabelStyle}
            itemStyle={chartTooltipItemStyle}
            labelFormatter={(t) => timeLabel(Number(t))}
            formatter={(value) => [`${Number(value).toFixed(3)} g/L`, "Estimated"]}
          />
          <ReferenceLine
            x={nowMs}
            stroke={chartTickFill}
            strokeDasharray="4 4"
            label={{ value: "now", fill: chartTickFill, fontSize: 10, position: "top" }}
          />
          {sessionMs != null && (
            <ReferenceLine
              x={sessionMs}
              stroke="#3BA6FF"
              strokeDasharray="4 4"
              label={{ value: "session", fill: "#3BA6FF", fontSize: 10, position: "top" }}
            />
          )}
          <Area
            type="monotone"
            dataKey="bac"
            stroke="#f59e0b"
            strokeWidth={2}
            fill="url(#bacFill)"
            isAnimationActive={!reducedMotion}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
