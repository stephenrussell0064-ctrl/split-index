import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";
import type { SplitIndexSnapshot } from "@/types";

const DAY_MS = 86400000;

/** Realistic weekly index change bounds for long-range forecasts. */
const MAX_WEEKLY_DELTA = 10;
const MIN_WEEKLY_DELTA = -8;

type DayPoint = { days: number; value: number };

/** Linear regression on day-offset points; returns slope in index points per day. */
export function regressionSlopePerDay(points: DayPoint[]): number {
  const n = points.length;
  if (n < 2) return 0;

  const sumT = points.reduce((s, p) => s + p.days, 0);
  const sumV = points.reduce((s, p) => s + p.value, 0);
  const sumTT = points.reduce((s, p) => s + p.days * p.days, 0);
  const sumTV = points.reduce((s, p) => s + p.days * p.value, 0);
  const denom = n * sumTT - sumT * sumT;

  return denom !== 0 ? (n * sumTV - sumT * sumV) / denom : 0;
}

function toDayPoints(history: SplitIndexSnapshot[], maxPoints: number): DayPoint[] {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const recent = sorted.slice(-maxPoints);
  if (recent.length < 3) return [];

  const t0 = new Date(recent[0].recorded_at).getTime();
  return recent.map((h) => ({
    days: (new Date(h.recorded_at).getTime() - t0) / DAY_MS,
    value: h.split_index,
  }));
}

/** Forecast Split Index from recent trend, anchored on the latest snapshot. */
export function forecastSplitIndexFromHistory(
  history: SplitIndexSnapshot[],
  daysAhead: number,
  maxPoints = 14
): number | null {
  const points = toDayPoints(history, maxPoints);
  if (points.length < 3) return null;

  const lastValue = points[points.length - 1].value;
  const slopePerDay = regressionSlopePerDay(points);
  const weeklyRate = slopePerDay * 7;
  const cappedWeekly = Math.max(
    MIN_WEEKLY_DELTA,
    Math.min(MAX_WEEKLY_DELTA, weeklyRate)
  );
  const projected = Math.round(lastValue + (cappedWeekly / 7) * daysAhead);

  return Math.max(MIN_INDEX, Math.min(MAX_INDEX, projected));
}

/** Linear-regression forecast of Split Index N weeks ahead. */
export function computeSplitIndexProjection(
  history: SplitIndexSnapshot[],
  weeksAhead: number
): number | null {
  return forecastSplitIndexFromHistory(history, weeksAhead * 7);
}
