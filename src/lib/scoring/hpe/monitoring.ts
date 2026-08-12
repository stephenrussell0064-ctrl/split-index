/**
 * Hybrid Plan Engine — WP10 monitoring.
 *
 * Pure aggregation over telemetry rows, so every metric on the dashboard is
 * testable without a database and none of them are computed twice in slightly
 * different ways by a query and a chart.
 *
 * The metric set is chosen against the assurance review's closing warning:
 * "do not let '0 violations' become the metric anyone watches." Hard-rule
 * violations ARE tracked here, because a non-zero count is a genuine alarm —
 * but they sit alongside adherence, abandonment and injury reports, which are
 * the numbers that say whether the plans are any good, and alongside the
 * refusal breakdown, which says who the engine is turning away.
 */

import { ACWR_BLOCK, ACWR_FLOOR, ACWR_WARN, EMPHASIS_KEYS, type EmphasisKey } from "./constants";

export interface GenerationEvent {
  userId: string;
  occurredAt: string;
  outcome: "generated" | "safety_blocked" | "insufficient_data" | "missing_intake" | "feature_disabled" | "error";
  reasonCode: string | null;
  tier: number | null;
  peakAcwr: number | null;
  hardViolations: number | null;
}

export interface FeedbackEvent {
  userId: string;
  loggedAt: string;
  completed: boolean;
  metPrescription: boolean;
  sessionRpe: number | null;
  lowCapacityFlagged: boolean;
}

export interface InjuryReport {
  userId: string;
  reportedAt: string;
  severity: "niggle" | "modified_training" | "stopped_training" | "medical" | null;
  attributedToPlan: boolean | null;
}

export interface ProfileSnapshot {
  userId: string;
  generatedAt: string;
  tier: number;
  emphasis: Record<EmphasisKey, number>;
}

// ---------------------------------------------------------------------------

export interface AdherenceMetrics {
  sessionsLogged: number;
  completionRate: number | null;
  prescriptionHitRate: number | null;
  meanSessionRpe: number | null;
  lowCapacitySwapRate: number | null;
}

export function computeAdherence(feedback: FeedbackEvent[]): AdherenceMetrics {
  if (feedback.length === 0) {
    return {
      sessionsLogged: 0,
      completionRate: null,
      prescriptionHitRate: null,
      meanSessionRpe: null,
      lowCapacitySwapRate: null,
    };
  }
  const completed = feedback.filter((f) => f.completed);
  const rpes = feedback.map((f) => f.sessionRpe).filter((r): r is number => r != null);
  return {
    sessionsLogged: feedback.length,
    completionRate: completed.length / feedback.length,
    // Denominated on COMPLETED sessions: whether a session the athlete did
    // hit its prescription is a different question from whether they did it,
    // and averaging the two together hides both.
    prescriptionHitRate: completed.length > 0 ? completed.filter((f) => f.metPrescription).length / completed.length : null,
    meanSessionRpe: rpes.length > 0 ? rpes.reduce((s, r) => s + r, 0) / rpes.length : null,
    lowCapacitySwapRate: feedback.filter((f) => f.lowCapacityFlagged).length / feedback.length,
  };
}

/**
 * Plan abandonment: an athlete who generated a plan and then stopped logging
 * against it. Measured against a silence window rather than an explicit
 * "abandon" action, because nobody presses that button — they just stop.
 */
export function computeAbandonment(
  generated: GenerationEvent[],
  feedback: FeedbackEvent[],
  silenceDays = 14,
  now: Date = new Date()
): { plansGenerated: number; abandoned: number; abandonmentRate: number | null } {
  const generators = new Set(generated.filter((e) => e.outcome === "generated").map((e) => e.userId));
  if (generators.size === 0) return { plansGenerated: 0, abandoned: 0, abandonmentRate: null };

  const lastLog = new Map<string, number>();
  for (const f of feedback) {
    const t = new Date(f.loggedAt).getTime();
    lastLog.set(f.userId, Math.max(lastLog.get(f.userId) ?? 0, t));
  }

  const cutoff = now.getTime() - silenceDays * 86_400_000;
  let abandoned = 0;
  for (const userId of generators) {
    const last = lastLog.get(userId);
    if (last == null || last < cutoff) abandoned++;
  }
  return { plansGenerated: generators.size, abandoned, abandonmentRate: abandoned / generators.size };
}

export interface AcwrDistribution {
  weeksObserved: number;
  belowFloor: number;
  inRange: number;
  aboveWarn: number;
  /** Any week here is a genuine alarm: the engine's own enforcement should make this impossible. */
  aboveBlock: number;
  peakObserved: number | null;
}

