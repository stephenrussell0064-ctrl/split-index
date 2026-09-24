"use client";

import { ChartFigure } from "@/components/analytics/chart-figure";
import type { DayBucketStat } from "@/lib/scoring/interference";
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
import { Dumbbell, HeartPulse, ClipboardList, GitCompare, Lightbulb, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { CollapsibleSection } from "@/components/ui/collapsible-section";
import { chartGridStroke, chartTickFill, chartTooltipStyle, chartTooltipLabelStyle, chartTooltipItemStyle } from "@/components/analytics/charts";
import { ShareImageButton } from "@/components/analytics/share-image-button";
import { cn } from "@/lib/utils/cn";
import { designTokens } from "@/lib/design/tokens";
import {
  INTERFERENCE_CONFIG,
  hasShareableFinding,
  pickHeadlineBucket,
} from "@/lib/scoring/interference";
import type { InterferenceReport } from "@/lib/scoring/interference";
import {
  bucketTone,
  cardioToStrengthVerdict,
  strengthToCardioVerdict,
  type DirectionVerdict,
  type InterferenceVerdict,
} from "@/lib/scoring/interference-advice";

const GOOD_COLOR = designTokens.strengthAccent; // no measurable cost
const BAD_COLOR = "#ef4444"; // measurable cost

/*
 * THE PAGE, REBUILT AROUND A VERDICT.
 *
 * User feedback, after two rounds of adding explanation: "the interference
 * screen is still too difficult to comprehend and is not very visually
 * appealing, please rework and make the data clearer". The numbers were
 * right and the sentences were accurate. What the page never did was DECIDE
 * anything: it showed −4% and a bar chart and left the reader to work out
 * whether that mattered and what to do.
 *
 * So each direction is now one card that leads with a verdict — No cost /
 * Small cost / Real cost / Helps / Still learning — then the number, then one
 * plain sentence, then one line of advice. The chart is replaced as the main
 * visual by something that needs no axis: a row of day chips for "how long
 * the effect lasts", and two bars for "light week vs heavy week". The recharts
 * figures still exist, one tap away under "See the detailed charts", for the
 * reader who wants them. The verdict rules live in interference-advice.ts and
 * are tested there.
 */

const VERDICT_STYLE: Record<
  InterferenceVerdict,
  { pill: string; number: string; chip: string; dot: string }
> = {
  learning: {
    pill: "bg-white/[0.06] text-muted",
    number: "text-muted",
    chip: "border-white/[0.08] bg-white/[0.03] text-muted",
    dot: "bg-white/25",
  },
  none: {
    pill: "bg-success/15 text-success",
    number: "text-success",
    chip: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  helps: {
    pill: "bg-success/15 text-success",
    number: "text-success",
    chip: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  small: {
    pill: "bg-warning/15 text-warning",
    number: "text-warning",
    chip: "border-warning/30 bg-warning/10 text-warning",
    dot: "bg-warning",
  },
  real: {
    pill: "bg-danger/15 text-danger",
    number: "text-danger",
    chip: "border-danger/30 bg-danger/10 text-danger",
    dot: "bg-danger",
  },
};

/** Small visual flag next to a finding built from below-target sample size — the summary text already spells out the caveat in full; this is just the at-a-glance version. */
function EarlyDataBadge() {
  return (
    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-warning">
      Early data
    </span>
  );
}

function dayLabel(d: number): string {
  if (d === 0) return "That day";
  if (d === 1) return "Next day";
  return `${d} days later`;
}

function signed(pct: number): string {
  return `${pct > 0 ? "+" : ""}${pct}%`;
}

/**
 * The one number that actually answers the question, in the same visual
 * language as a Split Index score — big, colored, unmissable — instead of
 * making the reader parse a bar chart's axis to find it themselves (user
 * feedback: "very difficult to read and visualise").
 */
/** Exported so InterferenceRadarCard (the dashboard's compact version of this page) can render the exact same headline-stat treatment for the exact same data — user feedback: "Interference radar on dashboard still showing as no data, please fix this so it shows the same as the interference tab." The card was using a plain text sentence with no visual weight for every state; this is the shared piece that fixes that. */
/**
 * `metricLabel` names what the percentage IS a change in (e.g. "cardio
 * efficiency", "strength score") — always rendered directly under the
 * number, not left to the prose sentence next to it. User feedback: "What
 * does the +0.5% on the interference tab mean, this needs a unit or
 * explanation." The number was already a percent (the % sign is right
 * there), but percent-of-what only showed up in the generated sentence for
 * the "found a real effect" branch — the much more common "no measurable
 * interference" branch never named the underlying metric at all, so a small
 * delta like +0.5% read as a bare, unexplained number.
 */
export function HeadlineStat({
  deltaPct,
  sentence,
  metricLabel,
}: {
  deltaPct: number | null;
  sentence: string;
  metricLabel: string;
}) {
  const isCost = deltaPct !== null && deltaPct < -3;
  const color = deltaPct === null ? "text-muted" : isCost ? "text-danger" : "text-strength-accent";

  return (
    <div className="mb-5 flex items-center gap-4">
      {deltaPct !== null && (
        <div className="shrink-0 text-center">
          <p className={cn("index-display text-4xl font-bold tabular-nums", color)}>
            {deltaPct > 0 ? "+" : ""}
            {deltaPct}%
          </p>
          <p className="micro-label mt-0.5 text-muted/70">{metricLabel}</p>
        </div>
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
/** Exported for InterferenceRadarCard — see HeadlineStat's own doc comment for why. `compact` drops the tall min-height/padding meant for a full page down to something that fits a dashboard card holding two of these at once. */
export function SessionsProgress({
  current,
  target,
  message,
  compact = false,
}: {
  current: number;
  target: number;
  message: string;
  compact?: boolean;
}) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl text-center",
        compact ? "px-2 py-3" : "min-h-[200px] px-6 py-8 gap-4"
      )}
    >
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

/** How sure we are, as dots: one per session up to the minimum the engine wants, so "2 of 3" is visible without reading. */
function ConfidenceDots({ count, target, verdict }: { count: number; target: number; verdict: InterferenceVerdict }) {
  const total = Math.max(target, Math.min(count, target));
  return (
    <span className="inline-flex items-center gap-1" aria-hidden>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={cn("h-1.5 w-1.5 rounded-full", i < count ? VERDICT_STYLE[verdict].dot : "bg-white/15")}
        />
      ))}
    </span>
  );
}

/**
 * One direction, one card. The order inside is the order a person needs the
 * information in: what was found (pill), how big (number), what it means
 * (sentence), what to do (advice), how sure (sessions), then the visual.
 */
function VerdictCard({
  icon,
  question,
  metricLabel,
  verdict,
  children,
}: {
  icon: React.ReactNode;
  question: string;
  metricLabel: string;
  verdict: DirectionVerdict;
  children?: React.ReactNode;
}) {
  const style = VERDICT_STYLE[verdict.verdict];
  const learning = verdict.verdict === "learning";

  return (
    <Card className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {question}
        </h2>
        <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider", style.pill)}>
          {verdict.label}
        </span>
      </div>

      <div className="flex items-start gap-4">
        <div className="shrink-0 text-center">
          <p className={cn("index-display text-4xl font-bold tabular-nums", style.number)}>
            {verdict.deltaPct === null ? "—" : signed(verdict.deltaPct)}
          </p>
          <p className="micro-label mt-1 text-muted/70">{metricLabel}</p>
        </div>
        <p className="text-sm leading-snug text-foreground/90">{verdict.sentence}</p>
      </div>

      <div
        className={cn(
          "mt-4 rounded-xl border p-3",
          learning ? "border-white/[0.08] bg-white/[0.03]" : "border-accent/20 bg-accent/[0.06]"
        )}
      >
        <p className="micro-label mb-1 flex items-center gap-1.5 text-accent">
          <Lightbulb className="h-3 w-3" aria-hidden />
          {learning ? "To unlock this" : "What to do"}
        </p>
        <p className="text-xs leading-relaxed text-foreground/90">{verdict.advice}</p>
      </div>

      <p className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <ConfidenceDots count={verdict.sampleCount} target={verdict.minSamples} verdict={verdict.verdict} />
        <span>
          Based on {verdict.sampleCount} session{verdict.sampleCount === 1 ? "" : "s"}
          {verdict.sampleCount < verdict.minSamples && ` · ${verdict.minSamples} needed for a firm answer`}
        </span>
        {verdict.lowConfidence && <EarlyDataBadge />}
      </p>

      {children && <CardContent className="mt-4 border-t border-white/[0.06] pt-4">{children}</CardContent>}
    </Card>
  );
}

/**
 * How long the effect lasts, as four chips — one per day after lifting.
 * Colour says the verdict for that day, the number says the size, the small
 * line says how many sessions it rests on. No axis to read.
 */
function DayTimeline({ decayByDay, sport }: { decayByDay: DayBucketStat[]; sport: string }) {
  return (
    <div>
      <p className="mb-2 text-xs text-muted">
        How your {sport} efficiency compares with a fully rested day, by days since your last gym
        session:
      </p>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {decayByDay.map((bucket) => {
          const tone = bucketTone(bucket);
          const style = tone === "empty" ? VERDICT_STYLE.learning : VERDICT_STYLE[tone];
          return (
            <li
              key={bucket.daysSinceStrength}
              className={cn("rounded-xl border px-3 py-2.5 text-center", style.chip)}
            >
              <p className="text-[11px] font-medium uppercase tracking-wider opacity-80">
                {dayLabel(bucket.daysSinceStrength)}
              </p>
              <p className="index-display mt-1 text-xl font-bold tabular-nums">
                {tone === "empty" ? "—" : signed(bucket.efDeltaPct!)}
              </p>
              <p className="mt-0.5 text-[11px] opacity-80">
                {bucket.sampleCount === 0
                  ? "no sessions"
                  : `${bucket.sampleCount} session${bucket.sampleCount === 1 ? "" : "s"}`}
              </p>
            </li>
          );
        })}
      </ol>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-success" aria-hidden />no cost</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-warning" aria-hidden />small cost</span>
        <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-danger" aria-hidden />real cost</span>
        <span>0% = a normal rested day</span>
      </p>
    </div>
  );
}

/** Two bars: strength score after a lighter cardio week against after a heavier one. Width says the comparison; the numbers say it too. */
function WeekComparison({
  lighter,
  heavier,
  deltaPct,
}: {
  lighter: number;
  heavier: number;
  deltaPct: number;
}) {
  const max = Math.max(lighter, heavier, 1);
  const tone = VERDICT_STYLE[deltaPct <= -8 ? "real" : deltaPct <= -3 ? "small" : "none"];
  const rows = [
    { label: "After a lighter cardio week", value: lighter, className: "bg-cardio-accent" },
    { label: "After a heavier cardio week", value: heavier, className: tone.dot },
  ];
  return (
    <div>
      <p className="mb-2 text-xs text-muted">
        Your average strength score in gym sessions, split by how much cardio you did in the{" "}
        {INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH} days before:
      </p>
      <ul className="space-y-2.5">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-muted">{row.label}</span>
              <span className="font-semibold tabular-nums">{Math.round(row.value)}</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/[0.06]" aria-hidden>
              <div
                className={cn("h-full rounded-full", row.className)}
                style={{ width: `${Math.round((row.value / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function InterferenceDetail({ report }: { report: InterferenceReport }) {
  const { strengthToCardio, cardioToStrength } = report;
  const hasRealFinding = hasShareableFinding(report);
  const headlineBucket = pickHeadlineBucket(strengthToCardio.decayByDay);
  const populatedBuckets = strengthToCardio.decayByDay.filter((d) => d.sampleCount > 0);
  const s2c = strengthToCardioVerdict(strengthToCardio);
  const c2s = cardioToStrengthVerdict(cardioToStrength);
  const sport = (strengthToCardio.primarySport ?? "cardio").replace(/_/g, " ");

  const hasS2cChart =
    (strengthToCardio.calibrating && strengthToCardio.weeklyFallback !== null) ||
    (!strengthToCardio.calibrating && populatedBuckets.length > 1);
  const hasC2sChart = !cardioToStrength.calibrating;

  return (
    <div className="space-y-4">
      {/* One sentence on what the page is, and the mechanism one tap away. */}
      <Card padding="sm" className="border border-accent/15 bg-accent/[0.03]">
        <p className="text-sm leading-relaxed text-foreground/90">
          A hard leg day can make tomorrow&apos;s run feel harder than it should, and a big running
          week can blunt next week&apos;s lifts. This page checks whether that is actually happening
          to <span className="font-medium text-foreground">you</span>, from your own logged sessions.
        </p>
        <CollapsibleSection
          title="How this is worked out"
          className="mt-3 border-accent/10 bg-transparent"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex items-start gap-2.5">
              <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <p className="text-xs leading-snug text-muted">
                <span className="font-medium text-foreground/90">1. You log</span> both gym and
                cardio sessions, same as always. Easy, recovery and long cardio sessions with a
                heart rate are the ones that count — a deliberately slow effort is the only fair
                comparison.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <GitCompare className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <p className="text-xs leading-snug text-muted">
                <span className="font-medium text-foreground/90">2. We compare</span> how
                efficiently you moved (pace for the heart rate it took) in the days after a gym
                session against days when you were fully rested — and your lifting after heavy
                cardio weeks against after light ones.
              </p>
            </div>
            <div className="flex items-start gap-2.5">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden />
              <p className="text-xs leading-snug text-muted">
                <span className="font-medium text-foreground/90">3. You get a verdict</span> in
                each direction — no cost, a small one, or a real one — and one line on what to
                change. Under 3% is treated as no cost; 8% or more as worth planning around.
              </p>
            </div>
          </div>
        </CollapsibleSection>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <VerdictCard
          icon={<Dumbbell className="h-4 w-4 text-strength-accent" aria-hidden />}
          question="Does lifting slow your cardio?"
          metricLabel={`${sport} efficiency`}
          verdict={s2c}
        >
          {strengthToCardio.calibrating ? (
            strengthToCardio.weeklyFallback ? (
              <p className="text-xs text-muted">
                Still gathering day-by-day pairs ({strengthToCardio.sampleCount}/
                {strengthToCardio.minSamples}). This is a week-by-week comparison in the meantime:
                {" "}{strengthToCardio.weeklyFallback.sampleCountWithStrength} session
                {strengthToCardio.weeklyFallback.sampleCountWithStrength === 1 ? "" : "s"} in weeks
                with lifting against {strengthToCardio.weeklyFallback.sampleCountWithoutStrength} in
                weeks without.
              </p>
            ) : (
              <SessionsProgress
                current={strengthToCardio.sampleCount}
                target={strengthToCardio.minSamples}
                message={strengthToCardio.summary}
                compact
              />
            )
          ) : (
            <DayTimeline decayByDay={strengthToCardio.decayByDay} sport={sport} />
          )}
        </VerdictCard>

        <VerdictCard
          icon={<HeartPulse className="h-4 w-4 text-cardio-accent" aria-hidden />}
          question="Does cardio weaken your lifting?"
          metricLabel="strength score"
          verdict={c2s}
        >
          {cardioToStrength.calibrating ||
          cardioToStrength.lowCardioAvgStrengthComponent === null ||
          cardioToStrength.highCardioAvgStrengthComponent === null ||
          cardioToStrength.deltaPct === null ? (
            <SessionsProgress
              current={cardioToStrength.sampleCount}
              target={cardioToStrength.minSamples}
              message={cardioToStrength.summary}
              compact
            />
          ) : (
            <WeekComparison
              lighter={cardioToStrength.lowCardioAvgStrengthComponent}
              heavier={cardioToStrength.highCardioAvgStrengthComponent}
              deltaPct={cardioToStrength.deltaPct}
            />
          )}
        </VerdictCard>
      </div>

      {hasRealFinding && (
        <div className="flex justify-end">
          <ShareImageButton
            href="/api/interference/report-card"
            filename="interference-report.png"
            shareTitle="My Split Index Interference Report"
            shareText="Here's what leg day does to my running — tracked with Split Index."
            label="Share as image"
            contentSummary="Your display name, and how your strength and cardio training affect each other. No scores, dates or individual sessions."
          />
        </div>
      )}

      {/* The charts, for whoever wants them. Closed by default: they were
          the thing people found hard to read, and the cards above now carry
          every number they showed. */}
      {(hasS2cChart || hasC2sChart) && (
        <CollapsibleSection
          title="See the detailed charts"
          description="The same findings drawn as charts, with the underlying figures."
        >
          <div className="space-y-6">
            {strengthToCardio.calibrating && strengthToCardio.weeklyFallback && (
              <ChartFigure
                label="Cardio efficiency: weeks with a strength session against weeks without"
                summary={`Average cardio efficiency was ${strengthToCardio.weeklyFallback.weeksWithoutStrengthAvgEF} in weeks without a strength session, and ${strengthToCardio.weeklyFallback.weeksWithStrengthAvgEF} in weeks with one.`}
                columns={[
                  { header: "Week type", cell: (d: { label: string; value: number }) => d.label },
                  { header: "Average efficiency", cell: (d: { label: string; value: number }) => String(d.value) },
                ]}
                rows={[
                  { label: "Normal week", value: strengthToCardio.weeklyFallback.weeksWithoutStrengthAvgEF },
                  { label: "Strength-training week", value: strengthToCardio.weeklyFallback.weeksWithStrengthAvgEF },
                ]}
              >
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    // Ticks shortened, full wording kept in `rows` and the summary: a tick label is a key, not a sentence.
                    data={[
                      { label: "Without lifting", value: strengthToCardio.weeklyFallback.weeksWithoutStrengthAvgEF },
                      { label: "With lifting", value: strengthToCardio.weeklyFallback.weeksWithStrengthAvgEF },
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
                      width={82}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value) => [value, "How efficiently you ran"]}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={designTokens.strengthAccent}>
                      <LabelList dataKey="value" position="right" style={{ fill: chartTickFill, fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartFigure>
            )}

            {!strengthToCardio.calibrating && populatedBuckets.length > 1 && (
              <ChartFigure
                label="Cardio efficiency by days since the last strength session"
                summary={`Change in cardio efficiency grouped by how long since the last strength session, across ${populatedBuckets.length} groups: ${populatedBuckets
                  .map((b) => `${b.daysSinceStrength} ${b.daysSinceStrength === 1 ? "day" : "days"} after, ${b.efDeltaPct === null ? "no reading" : signed(b.efDeltaPct)}`)
                  .join("; ")}.`}
                columns={[
                  { header: "Days since strength", cell: (b: DayBucketStat) => String(b.daysSinceStrength) },
                  { header: "Efficiency change", cell: (b: DayBucketStat) => (b.efDeltaPct === null ? "no reading" : signed(b.efDeltaPct)) },
                  { header: "Sessions", cell: (b: DayBucketStat) => String(b.sampleCount) },
                ]}
                rows={populatedBuckets}
              >
                <p className="mb-1.5 text-[11px] text-muted">0% = your normal rested pace</p>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={populatedBuckets} margin={{ top: 20, right: 4, left: -8, bottom: 0 }}>
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
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value) => [`${value}%`, "vs. your normal rested pace"]}
                      labelFormatter={(v) => dayLabel(Number(v))}
                    />
                    <Bar dataKey="efDeltaPct" radius={[4, 4, 4, 4]}>
                      <LabelList
                        dataKey="efDeltaPct"
                        position="top"
                        formatter={(v) => signed(Number(v))}
                        style={{ fontSize: 10, fill: chartTickFill }}
                      />
                      {populatedBuckets.map((d) => (
                        <Cell
                          key={d.daysSinceStrength}
                          fill={d.efDeltaPct !== null && d.efDeltaPct < -3 ? BAD_COLOR : GOOD_COLOR}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-xs text-muted">
                  Based on {strengthToCardio.sampleCount} {sport} session
                  {strengthToCardio.sampleCount === 1 ? "" : "s"} tagged easy, recovery or long, with
                  {headlineBucket ? ` the headline taken from "${dayLabel(headlineBucket.daysSinceStrength).toLowerCase()}".` : "."}
                </p>
              </ChartFigure>
            )}

            {hasC2sChart && (
              <ChartFigure
                label="Strength score: lighter cardio weeks against heavy cardio weeks"
                summary={`Average strength score was ${cardioToStrength.lowCardioAvgStrengthComponent} in lighter cardio weeks, and ${cardioToStrength.highCardioAvgStrengthComponent} in heavy cardio weeks.`}
                columns={[
                  { header: "Week type", cell: (d: { label: string; value: number | null }) => d.label },
                  {
                    header: "Average strength score",
                    cell: (d: { label: string; value: number | null }) =>
                      d.value === null ? "no reading" : String(d.value),
                  },
                ]}
                rows={[
                  { label: "Lighter cardio week", value: cardioToStrength.lowCardioAvgStrengthComponent },
                  { label: "Heavy cardio week", value: cardioToStrength.highCardioAvgStrengthComponent },
                ]}
              >
                <ResponsiveContainer width="100%" height={140}>
                  <BarChart
                    data={[
                      { label: "Lighter cardio", value: cardioToStrength.lowCardioAvgStrengthComponent },
                      { label: "Heavy cardio", value: cardioToStrength.highCardioAvgStrengthComponent },
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
                      width={82}
                    />
                    <Tooltip
                      contentStyle={chartTooltipStyle}
                      labelStyle={chartTooltipLabelStyle}
                      itemStyle={chartTooltipItemStyle}
                      formatter={(value) => [value, "Strength score"]}
                    />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={designTokens.cardioAccent}>
                      <LabelList dataKey="value" position="right" style={{ fill: chartTickFill, fontSize: 11 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-xs text-muted">
                  Based on {cardioToStrength.sampleCount} gym sessions, split by whether their trailing{" "}
                  {INTERFERENCE_CONFIG.LOOKBACK_DAYS_CARDIO_EFFECT_ON_STRENGTH}-day cardio load was above
                  or below your own median — so &quot;heavy&quot; always means heavy for you.
                </p>
              </ChartFigure>
            )}
          </div>
        </CollapsibleSection>
      )}

      <p className="flex items-center gap-1.5 text-xs text-muted">
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
        The Hybrid Plan schedules around whatever is found here.
      </p>
    </div>
  );
}
