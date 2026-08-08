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
  LabelList,
} from "recharts";
import { Dumbbell, HeartPulse, ClipboardList, GitCompare, Lightbulb } from "lucide-react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { chartGridStroke, chartTickFill, chartTooltipStyle } from "@/components/analytics/charts";
import { ShareImageButton } from "@/components/analytics/share-image-button";
import { cn } from "@/lib/utils/cn";
import { designTokens } from "@/lib/design/tokens";
import {
  INTERFERENCE_CONFIG,
  hasShareableFinding,
  type DayBucketStat,
} from "@/lib/scoring/interference";
import type { InterferenceReport } from "@/lib/scoring/interference";

const GOOD_COLOR = designTokens.strengthAccent; // no measurable cost
const BAD_COLOR = "#ef4444"; // measurable cost

/** Small visual flag next to a finding built from below-target sample size — the summary text already spells out the caveat in full; this is just the at-a-glance version. */
function EarlyDataBadge() {
  return (
    <span className="ml-2 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
      Early data
    </span>
  );
}

function dayLabel(d: number): string {
  if (d === 0) return "That day";
  if (d === 1) return "Next day";
  return `${d} days later`;
}

/**
 * The one number that actually answers the question, in the same visual
 * language as a Split Index score — big, colored, unmissable — instead of
 * making the reader parse a bar chart's axis to find it themselves (user
 * feedback: "very difficult to read and visualise").
 */
