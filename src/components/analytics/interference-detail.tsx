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
import { chartGridStroke, chartTickFill, chartTooltipStyle } from "@/components/analytics/charts";
import { ShareImageButton } from "@/components/analytics/share-image-button";
import { designTokens } from "@/lib/design/tokens";
import { INTERFERENCE_CONFIG, hasShareableFinding } from "@/lib/scoring/interference";
import type { InterferenceReport } from "@/lib/scoring/interference";

function dayLabel(d: number): string {
  if (d === 0) return "Same day";
  if (d === 1) return "+1 day";
  return `+${d} days`;
}

/**
 * Replaces a flat "gathering data" placeholder with a visible progress bar
 * toward the real finding — the screen should feel like it's building
 * toward something concrete no matter how little is logged yet, not like a
 * dead end until an arbitrary session count is hit.
 */
function SessionsProgress({
  current,
  target,
  message,
}: {
  current: number;
  target: number;
  message: string;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div className="flex min-h-[200px] flex-col items-center justify-center gap-4 rounded-xl px-6 py-8 text-center">
      <div className="w-full max-w-xs">
        <div className="mb-2 flex items-center justify-between text-xs text-muted">
          <span>Progress toward your first finding</span>
          <span className="tabular-nums">
            {current}/{target}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-white/8">
          <div
            className="h-full rounded-full bg-accent transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      <p className="max-w-xs text-sm text-muted">{message}</p>
    </div>
  );
}

export function InterferenceDetail({ report }: { report: InterferenceReport }) {
  const { strengthToCardio, cardioToStrength } = report;
  const hasRealFinding = hasShareableFinding(report);

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
            strengthToCardio.weeklyFallback ? (
              <>
                <p className="mb-1 text-sm font-medium text-foreground/90">
                  {strengthToCardio.weeklyFallback.summary}
                </p>
                <p className="mb-4 text-xs text-muted">
                  Still gathering day-by-day pairs ({strengthToCardio.sampleCount}/
                  {strengthToCardio.minSamples}) — this is a coarser weekly comparison in the
                  meantime. It upgrades to the precise day-after chart once you log cardio within a
                  few days of a strength session.
                </p>
                <div role="img" aria-label="Cardio efficiency in weeks with vs without a strength session">
                  <ResponsiveContainer width="100%" height={160}>
                    <BarChart
                      data={[
                        {
                          label: "Weeks without strength",
                          value: strengthToCardio.weeklyFallback.weeksWithoutStrengthAvgEF,
                        },
                        {
                          label: "Weeks with strength",
                          value: strengthToCardio.weeklyFallback.weeksWithStrengthAvgEF,
                        },
                      ]}
                      layout="vertical"
                      margin={{ top: 8, right: 24, left: 8, bottom: 0 }}
                    >
                      <CartesianGrid horizontal={false} strokeDasharray="3 6" stroke={chartGridStroke} />
                      <XAxis type="number" hide domain={["dataMin - dataMin * 0.05", "dataMax + dataMax * 0.05"]} />
                      <YAxis
                        type="category"
                        dataKey="label"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: chartTickFill }}
                        width={140}
                      />
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [value, "Avg efficiency factor"]} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={designTokens.strengthAccent} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <p className="mt-2 text-xs text-muted">
                  Based on {strengthToCardio.weeklyFallback.sampleCountWithStrength} qualifying{" "}
                  {strengthToCardio.primarySport?.replace("_", " ")} session
                  {strengthToCardio.weeklyFallback.sampleCountWithStrength === 1 ? "" : "s"} in weeks with
                  a strength session, vs {strengthToCardio.weeklyFallback.sampleCountWithoutStrength} in
                  weeks without.
                </p>
              </>
            ) : (
              <SessionsProgress
                current={strengthToCardio.sampleCount}
                target={strengthToCardio.minSamples}
                message={strengthToCardio.summary}
              />
            )
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
            <SessionsProgress
              current={cardioToStrength.sampleCount}
              target={cardioToStrength.minSamples}
              message={cardioToStrength.summary}
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
