import type { SplitIndexSnapshot } from "@/types";

const DAY_MS = 86400000;

/** Linear-regression forecast of Split Index N weeks ahead. */
export function computeSplitIndexProjection(
  history: SplitIndexSnapshot[],
  weeksAhead: number
): number | null {
  const sorted = [...history].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  const recent = sorted.slice(-14);
  if (recent.length < 3) return null;

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

  const lastT = new Date(recent[recent.length - 1].recorded_at).getTime();
  const targetT = lastT + weeksAhead * 7 * DAY_MS;
  const projected = Math.round(slope * targetT + intercept);

  return Math.max(0, Math.min(999, projected));
}
