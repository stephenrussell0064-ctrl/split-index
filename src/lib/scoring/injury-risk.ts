/**
 * Split Index — injury risk index (MASTER-BRIEF.md §7).
 *
 * ACWR-based (7-day acute load vs 28-day chronic load, chronic normalized to
 * a weekly average). Framed as relative to the athlete's own baseline, not
 * an absolute medical probability.
 */

import { calculateACWR } from "@/lib/scoring/engine";

export type InjuryRiskZone = "Undertraining" | "Optimal" | "Caution" | "Danger";

export interface InjuryRiskResult {
  /** 0-95 */
  index: number;
  relativeRisk: number;
  acwr: number;
  zone: InjuryRiskZone;
}

export function injuryRisk(acwr: number): InjuryRiskResult {
  let rr: number;
  if (acwr < 0.8) rr = 1.0 + (0.8 - acwr) * 0.6;
  else if (acwr <= 1.3) rr = 1.0;
  else if (acwr <= 1.5) rr = 1.0 + (acwr - 1.3) * 3.0;
  else rr = 1.6 + (acwr - 1.5) * 2.5;

  return {
    index: Math.min(95, Math.round(15 * rr)),
    relativeRisk: Math.round(rr * 100) / 100,
    acwr: Math.round(acwr * 100) / 100,
    zone: acwr < 0.8 ? "Undertraining" : acwr <= 1.3 ? "Optimal" : acwr <= 1.5 ? "Caution" : "Danger",
  };
}

/** Weekly load that would bring ACWR to the top of the optimal band (1.3), given the current 28-day chronic load. */
export function optimalWeeklyLoadTarget(chronicWeeklyLoad: number): number {
  return Math.round(chronicWeeklyLoad * 1.3);
}

/**
 * Optional HRV modifier on the load-based risk (MASTER-BRIEF.md §8). Never
 * required — when hrvToday/hrvBaseline are absent, the load-based index is
 * returned unchanged. hrvToday & hrvBaseline are rMSSD in ms.
 */
export function hrvAdjustedRisk(
  loadRiskIndex: number,
  hrvToday?: number | null,
  hrvBaseline?: number | null
): number {
  if (hrvToday == null || hrvBaseline == null || hrvBaseline <= 0) return loadRiskIndex;
  const ratio = hrvToday / hrvBaseline; // <1 = suppressed = less recovered
  const modifier = ratio >= 1 ? -5 * (ratio - 1) : 25 * (1 - ratio);
  return Math.max(0, Math.min(95, Math.round(loadRiskIndex + modifier)));
}

export interface AcwrTrendPoint {
  date: string;
  acwr: number;
  zone: InjuryRiskZone;
}

/**
 * ACWR as a trend over time, not just today's snapshot (user feedback: "i
 * want this data analytics displayed and detailed as much as possible for
 * proper data analysis on all their trends and performances" — the injury-
 * risk panel only ever showed the current ratio, with no way to see whether
 * it's been climbing toward danger or settling back into the optimal band).
 * Re-derives acute/chronic load as of each weekly checkpoint using the same
 * 7d/28d windows as computeRecentLoads, just anchored to a past date instead
 * of "now".
 */
export function computeAcwrTrend(
  loadScores: { load_score: number; created_at: string }[],
  weeks = 12
): AcwrTrendPoint[] {
  const day = 86400000;
  const now = Date.now();
  const timestamps = loadScores.map((s) => ({
    load: s.load_score,
    t: new Date(s.created_at).getTime(),
  }));

  const points: AcwrTrendPoint[] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const asOf = now - w * 7 * day;
    const acute = timestamps
      .filter((s) => s.t <= asOf && asOf - s.t <= 7 * day)
      .reduce((sum, s) => sum + s.load, 0);
    const chronicRaw =
      timestamps
        .filter((s) => s.t <= asOf && asOf - s.t <= 28 * day)
        .reduce((sum, s) => sum + s.load, 0) / 4;
    const acwr = calculateACWR(acute, chronicRaw || 1);
    const { zone } = injuryRisk(acwr);
    points.push({
      date: new Date(asOf).toLocaleDateString("en-GB", { month: "short", day: "numeric" }),
      acwr: Math.round(acwr * 100) / 100,
      zone,
    });
  }
  return points;
}
