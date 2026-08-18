/**
 * Hybrid Plan Engine — WP10: kill switch and phased rollout.
 *
 * Two separate controls that are easy to conflate and must not be:
 *
 *  - The KILL SWITCH (`enabled: false`) stops NEW plans being generated. It
 *    deliberately leaves existing plans readable. An athlete three weeks into
 *    a block should not lose the plan they are following because we paused
 *    generation — pausing is not the same as recalling, and treating them the
 *    same turns a cautious operator action into an outage for every user.
 *
 *  - The ROLLOUT DIAL (`rolloutPercentage`) decides who is eligible in the
 *    first place. Deterministic per user, so an athlete inside the rollout
 *    stays inside it as the percentage rises. A random draw per request would
 *    give someone a plan on Monday and take it away on Tuesday, which is
 *    worse than never having offered it.
 *
 * `evaluateAccess` is pure so both behaviours are testable without a
 * database, which is what makes "test the kill switch" a real test rather
 * than a manual click-through.
 */

/** Stable 32-bit hash. FNV-1a — fast, no dependencies, and well-distributed enough for bucketing. */
export function hashUserId(userId: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < userId.length; i++) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Which 0-99 bucket a user falls in. Stable for the life of the account. */
export function rolloutBucket(userId: string): number {
  return hashUserId(userId) % 100;
}

export interface FeatureFlag {
  key: string;
  enabled: boolean;
  rolloutPercentage: number;
  note: string | null;
  updatedAt: string | null;
}

export type AccessDenialReason = "kill_switch" | "not_in_rollout";

export interface AccessDecision {
  /** May this user generate a NEW plan? */
  canGenerate: boolean;
  /** May they read a plan they already have? Always true — see the module note. */
  canReadExisting: boolean;
  reason: AccessDenialReason | null;
  /** What the athlete is told. Never "something went wrong" — an intentional pause should read as intentional. */
  message: string | null;
  bucket: number;
}

export function evaluateAccess(flag: FeatureFlag | null, userId: string): AccessDecision {
  const bucket = rolloutBucket(userId);

  // A missing flag row is treated as OFF, not as ON. A feature that switches
  // itself on when its configuration cannot be read is a feature with no kill
  // switch at all.
  if (!flag || !flag.enabled) {
    return {
      canGenerate: false,
      canReadExisting: true,
      reason: "kill_switch",
      message:
        flag?.note?.trim() ||
        "New plan generation is paused while we check something. Any plan you already have is unaffected — keep " +
          "training it, and this will come back on without you needing to do anything.",
      bucket,
    };
  }

  if (bucket >= flag.rolloutPercentage) {
    return {
      canGenerate: false,
      canReadExisting: true,
      reason: "not_in_rollout",
      message:
        "The hybrid plan builder is rolling out gradually and has not reached your account yet. Everything else in " +
        "Split Index works as normal in the meantime.",
      bucket,
    };
  }

  return { canGenerate: true, canReadExisting: true, reason: null, message: null, bucket };
}

/**
 * The rollout stages. Each one is a deliberate stop rather than a step on a
 * timer: the point of a phased rollout is that somebody looks at the
 * dashboard between stages and decides whether to continue.
 */
export const ROLLOUT_STAGES: readonly { percentage: number; label: string; gate: string }[] = [
  {
    percentage: 0,
    label: "Off",
    gate: "Default state on deploy. Nothing generates.",
  },
  {
    percentage: 1,
    label: "Internal",
    gate: "Staff accounts only. Read every generated plan end to end before advancing.",
  },
  {
    percentage: 5,
    label: "Pilot",
    gate:
      "Advance only when: zero hard-rule violations across all generated plans, zero injury reports attributed to " +
      "the plan, and at least ten plans reviewed against the section 5 prescribing rubric.",
  },
  {
    percentage: 25,
    label: "Quarter",
    gate:
      "Advance only when adherence is stable, plan abandonment is below the app's existing training-plan baseline, " +
      "and the ACWR distribution shows no week above the block ceiling.",
  },
  {
    percentage: 100,
    label: "Full",
    gate: "Advance only after a full review cycle at 25% with no Critical or Major findings raised.",
  },
] as const;

