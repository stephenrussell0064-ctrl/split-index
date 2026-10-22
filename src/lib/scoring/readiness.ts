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
  /**
   * Load done in the last two days, weighted toward the last 24 hours — full
   * weight inside a day, fading to nothing at 48 hours. The "what did I just
   * do" signal the 7-against-28-day ratio cannot carry: a race this morning is
   * one seventh of a week to ACWR, and the whole of today to the athlete.
   */
  acuteLoad: number;
  /** The athlete's own ordinary day — the 28-day load averaged per day. What `acuteLoad` is read against. */
  typicalDailyLoad: number;
  /** Hours since the last session that counted as hard, or null when nothing in the window did. */
  hoursSinceLastHardSession: number | null;
  /**
   * Acute-to-chronic ratio with a recency-weighted acute side (see
   * recencyWeightedLoad) — the readiness module's own reading, not the flat
   * 7-day box that Analytics' injury-risk chart and the stored snapshots use.
   */
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

const HOUR_MS = 3_600_000;
/** A session is "hard" past this load, or when the athlete tagged it so. */
const HARD_SESSION_LOAD = 50;
const HARD_SESSION_TYPES = new Set(["tempo", "threshold", "interval", "fartlek", "race", "long"]);
/** A lift this long is a hard session whatever its load says — strength load units run far below cardio's. */
const HARD_STRENGTH_MIN_SECONDS = 45 * 60;
const ACUTE_FULL_WEIGHT_HOURS = 24;
const ACUTE_ZERO_WEIGHT_HOURS = 48;

export function isHardSession(s: TimelineSession): boolean {
  if ((s.loadScore ?? 0) >= HARD_SESSION_LOAD) return true;
  if (s.sessionType && HARD_SESSION_TYPES.has(s.sessionType)) return true;
  return s.domain === "strength" && s.durationSeconds >= HARD_STRENGTH_MIN_SECONDS;
}

/** Full weight inside the last day, fading linearly to zero at two days. */
export function acuteWeight(ageHours: number): number {
  if (ageHours < 0) return 0;
  if (ageHours <= ACUTE_FULL_WEIGHT_HOURS) return 1;
  if (ageHours >= ACUTE_ZERO_WEIGHT_HOURS) return 0;
  return 1 - (ageHours - ACUTE_FULL_WEIGHT_HOURS) / (ACUTE_ZERO_WEIGHT_HOURS - ACUTE_FULL_WEIGHT_HOURS);
}

export function computeAcuteLoad(sessions: TimelineSession[], asOf: number): number {
  return sessions.reduce((sum, s) => {
    if (s.loadScore == null) return sum;
    const ageHours = (asOf - new Date(s.startedAt).getTime()) / HOUR_MS;
    return sum + s.loadScore * acuteWeight(ageHours);
  }, 0);
}

export function hoursSinceLastHard(sessions: TimelineSession[], asOf: number): number | null {
  let latest: number | null = null;
  for (const s of sessions) {
    if (!isHardSession(s)) continue;
    const t = new Date(s.startedAt).getTime();
    if (t > asOf) continue;
    if (latest == null || t > latest) latest = t;
  }
  return latest == null ? null : (asOf - latest) / HOUR_MS;
}

/*
  THE LOAD WINDOW WAS A BOX, AND FOUR DAYS OFF COULD NOT CLIMB OUT OF IT.

  Owner, 22 Oct 2026: "i havent trained in four days but my recovery score is
  showing as 30 why. this is way too low for that." The acute load behind the
  fatigue and ACWR terms was computeRecentLoads' plain 7-day sum: six sessions
  packed into two days a week earlier counted at full weight on day five, six
  and seven, then vanished all at once on day eight. Inside the box the only
  thing that knew the athlete had rested was the 15-points-a-day rest term.

  Two recency-weighted sums replace the box here, each shaped for its job:

  - FATIGUE decays fast. Each session's load counts e^(-age / 2 days): a
    session today counts in full, exactly as the box did, so race-day and
    next-day readings keep the calibration of 17 Oct; a session four days ago
    counts 14% and a week ago 3%. That is what "I haven't trained in four
    days" should mean to a fatigue term.

  - ACWR decays slowly, and sums to the same week. Full weight for a day,
    then e^(-(age - 1) / 6 days), whose integral is seven days — so an athlete
    training evenly still reads ACWR ~1 and the "stacking" reasons still fire
    for a genuinely loaded week. It is the exponentially-weighted ACWR of the
    literature rather than the rolling-average one, and it means a big week
    recedes over the following week instead of standing at full height until
    a cliff.

  computeRecentLoads itself is untouched: Analytics' ACWR chart, the injury
  panel and the stored recovery snapshots all read the box and stay
  internally consistent with each other.
*/
const DAY_MS = 86_400_000;
const FATIGUE_TAU_DAYS = 2;
const ACWR_FULL_WEIGHT_DAYS = 1;
const ACWR_TAU_DAYS = 6;