export function computeAcwrDistribution(events: GenerationEvent[]): AcwrDistribution {
  const peaks = events.map((e) => e.peakAcwr).filter((v): v is number => v != null);
  return {
    weeksObserved: peaks.length,
    belowFloor: peaks.filter((v) => v < ACWR_FLOOR).length,
    inRange: peaks.filter((v) => v >= ACWR_FLOOR && v <= ACWR_WARN).length,
    aboveWarn: peaks.filter((v) => v > ACWR_WARN && v <= ACWR_BLOCK).length,
    aboveBlock: peaks.filter((v) => v > ACWR_BLOCK).length,
    peakObserved: peaks.length > 0 ? Math.max(...peaks) : null,
  };
}

export interface RefusalBreakdown {
  attempts: number;
  generated: number;
  byOutcome: Record<string, number>;
  /** Block rate per specific reason, so "safety screen blocks 8%" can be read as which blocks, not one number. */
  byReasonCode: Record<string, number>;
  safetyBlockRate: number | null;
  /**
   * Refusal churn: of the athletes who were refused, how many never came
   * back and tried again. A refusal that retains is working as designed; a
   * refusal that loses the user is a churn event, which is exactly what the
   * review said a refusal with no next step becomes.
   */
  refusedUsers: number;
  refusedUsersWhoReturned: number;
  refusalChurnRate: number | null;
}

export function computeRefusals(events: GenerationEvent[]): RefusalBreakdown {
  const byOutcome: Record<string, number> = {};
  const byReasonCode: Record<string, number> = {};
  for (const e of events) {
    byOutcome[e.outcome] = (byOutcome[e.outcome] ?? 0) + 1;
    if (e.reasonCode) byReasonCode[e.reasonCode] = (byReasonCode[e.reasonCode] ?? 0) + 1;
  }

  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const refusedAt = new Map<string, string>();
  const returned = new Set<string>();
  for (const e of ordered) {
    if (e.outcome === "generated") {
      if (refusedAt.has(e.userId)) returned.add(e.userId);
      continue;
    }
    if (e.outcome === "feature_disabled") continue; // our pause, not their refusal
    if (!refusedAt.has(e.userId)) refusedAt.set(e.userId, e.occurredAt);
  }

  const refusedUsers = refusedAt.size;
  return {
    attempts: events.length,
    generated: byOutcome.generated ?? 0,
    byOutcome,
    byReasonCode,
    safetyBlockRate: events.length > 0 ? (byOutcome.safety_blocked ?? 0) / events.length : null,
    refusedUsers,
    refusedUsersWhoReturned: returned.size,
    refusalChurnRate: refusedUsers > 0 ? (refusedUsers - returned.size) / refusedUsers : null,
  };
}

/**
 * Data-sufficiency tier distribution — the brief's own addition, and the
 * metric that decides whether any of the others matter: "tells you whether
 * the diagnostic is reaching anyone."
 */
export function computeTierDistribution(profiles: ProfileSnapshot[]): {
  total: number;
  byTier: Record<number, number>;
  shareAtTier2OrAbove: number | null;
} {
  const byTier: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
  for (const p of profiles) byTier[p.tier] = (byTier[p.tier] ?? 0) + 1;
  const total = profiles.length;
  return {
    total,
    byTier,
    shareAtTier2OrAbove: total > 0 ? (byTier[2] + byTier[3]) / total : null,
  };
}

export interface EmphasisDriftMetrics {
  athletesWithTwoOrMoreRuns: number;
  /** Mean absolute change per dimension between an athlete's consecutive runs. */
  meanAbsoluteDrift: Record<EmphasisKey, number>;
  /** Share of athletes whose vector moved enough to regenerate their block. */
  shareRegenerating: number | null;
}

/**
 * Emphasis-vector drift over time. Rising drift means the diagnostic is
 * learning as data accumulates; drift near zero across the board means it has
 * either converged or is not sensitive to new data, and those two are worth
 * telling apart before anyone celebrates a stable number.
 */