/** The next stage up from the current percentage, or null at full rollout. */
/**
 * Where the fleet view's "Resume" lands when there is no prior exposure to
 * return to.
 *
 * A rollout paused at 0% — the state every deploy starts in — has nothing to
 * resume TO, and resuming to 0% would report success while changing nothing.
 * The smallest real stage is the honest floor: it turns generation back on
 * without restoring an exposure nobody chose.
 */
export const SAFE_RESUME_PERCENTAGE = 5;

export function nextRolloutStage(current: number): (typeof ROLLOUT_STAGES)[number] | null {
  return ROLLOUT_STAGES.find((s) => s.percentage > current) ?? null;
}

// ---------------------------------------------------------------------------
// The fleet-review gate
// ---------------------------------------------------------------------------

/**
 * How recently the fleet dashboard must have been looked at for a rollout
 * raise to be allowed. [ASSURED] — a review from last month is not a review of
 * the state you are about to expose people to.
 */
export const FLEET_REVIEW_MAX_AGE_HOURS = 24;

export interface FleetReviewState {
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** Alarms showing at that review. A review taken while the dashboard was alarming does not clear the gate. */
  alarmCount: number | null;
}

export interface RolloutChangeRequest {
  currentEnabled: boolean;
  currentPercentage: number;
  nextEnabled: boolean;
  nextPercentage: number;
}

export interface RolloutGateDecision {
  allowed: boolean;
  reason: string | null;
  /** True when the change reduces exposure — always permitted, never gated. */
  isDeEscalation: boolean;
}

/**
 * The gate the brief asks for: the fleet view "is the view the kill-switch
 * decision is made from, so it is a prerequisite for any rollout above 0%".
 *
 * The asymmetry is the important part and mirrors the kill switch itself:
 *
 *  - ANY change that REDUCES exposure — disabling, or lowering the percentage
 *    — is always allowed, immediately, with no review required. Making it
 *    harder to turn something off than to turn it on is how a bad rollout
 *    stays live while somebody hunts for a dashboard.
 *  - Any change that INCREASES exposure above 0% requires a recent fleet
 *    review that was itself clean. Alarming dashboards do not clear gates.
 *
 * Pure so the whole gate is testable without a database — which is what makes
 * "review required" a property of the system rather than a note in a runbook.
 */
export function evaluateRolloutChange(
  request: RolloutChangeRequest,
  review: FleetReviewState,
  now: Date = new Date()
): RolloutGateDecision {
  const currentExposure = request.currentEnabled ? request.currentPercentage : 0;
  const nextExposure = request.nextEnabled ? request.nextPercentage : 0;

  if (nextExposure <= currentExposure) {
    return {
      allowed: true,
      reason: null,
      isDeEscalation: nextExposure < currentExposure,
    };
  }

  // Raising exposure to nothing is not raising exposure.
  if (nextExposure === 0) return { allowed: true, reason: null, isDeEscalation: false };

  if (!review.reviewedAt) {
    return {
      allowed: false,
      isDeEscalation: false,
      reason:
        "The fleet operations view has never been reviewed. It is the view this decision is made from, so no " +
        "rollout above 0% is permitted until somebody has read it.",
    };
  }

  const ageHours = (now.getTime() - new Date(review.reviewedAt).getTime()) / 3_600_000;
  if (!Number.isFinite(ageHours) || ageHours > FLEET_REVIEW_MAX_AGE_HOURS) {
    return {
      allowed: false,
      isDeEscalation: false,
      reason:
        `The last fleet review was ${Math.round(ageHours)} hours ago and reviews expire after ` +
        `${FLEET_REVIEW_MAX_AGE_HOURS}. Open the fleet view again before raising exposure — a review of last week's ` +
        `state is not a review of what you are about to expose people to.`,
    };
  }

  if ((review.alarmCount ?? 0) > 0) {
    return {
      allowed: false,
      isDeEscalation: false,
      reason:
        `The last fleet review was showing ${review.alarmCount} alarm${review.alarmCount === 1 ? "" : "s"}. ` +
        `Clear them and review again. Advancing a rollout past a live alarm is the decision this gate exists to ` +
        `stop, and every alarm on that dashboard is one the engine believes should be impossible.`,
    };
  }

  return { allowed: true, reason: null, isDeEscalation: false };
}
