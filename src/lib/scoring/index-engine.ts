/**
 * Split Index — Index aggregation
 * -------------------------------
 * Rolls per-activity scores up into the three headline numbers and applies the
 * onboarding profile that decides which one is primary.
 *
 *   Cardio profile  -> Engine Index is the headline
 *   Gym profile     -> Lab Index is the headline
 *   Hybrid profile  -> Split Index (weighted blend) is the headline
 *
 * The blend is intentionally NOT a naive average. A hybrid athlete who trains
 * both sides evenly should not be dragged down by having fewer sessions on one
 * side, so each side is scored on its own recent best-and-consistency, then
 * combined by a user-adjustable weight (default 50/50).
 */

export type Profile = 'gym' | 'cardio' | 'hybrid';

export interface ActivityScore {
  side: 'lab' | 'engine';
  score: number;        // 0–1000 from the per-activity engines
  confidence: number;   // 0–1
  date: string;         // ISO
}

export interface IndexResult {
  labIndex: number | null;
  engineIndex: number | null;
  splitIndex: number | null;
  headline: number;
  headlineLabel: 'Lab Index' | 'Engine Index' | 'Split Index';
  breakdown: { lab: number | null; engine: number | null; weightLab: number; weightEngine: number };
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/**
 * Side index from recent activities: a confidence-weighted blend of the
 * athlete's *best* recent effort (ceiling = what they're capable of) and their
 * *median* recent effort (floor = what they hold consistently). 70/30 toward
 * consistency so one lucky session can't inflate the number.
 */
function sideIndex(activities: ActivityScore[], side: 'lab' | 'engine'): number | null {
  const rows = activities
    .filter(a => a.side === side)
    .sort((a, b) => +new Date(b.date) - +new Date(a.date))
    .slice(0, 20); // recent window
  if (rows.length === 0) return null;

  const weighted = rows.map(r => ({ v: r.score, w: clamp(r.confidence, 0.1, 1) }));
  const sorted = [...weighted].sort((a, b) => a.v - b.v);
  const median = sorted[Math.floor(sorted.length / 2)].v;
  const best = Math.max(...weighted.map(r => r.v));

  // confidence-weighted mean pulls toward well-evidenced sessions
  const totalW = weighted.reduce((s, r) => s + r.w, 0);
  const wMean = weighted.reduce((s, r) => s + r.v * r.w, 0) / totalW;

  const combined = 0.5 * wMean + 0.2 * best + 0.3 * median;
  return Math.round(clamp(combined, 0, 1000));
}

export function aggregateSideIndex(
  activities: ActivityScore[],
  side: "lab" | "engine"
): number | null {
  return sideIndex(activities, side);
}

export function computeIndexes(
  activities: ActivityScore[],
  profile: Profile,
  weightLab = 0.5
): IndexResult {
  const lab = sideIndex(activities, 'lab');
  const engine = sideIndex(activities, 'engine');
  const wLab = clamp(weightLab, 0, 1);
  const wEng = 1 - wLab;

  let split: number | null = null;
  if (lab !== null && engine !== null) split = Math.round(lab * wLab + engine * wEng);
  else split = lab ?? engine; // only one side logged so far

  let headline: number;
  let headlineLabel: IndexResult['headlineLabel'];
  if (profile === 'gym') { headline = lab ?? split ?? 0; headlineLabel = 'Lab Index'; }
  else if (profile === 'cardio') { headline = engine ?? split ?? 0; headlineLabel = 'Engine Index'; }
  else { headline = split ?? 0; headlineLabel = 'Split Index'; }

  return {
    labIndex: lab,
    engineIndex: engine,
    splitIndex: split,
    headline,
    headlineLabel,
    breakdown: { lab, engine, weightLab: wLab, weightEngine: wEng },
  };
}

/** Linear-regression projection of the headline index N days out. */
export function projectIndex(
  history: { date: string; value: number }[],
  daysAhead: number
): { projected: number; slopePerWeek: number; r2: number } | null {
  if (history.length < 3) return null;
  const t0 = +new Date(history[0].date);
  const xs = history.map(h => (+new Date(h.date) - t0) / 86400000); // days
  const ys = history.map(h => h.value);
  const n = xs.length;
  const sx = xs.reduce((a, b) => a + b, 0);
  const sy = ys.reduce((a, b) => a + b, 0);
  const sxy = xs.reduce((a, b, i) => a + b * ys[i], 0);
  const sxx = xs.reduce((a, b) => a + b * b, 0);
  const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const intercept = (sy - slope * sx) / n;

  const meanY = sy / n;
  const ssTot = ys.reduce((a, b) => a + (b - meanY) ** 2, 0);
  const ssRes = ys.reduce((a, b, i) => a + (b - (slope * xs[i] + intercept)) ** 2, 0);
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

  const lastX = xs[xs.length - 1];
  const projected = Math.round(slope * (lastX + daysAhead) + intercept);
  return { projected, slopePerWeek: Math.round(slope * 7 * 10) / 10, r2: Math.round(r2 * 100) / 100 };
}
