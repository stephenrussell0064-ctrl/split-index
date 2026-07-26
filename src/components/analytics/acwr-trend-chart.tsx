"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea } from "recharts";
import { useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChartEmptyState, chartGridStroke, chartTickFill, chartTooltipStyle } from "@/components/analytics/charts";
import { designTokens } from "@/lib/design/tokens";
import type { AcwrTrendPoint } from "@/lib/scoring/injury-risk";

/**
 * ACWR as a trend, not just a snapshot (user feedback: "i want this data
 * analytics displayed and detailed as much as possible for proper data
 * analysis on all their trends and performances"). The dashboard's Recovery
 * & Injury Risk panel only ever shows today's ratio — this is the "how did
 * I get here, and is it getting worse" view: whether load has been drifting
 * toward the danger band or settling back into optimal over recent weeks.
 */
export function AcwrTrendChart({ data }: { data: AcwrTrendPoint[] }) {
  const reducedMotion = useReducedMotion();

  return (
    <Card className="flex h-full flex-col">
      <CardHeader className="mb-2">
        <div className="flex items-center justify-between">
          <CardTitle>ACWR Trend</CardTitle>
          <span className="text-[10px] uppercase tracking-wider text-muted">acute ÷ chronic load</span>
        </div>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {data.length < 2 ? (
          <ChartEmptyState message="Your load ratio trends here once you've logged a few weeks of training" />
        ) : (
          <div role="img" aria-label={`ACWR trend chart over ${data.length} weeks`}>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="acwrGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={designTokens.strengthAccent} stopOpacity={0.28} />
                    <stop offset="100%" stopColor={designTokens.strengthAccent} stopOpacity={0} />
                  </linearGradient>
                </defs>
                {/* Optimal band (0.8-1.3) and danger band (>1.5) for at-a-glance context */}
                <ReferenceArea y1={0.8} y2={1.3} fill={designTokens.strengthAccent} fillOpacity={0.06} />
                <ReferenceArea y1={1.5} y2={2.2} fill="#ef4444" fillOpacity={0.08} />
                <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
                <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: chartTickFill }} />
                <YAxis
                  domain={[0, "auto"]}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 10, fill: chartTickFill }}
                  width={32}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value, _name, item) => [
                    `${Number(value).toFixed(2)} · ${item.payload.zone}`,
                    "ACWR",
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="acwr"
                  stroke={designTokens.strengthAccent}
                  strokeWidth={2}
                  fill="url(#acwrGrad)"
                  animationDuration={reducedMotion ? 0 : 1000}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
