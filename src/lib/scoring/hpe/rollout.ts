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
export function nextRolloutStage(current: number): (typeof ROLLOUT_STAGES)[number] | null {
  return ROLLOUT_STAGES.find((s) => s.percentage > current) ?? null;
}
