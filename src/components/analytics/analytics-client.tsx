"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ChevronRight } from "lucide-react";
import { ActivityHeatmap } from "@/components/dashboard/activity-heatmap";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { MetricLabel, MetricValue } from "@/components/ui/metric-label";
import { formatIndex, formatPercent } from "@/lib/utils/format";
import { AnalyticsFilters } from "./analytics-filters";
import { PeriodComparison } from "./period-comparison";
import { TrendPanel } from "./trend-panel";
import { MovingAverageChart } from "./moving-average-chart";
import { ProjectionChart } from "./projection-chart";
import { FatigueRecoveryChart } from "./fatigue-recovery-chart";
import { VolumeChart } from "./volume-chart";
import { IntensityDistribution } from "./intensity-distribution";
import { TrainingZonesChart } from "./training-zones-chart";
import { ConsistencyScore } from "./consistency-score";
import { PersonalRecordsTable } from "./personal-records-table";
import { InjuryRiskPanel } from "./injury-risk-panel";
import { AcwrTrendChart } from "./acwr-trend-chart";
import { computeAcwrTrend } from "@/lib/scoring/injury-risk";
import { StoredPredictionsPanel } from "./stored-predictions-panel";
import { FitnessEstimatesPanel } from "./fitness-estimates-panel";
import { UpcomingRacesPanel } from "./upcoming-races-panel";
import { RaceRecordsPanel } from "./race-records-panel";
import { DotsGlPanel } from "./dots-gl-panel";
import { PremiumGate } from "./premium-gate";
import { PremiumTease } from "@/components/premium/premium-tease";
import {
  buildFatigueRecoverySeries,
  buildFitnessEstimates,
  buildHeatmapDays,
  buildHrZoneDistribution,
  buildMovingAverages,
  buildProjections,
  buildRpeDistribution,
  buildSessionTypeDistribution,
  buildTrendSeries,
  buildVolumeByWeek,
  computePeriodMetrics,
  filterActivitiesBySport,
  resolvePeriodPreset,
} from "./utils";
import type {
  AnalyticsPayload,
  PeriodMetrics,
  PeriodPreset,
  ProjectionPoint,
  SportFilter,
  TrendGranularity,
} from "./types";

/** Synthetic placeholder for the free-tier blurred preview — never the user's real data (MASTER-BRIEF.md §6: gate at the API, never compute-and-hide on the client). */
function placeholderPeriodMetrics(label: string): PeriodMetrics {
  return {
    label,
    avgSplit: 612,
    avgEndurance: 588,
    avgStrength: 634,
    avgRecovery: 74,
    avgFatigue: 38,
    totalLoad: 420,
    totalDuration: 14400,
    totalDistance: 42000,
    sessions: 6,
    consistencyPct: 82,
  };
}

const PLACEHOLDER_PROJECTION: ProjectionPoint[] = [
  { date: "W1", split: 560, projected: null, isForecast: false },
  { date: "W2", split: 578, projected: null, isForecast: false },
  { date: "W3", split: 591, projected: null, isForecast: false },
  { date: "W4", split: 604, projected: 604, isForecast: false },
  { date: "W5", split: null, projected: 618, isForecast: true },
  { date: "W6", split: null, projected: 631, isForecast: true },
];

type VolumeTab = "load" | "duration" | "distance";