export function computeEmphasisDrift(
  profiles: ProfileSnapshot[],
  regenerateThreshold: number
): EmphasisDriftMetrics {
  const byUser = new Map<string, ProfileSnapshot[]>();
  for (const p of profiles) {
    byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  }

  const totals = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, 0])) as Record<EmphasisKey, number>;
  let pairs = 0;
  let athletes = 0;
  let regenerating = 0;

  for (const runs of byUser.values()) {
    if (runs.length < 2) continue;
    athletes++;
    const ordered = [...runs].sort((a, b) => a.generatedAt.localeCompare(b.generatedAt));
    let userRegenerated = false;
    for (let i = 1; i < ordered.length; i++) {
      pairs++;
      for (const key of EMPHASIS_KEYS) {
        const delta = Math.abs((ordered[i].emphasis[key] ?? 0) - (ordered[i - 1].emphasis[key] ?? 0));
        totals[key] += delta;
        if (delta >= regenerateThreshold) userRegenerated = true;
      }
    }
    if (userRegenerated) regenerating++;
  }

  return {
    athletesWithTwoOrMoreRuns: athletes,
    meanAbsoluteDrift: Object.fromEntries(
      EMPHASIS_KEYS.map((k) => [k, pairs > 0 ? totals[k] / pairs : 0])
    ) as Record<EmphasisKey, number>,
    shareRegenerating: athletes > 0 ? regenerating / athletes : null,
  };
}

export interface InjuryMetrics {
  reports: number;
  attributedToPlan: number;
  bySeverity: Record<string, number>;
  /** The one that stops a rollout. */
  stoppedTrainingOrMedical: number;
}

export function computeInjuryMetrics(reports: InjuryReport[]): InjuryMetrics {
  const bySeverity: Record<string, number> = {};
  for (const r of reports) {
    if (r.severity) bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
  }
  return {
    reports: reports.length,
    attributedToPlan: reports.filter((r) => r.attributedToPlan === true).length,
    bySeverity,
    stoppedTrainingOrMedical: reports.filter(
      (r) => r.severity === "stopped_training" || r.severity === "medical"
    ).length,
  };
}

// ---------------------------------------------------------------------------

export interface MonitoringSnapshot {
  windowDays: number;
  adherence: AdherenceMetrics;
  abandonment: ReturnType<typeof computeAbandonment>;
  acwr: AcwrDistribution;
  refusals: RefusalBreakdown;
  tiers: ReturnType<typeof computeTierDistribution>;
  drift: EmphasisDriftMetrics;
  injuries: InjuryMetrics;
  hardViolationTotal: number;
  /** Conditions that should stop a rollout advancing, stated rather than left for someone to notice. */
  alarms: string[];
}

export function buildMonitoringSnapshot(input: {
  windowDays: number;
  events: GenerationEvent[];
  feedback: FeedbackEvent[];
  profiles: ProfileSnapshot[];
  injuries: InjuryReport[];
  regenerateThreshold: number;
  now?: Date;
}): MonitoringSnapshot {
  const acwr = computeAcwrDistribution(input.events);
  const refusals = computeRefusals(input.events);
  const injuries = computeInjuryMetrics(input.injuries);
  const hardViolationTotal = input.events.reduce((s, e) => s + (e.hardViolations ?? 0), 0);
  const tiers = computeTierDistribution(input.profiles);

  const alarms: string[] = [];
  if (hardViolationTotal > 0) {
    alarms.push(
      `${hardViolationTotal} hard-rule violations across generated plans. The scheduler should make this impossible; ` +
        `a non-zero number here is a defect, not a tuning problem.`
    );
  }
  if (acwr.aboveBlock > 0) {
    alarms.push(
      `${acwr.aboveBlock} plans peaked above the ACWR block ceiling. Enforcement is supposed to cap these before ` +
        `they ship.`
    );
  }
  if (injuries.attributedToPlan > 0) {
    alarms.push(
      `${injuries.attributedToPlan} injury reports attributed to the plan by the athlete. Attribution is not ` +
        `causation, but it stops the rollout advancing until each one has been read.`
    );
  }
  if ((refusals.refusalChurnRate ?? 0) > 0.8 && refusals.refusedUsers >= 10) {
    alarms.push(
      `${Math.round((refusals.refusalChurnRate ?? 0) * 100)}% of refused athletes never came back. A refusal is ` +
        `meant to retain with a next step, not to end the relationship.`
    );
  }
  if (tiers.total >= 20 && (tiers.shareAtTier2OrAbove ?? 0) < 0.2) {
    alarms.push(
      `Only ${Math.round((tiers.shareAtTier2OrAbove ?? 0) * 100)}% of athletes reach tier 2. The diagnostic is ` +
        `barely reaching anyone, which makes every other metric here a measurement of a small unusual group.`
    );
  }

  return {
    windowDays: input.windowDays,
    adherence: computeAdherence(input.feedback),
    abandonment: computeAbandonment(input.events, input.feedback, 14, input.now),
    acwr,
    refusals,
    tiers,
    drift: computeEmphasisDrift(input.profiles, input.regenerateThreshold),
    injuries,
    hardViolationTotal,
    alarms,
  };
}