function HeadlineStat({ deltaPct, sentence }: { deltaPct: number | null; sentence: string }) {
  const isCost = deltaPct !== null && deltaPct < -3;
  const color = deltaPct === null ? "text-muted" : isCost ? "text-danger" : "text-strength-accent";

  return (
    <div className="mb-5 flex items-center gap-4">
      {deltaPct !== null && (
        <p className={cn("index-display shrink-0 text-4xl font-bold tabular-nums", color)}>
          {deltaPct > 0 ? "+" : ""}
          {deltaPct}%
        </p>
      )}
      <p className="text-sm leading-snug text-foreground/90">{sentence}</p>
    </div>
  );
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

/** The day-1 (or day-0 fallback) bucket — same pick the plain-language summary sentence is built from, so the big headline number and the sentence always agree. */
function pickHeadlineBucket(decayByDay: DayBucketStat[]): DayBucketStat | null {
  const dayOne = decayByDay.find((d) => d.daysSinceStrength === 1 && d.sampleCount > 0);
  if (dayOne) return dayOne;
  return decayByDay.find((d) => d.daysSinceStrength === 0 && d.sampleCount > 0) ?? null;
}

export function InterferenceDetail({ report }: { report: InterferenceReport }) {
  const { strengthToCardio, cardioToStrength } = report;
  const hasRealFinding = hasShareableFinding(report);
  const headlineBucket = pickHeadlineBucket(strengthToCardio.decayByDay);

  return (
    <div className="space-y-6">
      {/* Plain-language primer — what these two cards actually answer,
          before any chart or percentage. User feedback: the page dropped
          straight into dense charts with no explanation of the point; a
          later round of feedback ("I still don't understand interference...
          how can it just be more easily conceptualised") asked for more —
          so the paragraph below is now paired with a concrete 3-step strip
          showing the mechanism itself (log → compare → reveal), not just a
          description of it. Concept, not data, so it stays legible even
          before a single session has been logged. */}
      <Card padding="md" className="border border-accent/15 bg-accent/[0.03]">
        <p className="text-sm leading-relaxed text-foreground/90">
          Your body doesn&apos;t fully separate lifting from cardio — a hard leg day can make
          tomorrow&apos;s run feel harder than it should, and a big running week can quietly
          blunt next week&apos;s lifts. This page checks whether that&apos;s actually happening
          to <span className="font-medium text-foreground">you</span>, using only your own
          logged sessions — never a generic population claim.
        </p>
        <div className="mt-4 grid grid-cols-1 gap-3 border-t border-white/5 pt-4 sm:grid-cols-3">
          <div className="flex items-start gap-2.5">
            <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <p className="text-xs leading-snug text-muted">
              <span className="font-medium text-foreground/90">1. You log</span> both gym and
              cardio sessions, same as always.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <GitCompare className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <p className="text-xs leading-snug text-muted">
              <span className="font-medium text-foreground/90">2. We compare</span> how you
              perform right after training vs. fully rested.
            </p>
          </div>
          <div className="flex items-start gap-2.5">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted" />
            <p className="text-xs leading-snug text-muted">
              <span className="font-medium text-foreground/90">3. You see</span> the real cost
              (or non-cost) in plain terms below.
            </p>
          </div>
        </div>
      </Card>

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
          <CardTitle className="flex items-center text-sm font-semibold normal-case tracking-normal text-foreground">
            <Dumbbell className="mr-2 h-4 w-4 text-strength-accent" />
            Does lifting slow down your cardio?
            {!strengthToCardio.calibrating && strengthToCardio.lowConfidence && <EarlyDataBadge />}
          </CardTitle>
          <p className="text-xs text-muted">
            Compares how efficiently you run/row/swim (pace for the heart-rate effort it took) on
            the days right after a strength session, against a normal day where you were fully
            rested with no lifting nearby.
          </p>
        </CardHeader>
        <CardContent>
          {strengthToCardio.calibrating ? (
            strengthToCardio.weeklyFallback ? (
              <>
                <HeadlineStat
                  deltaPct={strengthToCardio.weeklyFallback.deltaPct}
                  sentence={strengthToCardio.weeklyFallback.summary}
                />
                <p className="mb-4 text-xs text-muted">
                  Still gathering day-by-day pairs ({strengthToCardio.sampleCount}/
                  {strengthToCardio.minSamples}) — this is a coarser weekly comparison in the
                  meantime. It upgrades to the precise day-after chart once you log cardio within a
                  few days of a strength session.
                </p>
                <div role="img" aria-label="Cardio efficiency in weeks with vs without a strength session">
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart
                      data={[
                        {
                          label: "Normal week",
                          value: strengthToCardio.weeklyFallback.weeksWithoutStrengthAvgEF,
                        },
                        {
                          label: "Strength-training week",
                          value: strengthToCardio.weeklyFallback.weeksWithStrengthAvgEF,
                        },
                      ]}
                      layout="vertical"
                      margin={{ top: 8, right: 36, left: 8, bottom: 0 }}
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
                      <Tooltip contentStyle={chartTooltipStyle} formatter={(value) => [value, "How efficiently you ran"]} />
                      <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={designTokens.strengthAccent}>
                        <LabelList dataKey="value" position="right" style={{ fill: chartTickFill, fontSize: 11 }} />
                      </Bar>
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
              <HeadlineStat
                deltaPct={headlineBucket?.efDeltaPct ?? null}
                sentence={strengthToCardio.summary}
              />
              <div role="img" aria-label="Efficiency delta by days since last strength session">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={strengthToCardio.decayByDay.filter((d) => d.sampleCount > 0)}
                    margin={{ top: 20, right: 4, left: -8, bottom: 0 }}
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
                    <ReferenceLine
                      y={0}
                      stroke={chartGridStroke}
                      label={{
                        value: "0% = your normal rested pace",
                        position: "insideTopLeft",
                        fill: chartTickFill,
                        fontSize: 10,
                      }}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      formatter={(value) => [`${value}%`, "vs. your normal rested pace"]}
                      labelFormatter={(v) => dayLabel(Number(v))}
                    />
                    <Bar dataKey="efDeltaPct" radius={[4, 4, 4, 4]}>
                      <LabelList
                        dataKey="efDeltaPct"
                        position="top"
                        formatter={(v) => `${Number(v) > 0 ? "+" : ""}${v}%`}
                        style={{ fontSize: 10, fill: chartTickFill }}
                      />
                      {strengthToCardio.decayByDay
                        .filter((d) => d.sampleCount > 0)
                        .map((d) => (
                          <Cell
                            key={d.daysSinceStrength}
                            fill={
                              d.efDeltaPct !== null && d.efDeltaPct < -3 ? BAD_COLOR : GOOD_COLOR
                            }
                          />
                        ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Based on {strengthToCardio.sampleCount} qualifying {strengthToCardio.primarySport?.replace("_", " ")}{" "}
                sessions tagged easy/recovery/long — deliberately slow efforts, so a real change in
                how they feel is a genuine signal, not just you running faster or slower on
                purpose.
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="mb-2">
          <CardTitle className="flex items-center text-sm font-semibold normal-case tracking-normal text-foreground">
            <HeartPulse className="mr-2 h-4 w-4 text-cardio-accent" />
            Does cardio weaken your lifting?
            {!cardioToStrength.calibrating && cardioToStrength.lowConfidence && <EarlyDataBadge />}
          </CardTitle>
          <p className="text-xs text-muted">
            Compares your strength score in gym sessions that followed a heavy cardio week (last{" "}
            {INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH} days) against gym
            sessions that followed a lighter one.
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
              <HeadlineStat deltaPct={cardioToStrength.deltaPct} sentence={cardioToStrength.summary} />
              <div role="img" aria-label="Strength score in high vs low cardio-volume weeks">
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    data={[
                      { label: "Lighter cardio week", value: cardioToStrength.lowCardioAvgStrengthComponent },
                      { label: "Heavy cardio week", value: cardioToStrength.highCardioAvgStrengthComponent },
                    ]}
                    layout="vertical"
                    margin={{ top: 8, right: 36, left: 8, bottom: 0 }}
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
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={designTokens.cardioAccent}>
                      <LabelList dataKey="value" position="right" style={{ fill: chartTickFill, fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-xs text-muted">
                Based on {cardioToStrength.sampleCount} gym sessions, split by whether their
                trailing {INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH}-day cardio
                load was above or below your own median — not an absolute threshold, so it always
                compares against what&apos;s actually heavy or light for you.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
