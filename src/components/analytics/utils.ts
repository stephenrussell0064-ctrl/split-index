import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  startOfYear,
  endOfYear,
  subWeeks,
  subMonths,
  subYears,
  format,
  isWithinInterval,
  eachWeekOfInterval,
  differenceInCalendarDays,
} from "date-fns";
import type {
  AnalyticsActivity,
  AnalyticsScore,
  DateRange,
  DistributionSlice,
  FatigueRecoveryPoint,
  HeatmapDay,
  MovingAveragePoint,
  PeriodMetrics,
  PeriodPreset,
  ProjectionPoint,
  SportFilter,
  TrendGranularity,
  TrendPoint,
  VolumeWeek,
} from "./types";
import type { SplitIndexSnapshot } from "@/types";

const DAY_MS = 86400000;

export function localDateKey(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, "0")}-${`${d.getDate()}`.padStart(2, "0")}`;
}

export function resolvePeriodPreset(preset: PeriodPreset, custom?: DateRange): DateRange {
  const now = new Date();
  switch (preset) {
    case "this_week":
      return {
        start: startOfWeek(now, { weekStartsOn: 1 }),
        end: endOfWeek(now, { weekStartsOn: 1 }),
        label: "This week",
      };
    case "last_week": {
      const ref = subWeeks(now, 1);
      return {
        start: startOfWeek(ref, { weekStartsOn: 1 }),
        end: endOfWeek(ref, { weekStartsOn: 1 }),
        label: "Last week",
      };
    }
    case "this_month":
      return { start: startOfMonth(now), end: endOfMonth(now), label: "This month" };
    case "last_month": {
      const ref = subMonths(now, 1);
      return {
        start: startOfMonth(ref),
        end: endOfMonth(ref),
        label: "Last month",
      };
    }
    case "this_year":
      return { start: startOfYear(now), end: endOfYear(now), label: "This year" };
    case "last_year": {
      const ref = subYears(now, 1);
      return {
        start: startOfYear(ref),
        end: endOfYear(ref),
        label: "Last year",
      };
    }
    case "custom":
      return custom ?? resolvePeriodPreset("this_month");
  }
}

export function filterActivitiesBySport(
  activities: AnalyticsActivity[],
  sport: SportFilter
): AnalyticsActivity[] {
  if (sport === "all") return activities;
  return activities.filter((a) => a.sport === sport);
}

export function filterByDateRange<T extends { started_at?: string; recorded_at?: string }>(
  items: T[],
  range: DateRange,
  dateKey: "started_at" | "recorded_at" = "started_at"
): T[] {
  return items.filter((item) => {
    const raw = item[dateKey];
    if (!raw) return false;
    const d = new Date(raw);
    return isWithinInterval(d, { start: range.start, end: range.end });
  });
}

function rollingMean(values: number[], window: number, index: number): number | null {
  if (index < window - 1) return null;
  const slice = values.slice(index - window + 1, index + 1);
  return Math.round(slice.reduce((a, b) => a + b, 0) / slice.length);
}

export function buildTrendSeries(
  history: SplitIndexSnapshot[],
  granularity: TrendGranularity
): TrendPoint[] {
  if (history.length === 0) return [];

  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  if (granularity === "week") {
    return sorted.map((h) => ({
      date: format(new Date(h.recorded_at), "EEE"),
      split: h.split_index,
      endurance: h.endurance_index,
      strength: h.strength_index,
    }));
  }

  if (granularity === "month") {
    const byWeek = new Map<string, SplitIndexSnapshot[]>();
    for (const h of sorted) {
      const wk = format(startOfWeek(new Date(h.recorded_at), { weekStartsOn: 1 }), "MMM d");
      const bucket = byWeek.get(wk) ?? [];
      bucket.push(h);
      byWeek.set(wk, bucket);
    }
    return Array.from(byWeek, ([week, snaps]) => {
      const last = snaps[snaps.length - 1];
      return {
        date: week,
        split: last.split_index,
        endurance: last.endurance_index,
        strength: last.strength_index,
      };
    });
  }

  const byMonth = new Map<string, SplitIndexSnapshot[]>();
  for (const h of sorted) {
    const mk = format(new Date(h.recorded_at), "MMM yy");
    const bucket = byMonth.get(mk) ?? [];
    bucket.push(h);
    byMonth.set(mk, bucket);
  }
  return Array.from(byMonth, ([month, snaps]) => {
    const last = snaps[snaps.length - 1];
    return {
      date: month,
      split: last.split_index,
      endurance: last.endurance_index,
      strength: last.strength_index,
    };
  });
}

export function buildMovingAverages(history: SplitIndexSnapshot[]): MovingAveragePoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const splits = sorted.map((h) => h.split_index);
  const endurance = sorted.map((h) => h.endurance_index);
  const strength = sorted.map((h) => h.strength_index);

  return sorted.map((h, i) => ({
    date: format(new Date(h.recorded_at), "MMM d"),
    split: h.split_index,
    splitMa7: rollingMean(splits, 7, i),
    splitMa28: rollingMean(splits, 28, i),
    enduranceMa7: rollingMean(endurance, 7, i),
    strengthMa7: rollingMean(strength, 7, i),
  }));
}

export function buildProjections(history: SplitIndexSnapshot[]): ProjectionPoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const recent = sorted.slice(-14);
  if (recent.length < 3) return [];

  const points = recent.map((h) => ({
    t: new Date(h.recorded_at).getTime(),
    v: h.split_index,
  }));

  const n = points.length;
  const sumT = points.reduce((s, p) => s + p.t, 0);
  const sumV = points.reduce((s, p) => s + p.v, 0);
  const sumTT = points.reduce((s, p) => s + p.t * p.t, 0);
  const sumTV = points.reduce((s, p) => s + p.t * p.v, 0);
  const denom = n * sumTT - sumT * sumT;
  const slope = denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;
  const intercept = (sumV - slope * sumT) / n;

  const predict = (t: number) =>
    Math.max(0, Math.min(999, Math.round(slope * t + intercept)));

  const historical: ProjectionPoint[] = recent.map((h) => ({
    date: format(new Date(h.recorded_at), "MMM d"),
    split: h.split_index,
    projected: null,
    isForecast: false,
  }));

  const last = recent[recent.length - 1];
  const lastT = new Date(last.recorded_at).getTime();
  const forecastDays = [7, 30];

  const forecasts: ProjectionPoint[] = forecastDays.map((days) => {
    const t = lastT + days * DAY_MS;
    return {
      date: format(new Date(t), "MMM d"),
      split: null,
      projected: predict(t),
      isForecast: true,
    };
  });

  const bridge: ProjectionPoint = {
    date: format(new Date(lastT), "MMM d"),
    split: last.split_index,
    projected: last.split_index,
    isForecast: true,
  };

  return [...historical.slice(0, -1), bridge, ...forecasts];
}

export function buildFatigueRecoverySeries(
  history: SplitIndexSnapshot[],
  scores: AnalyticsScore[]
): FatigueRecoveryPoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  return sorted.map((h) => {
    const day = localDateKey(h.recorded_at);
    const dayStart = new Date(day).getTime();
    const acute = scores
      .filter((s) => {
        const t = new Date(s.created_at).getTime();
        return t >= dayStart - 7 * DAY_MS && t <= dayStart;
      })
      .reduce((sum, s) => sum + s.load_score, 0);
    const chronic =
      scores
        .filter((s) => {
          const t = new Date(s.created_at).getTime();
          return t >= dayStart - 28 * DAY_MS && t <= dayStart;
        })
        .reduce((sum, s) => sum + s.load_score, 0) / 4;

    const acwr = chronic > 0 ? Math.round((acute / chronic) * 100) / 100 : null;

    return {
      date: format(new Date(h.recorded_at), "MMM d"),
      fatigue: h.fatigue_score,
      recovery: h.recovery_score,
      acwr,
    };
  });
}

export function buildVolumeByWeek(
  activities: AnalyticsActivity[],
  scores: AnalyticsScore[],
  weeks = 12
): VolumeWeek[] {
  const loadByActivity = new Map(scores.map((s) => [s.activity_id, s.load_score]));
  const now = new Date();
  const start = new Date(now.getTime() - weeks * 7 * DAY_MS);

  const weekStarts = eachWeekOfInterval(
    { start, end: now },
    { weekStartsOn: 1 }
  );

  return weekStarts.map((ws) => {
    const we = endOfWeek(ws, { weekStartsOn: 1 });
    const inWeek = activities.filter((a) =>
      isWithinInterval(new Date(a.started_at), { start: ws, end: we })
    );
    return {
      week: format(ws, "MMM d"),
      load: inWeek.reduce(
        (sum, a) => sum + (loadByActivity.get(a.id) ?? Math.round(a.duration_seconds / 60)),
        0
      ),
      duration: inWeek.reduce((sum, a) => sum + a.duration_seconds, 0),
      distance: inWeek.reduce((sum, a) => sum + (a.distance_meters ?? 0), 0),
      sessions: inWeek.length,
    };
  });
}

const SESSION_COLORS: Record<string, string> = {
  easy: "#06b6d4",
  recovery: "#64748b",
  tempo: "#6366f1",
  threshold: "#a855f7",
  interval: "#f59e0b",
  race: "#ef4444",
  long: "#10b981",
  other: "#94a3b8",
};

export function buildSessionTypeDistribution(
  activities: AnalyticsActivity[]
): DistributionSlice[] {
  const counts = new Map<string, number>();
  for (const a of activities) {
    const key = a.session_type ?? "other";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts, ([name, value]) => ({
    name: name.charAt(0).toUpperCase() + name.slice(1),
    value,
    color: SESSION_COLORS[name] ?? "#6366f1",
  })).sort((a, b) => b.value - a.value);
}

export function buildRpeDistribution(activities: AnalyticsActivity[]): DistributionSlice[] {
  const bands = [
    { name: "RPE 1–3", min: 1, max: 3, color: "#06b6d4" },
    { name: "RPE 4–6", min: 4, max: 6, color: "#6366f1" },
    { name: "RPE 7–8", min: 7, max: 8, color: "#f59e0b" },
    { name: "RPE 9–10", min: 9, max: 10, color: "#ef4444" },
  ];
  return bands.map((b) => ({
    name: b.name,
    value: activities.filter(
      (a) => a.rpe != null && a.rpe >= b.min && a.rpe <= b.max
    ).length,
    color: b.color,
  }));
}

export function buildHrZoneDistribution(
  activities: AnalyticsActivity[],
  maxHr: number | null
): DistributionSlice[] {
  const withHr = activities.filter((a) => a.avg_heart_rate != null);
  if (withHr.length === 0 || !maxHr) {
    return buildSessionTypeDistribution(activities);
  }

  const zones = [
    { name: "Z1 Recovery", min: 0, max: 0.6, color: "#64748b" },
    { name: "Z2 Aerobic", min: 0.6, max: 0.7, color: "#06b6d4" },
    { name: "Z3 Tempo", min: 0.7, max: 0.8, color: "#6366f1" },
    { name: "Z4 Threshold", min: 0.8, max: 0.9, color: "#f59e0b" },
    { name: "Z5 Max", min: 0.9, max: 1.01, color: "#ef4444" },
  ];

  return zones.map((z) => ({
    name: z.name,
    value: withHr.filter((a) => {
      const pct = (a.avg_heart_rate ?? 0) / maxHr;
      return pct >= z.min && pct < z.max;
    }).length,
    color: z.color,
  }));
}

export function buildHeatmapDays(
  activities: AnalyticsActivity[],
  scores: AnalyticsScore[]
): HeatmapDay[] {
  const loadByActivity = new Map(scores.map((s) => [s.activity_id, s.load_score]));
  const buckets = new Map<string, { load: number; workouts: number }>();

  for (const a of activities) {
    const key = localDateKey(a.started_at);
    const load =
      loadByActivity.get(a.id) ?? Math.round(a.duration_seconds / 60);
    const bucket = buckets.get(key) ?? { load: 0, workouts: 0 };
    bucket.load += load;
    bucket.workouts += 1;
    buckets.set(key, bucket);
  }

  return Array.from(buckets, ([date, v]) => ({
    date,
    load: v.load,
    workouts: v.workouts,
  }));
}

export function computePeriodMetrics(
  range: DateRange,
  history: SplitIndexSnapshot[],
  activities: AnalyticsActivity[],
  scores: AnalyticsScore[],
  targetSessionsPerWeek: number
): PeriodMetrics {
  const histInRange = filterByDateRange(history, range, "recorded_at");
  const actsInRange = filterByDateRange(activities, range, "started_at");
  const loadByActivity = new Map(scores.map((s) => [s.activity_id, s.load_score]));

  const avg = (vals: number[]) =>
    vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;

  const totalLoad = actsInRange.reduce(
    (sum, a) => sum + (loadByActivity.get(a.id) ?? Math.round(a.duration_seconds / 60)),
    0
  );

  const days = Math.max(
    1,
    differenceInCalendarDays(range.end, range.start) + 1
  );
  const weeks = Math.max(1, days / 7);
  const sessionsPerWeek = actsInRange.length / weeks;
  const consistencyPct = Math.min(
    100,
    Math.round((sessionsPerWeek / targetSessionsPerWeek) * 100)
  );

  return {
    label: range.label,
    avgSplit: avg(histInRange.map((h) => h.split_index)),
    avgEndurance: avg(histInRange.map((h) => h.endurance_index)),
    avgStrength: avg(histInRange.map((h) => h.strength_index)),
    avgRecovery: avg(histInRange.map((h) => h.recovery_score)),
    avgFatigue: avg(histInRange.map((h) => h.fatigue_score)),
    totalLoad,
    totalDuration: actsInRange.reduce((s, a) => s + a.duration_seconds, 0),
    totalDistance: actsInRange.reduce((s, a) => s + (a.distance_meters ?? 0), 0),
    sessions: actsInRange.length,
    consistencyPct,
  };
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function computeStreak(heatmapDays: HeatmapDay[]): number {
  const loadByDate = new Map(heatmapDays.map((d) => [d.date, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streak = 0;
  for (let i = 0; ; i++) {
    const entry = loadByDate.get(localDateKey(new Date(today.getTime() - i * DAY_MS)));
    if (entry && entry.workouts > 0) streak++;
    else if (i === 0) continue;
    else break;
  }
  return streak;
}

export function computeHitRate(
  heatmapDays: HeatmapDay[],
  targetSessionsPerWeek: number,
  weeks = 8
): number {
  const byDate = new Map(heatmapDays.map((d) => [d.date, d]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dowMon = (today.getDay() + 6) % 7;
  const thisMonday = new Date(today.getTime() - dowMon * DAY_MS);

  let hitWeeks = 0;
  let completed = 0;
  for (let w = 1; w <= weeks; w++) {
    const monday = new Date(thisMonday.getTime() - w * 7 * DAY_MS);
    let sessions = 0;
    for (let d = 0; d < 7; d++) {
      const date = new Date(monday.getTime() + d * DAY_MS);
      const entry = byDate.get(localDateKey(date));
      if (entry && entry.workouts > 0) sessions++;
    }
    completed++;
    if (sessions >= targetSessionsPerWeek) hitWeeks++;
  }
  return completed > 0 ? Math.round((hitWeeks / completed) * 100) : 0;
}

export function computeSessionsPerWeek(
  activities: AnalyticsActivity[],
  weeks = 8
): { label: string; sessions: number }[] {
  const now = new Date();
  const dowMon = (now.getDay() + 6) % 7;
  const thisMonday = new Date(now.getTime() - dowMon * DAY_MS);

  const buckets: { label: string; sessions: number }[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const monday = new Date(thisMonday.getTime() - w * 7 * DAY_MS);
    const sunday = endOfWeek(monday, { weekStartsOn: 1 });
    const sessions = activities.filter((a) =>
      isWithinInterval(new Date(a.started_at), { start: monday, end: sunday })
    ).length;
    buckets.push({
      label: format(monday, "MMM d"),
      sessions,
    });
  }
  return buckets;
}
