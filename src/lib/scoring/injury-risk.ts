/**
 * Split Index — injury risk index (MASTER-BRIEF.md §7).
 *
 * ACWR-based (7-day acute load vs 28-day chronic load, chronic normalized to
 * a weekly average). Framed as relative to the athlete's own baseline, not
 * an absolute medical probability.
 */

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