/** Weight of a session `ageDays` old: 1 inside `fullWeightDays`, then exponential with time constant `tauDays`. Future sessions weigh nothing. */
export function recencyWeight(ageDays: number, fullWeightDays: number, tauDays: number): number {
  if (ageDays < 0) return 0;
  if (ageDays <= fullWeightDays) return 1;
  return Math.exp(-(ageDays - fullWeightDays) / tauDays);
}

export function recencyWeightedLoad(
  sessions: TimelineSession[],
  asOf: number,
  fullWeightDays: number,
  tauDays: number
): number {
  return sessions.reduce((sum, s) => {
    if (s.loadScore == null) return sum;
    const ageDays = (asOf - new Date(s.startedAt).getTime()) / DAY_MS;
    return sum + s.loadScore * recencyWeight(ageDays, fullWeightDays, tauDays);
  }, 0);
}

/** The fatigue term's load: what the body is still carrying, not what the week contained. */
export function fatigueLoad(sessions: TimelineSession[], asOf: number): number {
  return recencyWeightedLoad(sessions, asOf, 0, FATIGUE_TAU_DAYS);
}

/** The ACWR's acute side: recency-weighted, integrating to one week. */
export function acwrAcuteLoad(sessions: TimelineSession[], asOf: number): number {
  return recencyWeightedLoad(sessions, asOf, ACWR_FULL_WEIGHT_DAYS, ACWR_TAU_DAYS);
}

function readinessAcwr(sessions: TimelineSession[], asOf: number): number {
  const { chronic } = computeRecentLoads(loadRows(sessions), asOf);
  return calculateACWR(acwrAcuteLoad(sessions, asOf), chronic);
}

function domainAcwr(sessions: TimelineSession[], asOf: number): number | null {
  if (sessions.length === 0) return null;
  return readinessAcwr(sessions, asOf);
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
  const { chronic } = computeRecentLoads(loadRows(sessions), asOf);
  const overallAcwr = readinessAcwr(sessions, asOf);
  const fatigueScore = calculateFatigueScore(overallAcwr, fatigueLoad(sessions, asOf));
  /*
    Days since the last hard session, measured rather than assumed.

    This was hard-coded to 1, so the rest term in calculateRecoveryScore was a
    constant 15 points for every athlete on every day: someone three hours out
    of a 20km race and someone a week into a taper scored identically on it.
    The number was kept constant "to match the other call sites", which is a
    reason for the other call sites to change, not for this one to stay wrong.
    Those two (activity-scorer.ts, api/recovery/hrv/route.ts) feed a stored
    snapshot and an older panel, not the dashboard; they are left as they are.

    No hard session in the window reads as fully rested, which is what it is.
  */
  const sinceHard = hoursSinceLastHard(sessions, asOf);
  const daysSinceLastHardSession = sinceHard == null ? 7 : sinceHard / 24;
  const readiness = calculateRecoveryScore(fatigueScore, overallAcwr, daysSinceLastHardSession);
  const acuteLoad = computeAcuteLoad(sessions, asOf);
  const typicalDailyLoad = chronic / 7;

  const gymAcwr = domainAcwr(sessions.filter((s) => s.domain === "strength"), asOf);
  const cardioAcwr = domainAcwr(sessions.filter((s) => s.domain === "cardio"), asOf);
  const gymElevated = gymAcwr !== null && gymAcwr > ACWR_OPTIMAL_HIGH;
  const cardioElevated = cardioAcwr !== null && cardioAcwr > ACWR_OPTIMAL_HIGH;

  return {
    readiness,
    acuteLoad: Math.round(acuteLoad * 10) / 10,
    typicalDailyLoad: Math.round(typicalDailyLoad * 10) / 10,
    hoursSinceLastHardSession: sinceHard == null ? null : Math.round(sinceHard * 10) / 10,
    overallAcwr: Math.round(overallAcwr * 100) / 100,
    gymAcwr: gymAcwr !== null ? Math.round(gymAcwr * 100) / 100 : null,
    cardioAcwr: cardioAcwr !== null ? Math.round(cardioAcwr * 100) / 100 : null,
    gymElevated,
    cardioElevated,
    reason: buildReason(readiness, gymElevated, cardioElevated),
  };
}
