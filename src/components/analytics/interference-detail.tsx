"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
  Cell,
} from "recharts";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ChartEmptyState, chartGridStroke, chartTickFill, chartTooltipStyle } from "@/components/analytics/charts";
import { ShareImageButton } from "@/components/analytics/share-image-button";
import { designTokens } from "@/lib/design/tokens";
import { INTERFERENCE_CONFIG } from "@/lib/scoring/interference";
import type { InterferenceReport } from "@/lib/scoring/interference";

function dayLabel(d: number): string {
  if (d === 0) return "Same day";
  if (d === 1) return "+1 day";
  return `+${d} days`;
}

export function InterferenceDetail({ report }: { report: InterferenceReport }) {
  const { strengthToCardio, cardioToStrength } = report;
  const hasRealFinding = !strengthToCardio.calibrating || !cardioToStrength.calibrating;

  return (
    <div className="space-y-6">
      {hasRealFinding && (
        <div className="flex justify-end">
          <ShareImageButton
            href="/api/interference/report-card"
            filename="interference-report.png"
            shareTitle="My Split Index Interference Report"
            shareText="Here's what leg day does to my running — tracked with Split Index."
            label="Share as image"
          />
        </div>
      )}
      <Card>
        <CardHeader className="mb-2">
          <CardTitle>Strength → Cardio</CardTitle>
          <p className="text-xs text-muted">
            Cardio efficiency (pace : heart-rate) at each day since your last strength session,
            compared against your own rested baseline — a real rest gap before the session, no
            strength influence at all.
          </p>
        </CardHeader>
        <CardContent>
          {strengthToCardio.calibrating ? (
            <ChartEmptyState
              message={`Gathering data — ${strengthToCardio.sampleCount}/${strengthToCardio.minSamples} comparable easy-effort sessions logged`}
            />
          ) : (
            <>
              <p className="mb-4 text-sm font-medium text-foreground/90">{strengthToCardio.summary}</p>
              <div role="img" aria-label="Efficiency delta by days since last strength session">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={strengthToCardio.decayByDay.filter((d) => d.sampleCount > 0)}
                    margin={{ top: 8, right: 4, left: -8, bottom: 0 }}
                  >
                    <CartesianGrid vertical={false} strokeDasharray="3 6" stroke={chartGridStroke} />
                    <XAxis
                      dataKey="daysSinceStrength"
                      tickFormatter={(v) => dayLabel(Number(v))}
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: chartTickFill }}
                    />
                    <YAxis
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 10, fill: chartTickFill }}
                      width={40}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <ReferenceLine y={0} stroke={chartGridStroke} />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value) => [`${value}%`, "Efficiency vs rested baseline"]}
                      labelFormatter={(v) => dayLabel(Number(v))}
                    />
                    <Bar dataKey="efDeltaPct" radius={[4, 4, 4, 4]}>
                      {strengthToCardio.decayByDay
                        .filter((d) => d.sampleCount > 0)
                        .map((d) => (
                          <Cell
                            key={d.daysSinceStrength}
                            fill={
                              d.efDeltaPct !== null && d.efDeltaPct < 0
                                ? "#ef4444"
                                : designTokens.strengthAccent
                            }
                          />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Based on {strengthToCardio.sampleCount} qualifying {strengthToCardio.primarySport?.replace("_", " ")}{" "}
                sessions (easy/recovery/long effort only — the same sessions the app already
                treats as steady-state).
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="mb-2">
          <CardTitle>Cardio → Strength</CardTitle>
          <p className="text-xs text-muted">
            Strength performance in gym sessions preceded by a high-cardio-volume week (last{" "}
            {INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH} days) vs. a lower-volume
            week.
          </p>
        </CardHeader>
        <CardContent>
          {cardioToStrength.calibrating ? (
            <ChartEmptyState
              message={`Gathering data — ${cardioToStrength.sampleCount}/${cardioToStrength.minSamples} gym sessions logged`}
            />
          ) : (
            <>
              <p className="mb-4 text-sm font-medium text-foreground/90">{cardioToStrength.summary}</p>
              <div role="img" aria-label="Strength score in high vs low cardio-volume weeks">
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart
                    data={[
                      { label: "Lower cardio week", value: cardioToStrength.lowCardioAvgStrengthComponent },
                      { label: "Higher cardio week", value: cardioToStrength.highCardioAvgStrengthComponent },
                    ]}
                    layout="vertical"
                    margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 6" stroke={chartGridStroke} />
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="label"
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 11, fill: chartTickFill }}
                      width={120}
                    />
                    <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [value, "Strength score"]} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={designTokens.strengthAccent} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Based on {cardioToStrength.sampleCount} gym sessions, split by whether their
                trailing {INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH}-day cardio
                load was above or below your own median.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