export function AnalyticsClient({ data }: { data: AnalyticsPayload }) {
  const [sport, setSport] = useState<SportFilter>("all");
  const [granularity, setGranularity] = useState<TrendGranularity>("month");
  const [periodA, setPeriodA] = useState<PeriodPreset>("this_month");
  const [periodB, setPeriodB] = useState<PeriodPreset>("last_month");
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [volumeMetric, setVolumeMetric] = useState<VolumeTab>("load");

  const rangeA = resolvePeriodPreset(periodA);
  const rangeB = resolvePeriodPreset(periodB);

  const filteredActivities = useMemo(
    () => filterActivitiesBySport(data.activities, sport),
    [data.activities, sport]
  );

  const filteredScores = useMemo(() => {
    if (sport === "all") return data.scores;
    const ids = new Set(filteredActivities.map((a) => a.id));
    return data.scores.filter((s) => ids.has(s.activity_id));
  }, [data.scores, filteredActivities, sport]);

  const trendData = useMemo(
    () => buildTrendSeries(data.indexHistory, granularity),
    [data.indexHistory, granularity]
  );

  const fitnessEstimates = useMemo(
    () => buildFitnessEstimates(data.activities, data.predictedBenchmarks),
    [data.activities, data.predictedBenchmarks]
  );

  const movingAvgData = useMemo(
    () => buildMovingAverages(data.indexHistory),
    [data.indexHistory]
  );

  const projectionData = useMemo(
    () => (data.isPremium ? buildProjections(data.indexHistory) : []),
    [data.isPremium, data.indexHistory]
  );

  const fatigueRecoveryData = useMemo(
    () => buildFatigueRecoverySeries(data.indexHistory, data.scores),
    [data.indexHistory, data.scores]
  );

  const volumeData = useMemo(
    () => buildVolumeByWeek(filteredActivities, filteredScores),
    [filteredActivities, filteredScores]
  );

  const sessionTypes = useMemo(
    () => buildSessionTypeDistribution(filteredActivities),
    [filteredActivities]
  );

  const rpeBands = useMemo(
    () => buildRpeDistribution(filteredActivities),
    [filteredActivities]
  );

  const hrZones = useMemo(
    () => buildHrZoneDistribution(filteredActivities, data.maxHr),
    [filteredActivities, data.maxHr]
  );

  const usesHr =
    filteredActivities.some((a) => a.avg_heart_rate != null) && data.maxHr != null;

  const heatmapDays = useMemo(
    () => buildHeatmapDays(filteredActivities, filteredScores, data.timezone),
    [filteredActivities, filteredScores, data.timezone]
  );

  const acwrTrend = useMemo(
    () =>
      computeAcwrTrend(
        data.scores.map((s) => ({ load_score: s.load_score, created_at: s.created_at }))
      ),
    [data.scores]
  );

  const periodMetricsA = useMemo(
    () =>
      data.isPremium
        ? computePeriodMetrics(
            rangeA,
            data.indexHistory,
            filteredActivities,
            filteredScores,
            data.targetSessionsPerWeek
          )
        : placeholderPeriodMetrics(rangeA.label),
    [
      data.isPremium,
      rangeA,
      data.indexHistory,
      filteredActivities,
      filteredScores,
      data.targetSessionsPerWeek,
    ]
  );

  const periodMetricsB = useMemo(
    () =>
      data.isPremium
        ? computePeriodMetrics(
            rangeB,
            data.indexHistory,
            filteredActivities,
            filteredScores,
            data.targetSessionsPerWeek
          )
        : placeholderPeriodMetrics(rangeB.label),
    [
      data.isPremium,
      rangeB,
      data.indexHistory,
      filteredActivities,
      filteredScores,
      data.targetSessionsPerWeek,
    ]
  );

  const latest = data.indexHistory[data.indexHistory.length - 1];
  const summaryStats = [
    {
      label: "Split Index",
      value: latest ? formatIndex(latest.split_index) : "—",
      color: "text-accent",
      href: "#trends",
    },
    {
      label: "Recovery",
      value: latest ? formatPercent(latest.recovery_score) : "—",
      color: "text-success",
      href: "#recovery",
    },
    {
      label: "Fatigue",
      value: latest ? formatPercent(latest.fatigue_score) : "—",
      color: "text-warning",
      href: "#recovery",
    },
    {
      label: "Sessions",
      value: String(filteredActivities.length),
      color: "text-foreground",
      href: "#consistency",
    },
  ];

  const reducedMotion = useReducedMotion();
  const spring = { type: "spring" as const, stiffness: 400, damping: 30 };

  const yearlyLocked = !data.isPremium && granularity === "year";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Performance"
        title="Analytics"
        subtitle="Deep performance insights · hybrid athlete intelligence"
        action={
          !data.isPremium ? (
            <p className="text-xs text-muted">
              Premium unlocks comparisons, projections & full history
            </p>
          ) : undefined
        }
      />

      <AnalyticsFilters
        sport={sport}
        onSportChange={setSport}
        granularity={granularity}
        onGranularityChange={setGranularity}
        periodA={periodA}
        onPeriodAChange={setPeriodA}
        periodB={periodB}
        onPeriodBChange={setPeriodB}
        compareEnabled={compareEnabled}
        onCompareToggle={setCompareEnabled}
        periodALabel={rangeA.label}
        periodBLabel={rangeB.label}
      />

      {/* grid-cols-2 from the smallest screen up, not from sm: — with no base
          column count these four stat cards stacked into 396px of a 620px
          phone window and pushed the stored-predictions panel, the most
          actionable thing on this tab, entirely under the bottom nav. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {summaryStats.map((stat, i) => (
          <motion.a
            key={stat.label}
            href={stat.href}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
            className="block"
          >
            <Card padding="sm" glow={i === 0 ? "accent" : "none"} interactive className="cursor-pointer">
              <div className="flex items-center justify-between">
                <MetricLabel>{stat.label}</MetricLabel>
                <ChevronRight className="h-3 w-3 text-muted/50" />
              </div>
              <MetricValue size="md" className={`mt-1.5 ${stat.color}`}>
                {stat.value}
              </MetricValue>
            </Card>
          </motion.a>
        ))}
      </div>

      {/* Reprioritized above every graph on this page (user feedback:
          "reprioritize analytics tab — surface 1RM/race predictions above
          graphs"). Race ladder + per-lift adaptive 1RM predictions are the
          most directly actionable numbers on this tab — what to expect on
          race day, what you could lift next — so they lead, ahead of the
          ACWR trend chart and every other visualization below. Full-width
          rather than paired in a 2-col grid with the (much shorter)
          Recovery panel: that left a large empty gap under the shorter
          card when they shared equal-width columns (earlier user
          feedback). */}
      <StoredPredictionsPanel
        benchmarks={data.predictedBenchmarks}
        strengthEstimates={data.strengthEstimates}
        isPremium={data.isPremium}
      />

      {/* User feedback: "what other data can I add in that we don't
          already have, e.g. can you compute a lactate threshold or
          additional features which Garmin has." Sits alongside the other
          prediction panels, above every graph — same reasoning as
          StoredPredictionsPanel above. Self-hides when neither estimate
          has enough data yet, rather than showing two empty states. */}
      <FitnessEstimatesPanel
        lactateThreshold={fitnessEstimates.lactateThreshold}
        vo2max={fitnessEstimates.vo2max}
      />

      {/* User feedback: "why is IPF GL and DOTS scores not there as well as
          current race records" — real logged bests (not projections), so
          they sit right after the two prediction panels above rather than
          being folded into either. Not premium-gated on the records side
          (matches Personal Records below); DOTS/GL keeps the same premium
          gate as the Lab page's own card. */}
      <div className="grid gap-5 lg:grid-cols-2">
        <RaceRecordsPanel records={data.raceRecords} />
        <DotsGlPanel result={data.overallDotsGl} hasAccess={data.showDotsGl} />
      </div>

      {/* User feedback: "would it be possible to have a section where
          people can enter the run event they are doing... and Split Index
          would be able to give advice on the terrain, the elevation and
          the weather on the day to give more specifically tailored race
          predictions" — with a concrete example: predicted 39:00 for a
          10K, actually ran 40:33, attributed to heat/wind on a flat
          course. Self-contained client component (own fetch/CRUD), not
          server-fetched data like the panels above — it manages its own
          add/delete flow. */}
      <UpcomingRacesPanel />

      <div id="recovery" className="scroll-mt-6">
        <InjuryRiskPanel
          scores={data.scores}
          isPremium={data.isPremium}
          hrvToday={data.hrvToday}
          hrvBaseline={data.hrvBaseline}
        />
      </div>

      <PremiumGate locked={!data.isPremium} feature="ACWR trend analysis">
        <AcwrTrendChart data={acwrTrend} />
      </PremiumGate>

      {compareEnabled && (
        data.isPremium ? (
          <PeriodComparison periodA={periodMetricsA} periodB={periodMetricsB} />
        ) : (
          <PremiumTease
            title="Period-over-period comparison"
            subtitle={`${rangeA.label} vs ${rangeB.label} — unlock session volume, index delta, and consistency comparisons.`}
          >
            <PeriodComparison periodA={periodMetricsA} periodB={periodMetricsB} />
          </PremiumTease>
        )
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <div id="trends" className="scroll-mt-6">
          <PremiumGate locked={yearlyLocked} feature="Yearly trend analysis">
            <TrendPanel data={trendData} granularity={granularity} />
          </PremiumGate>
        </div>
        <div id="consistency" className="scroll-mt-6">
          <ConsistencyScore
            activities={filteredActivities}
            heatmapDays={heatmapDays}
            targetSessionsPerWeek={data.targetSessionsPerWeek}
          />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PremiumGate locked={!data.isPremium} feature="Moving average analysis">
          <MovingAverageChart data={movingAvgData} />
        </PremiumGate>
        {data.isPremium ? (
          <ProjectionChart data={projectionData} />
        ) : (
          <PremiumTease
            title="Index projections"
            subtitle="7-day and 30-day forecasts from your training trend — Premium unlocks full projection charts."
          >
            <ProjectionChart data={PLACEHOLDER_PROJECTION} />
          </PremiumTease>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <FatigueRecoveryChart data={fatigueRecoveryData} />
        <div className="space-y-3">
          <div className="flex w-fit gap-1 rounded-xl border border-white/[0.06] glass p-1">
            {(["load", "duration", "distance"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setVolumeMetric(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium capitalize transition-all duration-200 ${
                  volumeMetric === m
                    ? "bg-accent text-accent-foreground shadow-md shadow-accent/25"
                    : "text-muted hover:bg-white/[0.04] hover:text-foreground"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <VolumeChart data={volumeData} metric={volumeMetric} />
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <IntensityDistribution sessionTypes={sessionTypes} rpeBands={rpeBands} />
        <TrainingZonesChart zones={hrZones} usesHr={usesHr} />
      </div>

      <ActivityHeatmap days={heatmapDays} weeks={16} />

      <PersonalRecordsTable records={data.personalRecords} />
    </div>
  );
}
