/**
 * Cross-domain readiness (interference-engine brief, Part 2).
 *
 * The existing ACWR/Injury Risk pipeline (injury-risk.ts, calculateACWR/
 * calculateFatigueScore/calculateRecoveryScore in engine.ts) is already
 * genuinely cross-domain — computeRecentLoads sums load_score across every
 * activity regardless of sport, so a heavy squat session already raises
 * tomorrow's acute load exactly like a hard run would. What was missing
 * wasn't domain-blindness, it was decomposition: today's number could
 * always be read (correctly) as "training load is elevated," but never
 * "specifically because of lifting, specifically because of cardio, or
 * both stacking at once." This module adds that decomposition and turns it
 * into the plain-language reason the brief asks for.
 */
import { calculateACWR, calculateFatigueScore, calculateRecoveryScore } from "./engine";
import { computeRecentLoads } from "./service";
import { ACWR_OPTIMAL_HIGH } from "./constants";
import type { TimelineSession } from "./timeline";

export interface ReadinessResult {
  /** 0-100, higher = more ready to train hard today. */
  readiness: number;
  overallAcwr: number;
  /** null when no gym sessions exist in the window at all (not the same as "not elevated"). */
  gymAcwr: number | null;
  cardioAcwr: number | null;
  gymElevated: boolean;
  cardioElevated: boolean;
  reason: string;
}

function loadRows(sessions: TimelineSession[]): { load_score: number; created_at: string }[] {
  return sessions
    .filter((s) => s.loadScore != null)
    .map((s) => ({ load_score: s.loadScore!, created_at: s.startedAt }));
}

function domainAcwr(sessions: TimelineSession[], asOf: number): number | null {
  if (sessions.length === 0) return null;
  const { acute, chronic } = computeRecentLoads(loadRows(sessions), asOf);
  return calculateACWR(acute, chronic);
}

function buildReason(readiness: number, gymElevated: boolean, cardioElevated: boolean): string {
  if (readiness >= 70) {
    return "Fully ready — recent training load is well within your norm.";
  }
  if (gymElevated && cardioElevated) {
    return "Lower today — recent strength training and this week's cardio volume are both stacking.";
  }
  if (gymElevated) {
    return "Lower today — recent strength training is the main driver.";
  }
  if (cardioElevated) {
    return "Lower today — this week's cardio volume is the main driver.";
  }
  return "Moderate — nothing dramatic, but not fully fresh either.";
}

/** `asOf` lets callers compute a historical snapshot — e.g. the Hybrid Athlete Report's readiness trend needs readiness "as of" the report's period start, not just today. */
export function computeReadiness(
  sessions: TimelineSession[],
  asOf: number = Date.now()
): ReadinessResult {
  const { acute, chronic } = computeRecentLoads(loadRows(sessions), asOf);
  const overallAcwr = calculateACWR(acute, chronic);
  const fatigueScore = calculateFatigueScore(overallAcwr, acute);
  // daysSinceLastHardSession is hardcoded to 1 to match the existing
  // recovery-score call sites elsewhere in the app (activity-scorer.ts,
  // api/recovery/hrv/route.ts) — keeping this number consistent with what
  // HeroStatWall already shows matters more than refining this one input,
  // which is a separate, pre-existing simplification unrelated to Part 2.
  const readiness = calculateRecoveryScore(fatigueScore, overallAcwr, 1);

  const gymAcwr = domainAcwr(sessions.filter((s) => s.domain === "strength"), asOf);
  const cardioAcwr = domainAcwr(sessions.filter((s) => s.domain === "cardio"), asOf);
  const gymElevated = gymAcwr !== null && gymAcwr > ACWR_OPTIMAL_HIGH;
  const cardioElevated = cardioAcwr !== null && cardioAcwr > ACWR_OPTIMAL_HIGH;

  return {
    readiness,
    overallAcwr: Math.round(overallAcwr * 100) / 100,
    gymAcwr: gymAcwr !== null ? Math.round(gymAcwr * 100) / 100 : null,
    cardioAcwr: cardioAcwr !== null ? Math.round(cardioAcwr * 100) / 100 : null,
    gymElevated,
    cardioElevated,
    reason: buildReason(readiness, gymElevated, cardioElevated),
  };
}
