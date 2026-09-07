"use client";

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, ReferenceArea } from "recharts";
import { useReducedMotion } from "framer-motion";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChartEmptyState, chartGridStroke, chartTickFill, chartTooltipStyle } from "@/components/analytics/charts";
import { designTokens } from "@/lib/design/tokens";
import type { AcwrTrendPoint, InjuryRiskZone } from "@/lib/scoring/injury-risk";
import { ChartFigure } from "@/components/analytics/chart-figure";

/** The bands the chart draws, in words, so the table and the sentence agree. */
const ACWR_ZONE_WORDS: Record<InjuryRiskZone, string> = {
  Undertraining: "below the optimal band",
  Optimal: "in the optimal band",
  Caution: "above optimal",
  Danger: "in the danger band",
};

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
        <p className="mt-1 text-xs text-muted">
          This week&apos;s training load compared to your last month&apos;s average — a
          ratio climbing well above 1.5 means you&apos;ve ramped up faster than your body
          has adapted.
        </p>
      </CardHeader>
      <CardContent className="min-h-0 flex-1">
        {data.length < 2 ? (
          <ChartEmptyState message="Your load ratio trends here once you've logged a few weeks of training" />
        ) : (
          <ChartFigure
            label="ACWR trend"
            summary={
              /*
                Not describeSeries. The point of this chart is not the shape of
                the line but which BAND the ratio is in — optimal 0.8 to 1.3,
                danger above 1.5 — which is why the plot draws those bands and
                why a generic "up from 0.94 to 1.12" would report the movement
                and lose the meaning.
              */
              `Acute-to-chronic load ratio, ${data.length} weeks. Latest ${
                data[data.length - 1].acwr
              }, ${ACWR_ZONE_WORDS[data[data.length - 1].zone]}. Started at ${data[0].acwr}, ${
                ACWR_ZONE_WORDS[data[0].zone]
              }.`
            }
            columns={[
              { header: "Date", cell: (d: AcwrTrendPoint) => d.date },
              { header: "Ratio", cell: (d: AcwrTrendPoint) => String(d.acwr) },
              { header: "Zone", cell: (d: AcwrTrendPoint) => ACWR_ZONE_WORDS[d.zone] },
            ]}
            rows={data}
          >
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
          </ChartFigure>
        )}
      </CardContent>
    </Card>
  );
}
