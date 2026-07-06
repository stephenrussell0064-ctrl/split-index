"use client";

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
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
import { PremiumGate } from "./premium-gate";
import { PremiumTease } from "@/components/premium/premium-tease";
import {
  buildFatigueRecoverySeries,
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
  PeriodPreset,
  SportFilter,
  TrendGranularity,
} from "./types";

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

  const movingAvgData = useMemo(
    () => buildMovingAverages(data.indexHistory),
    [data.indexHistory]
  );

  const projectionData = useMemo(
    () => buildProjections(data.indexHistory),
    [data.indexHistory]
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
    () => buildHeatmapDays(filteredActivities, filteredScores),
    [filteredActivities, filteredScores]
  );

  const periodMetricsA = useMemo(
    () =>
      computePeriodMetrics(
        rangeA,
        data.indexHistory,
        filteredActivities,
        filteredScores,
        data.targetSessionsPerWeek
      ),
    [
      rangeA,
      data.indexHistory,
      filteredActivities,
      filteredScores,
      data.targetSessionsPerWeek,
    ]
  );

  const periodMetricsB = useMemo(
    () =>
      computePeriodMetrics(
        rangeB,
        data.indexHistory,
        filteredActivities,
        filteredScores,
        data.targetSessionsPerWeek
      ),
    [
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
    },
    {
      label: "Recovery",
      value: latest ? formatPercent(latest.recovery_score) : "—",
      color: "text-success",
    },
    {
      label: "Fatigue",
      value: latest ? formatPercent(latest.fatigue_score) : "—",
      color: "text-warning",
    },
    {
      label: "Sessions",
      value: String(filteredActivities.length),
      color: "text-foreground",
    },
  ];

  const reducedMotion = useReducedMotion();
  const spring = { type: "spring" as const, stiffness: 400, damping: 30 };

  const yearlyLocked = !data.isPremium && granularity === "year";
  const forecastPoint = projectionData.find((d) => d.isForecast && d.projected != null);
  const periodDelta =
    periodMetricsA.avgSplit != null && periodMetricsB.avgSplit != null
      ? periodMetricsA.avgSplit - periodMetricsB.avgSplit
      : null;

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

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {summaryStats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: i * 0.05 }}
          >
            <Card padding="sm" glow={i === 0 ? "accent" : "none"} interactive>
              <MetricLabel>{stat.label}</MetricLabel>
              <MetricValue size="md" className={`mt-1.5 ${stat.color}`}>
                {stat.value}
              </MetricValue>
            </Card>
          </motion.div>
        ))}
      </div>

      {compareEnabled && (
        data.isPremium ? (
          <PeriodComparison periodA={periodMetricsA} periodB={periodMetricsB} />
        ) : (
          <PremiumTease
            title={
              periodDelta !== null
                ? `Split Index ${periodDelta >= 0 ? "+" : ""}${Math.round(periodDelta)} pts vs prior period`
                : "Period-over-period comparison"
            }
            subtitle={`${rangeA.label} vs ${rangeB.label} — unlock session volume, index delta, and consistency comparisons.`}
          >
            <PeriodComparison periodA={periodMetricsA} periodB={periodMetricsB} />
          </PremiumTease>
        )
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <PremiumGate locked={yearlyLocked} feature="Yearly trend analysis">
          <TrendPanel data={trendData} granularity={granularity} />
        </PremiumGate>
        <ConsistencyScore
          activities={filteredActivities}
          heatmapDays={heatmapDays}
          targetSessionsPerWeek={data.targetSessionsPerWeek}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <PremiumGate locked={!data.isPremium} feature="Moving average analysis">
          <MovingAverageChart data={movingAvgData} />
        </PremiumGate>
        {data.isPremium ? (
          <ProjectionChart data={projectionData} />
        ) : (
          <PremiumTease
            title={
              forecastPoint?.projected != null
                ? `Projected Split Index: ${formatIndex(forecastPoint.projected)}`
                : "Index projections"
            }
            subtitle="7-day and 30-day forecasts from your training trend — Premium unlocks full projection charts."
          >
            <ProjectionChart data={projectionData} />
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
                    ? "bg-accent text-white shadow-md shadow-accent/25"
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
