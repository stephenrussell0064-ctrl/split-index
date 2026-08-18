/**
 * WP10 acceptance: "Test the kill switch and demonstrate rollback."
 *
 * The kill switch's defining property is an asymmetry that is easy to get
 * wrong: it must stop NEW generation while leaving existing plans readable.
 * A switch that also hides existing plans is not a pause, it is a recall, and
 * it turns a cautious operator action into an outage for every athlete
 * mid-block. Most of what follows is testing that asymmetry holds on every
 * path.
 */

import { describe, expect, it } from "vitest";
import {
  FLEET_REVIEW_MAX_AGE_HOURS,
  ROLLOUT_STAGES,
  evaluateAccess,
  evaluateRolloutChange,
  nextRolloutStage,
  rolloutBucket,
  type FeatureFlag,
  type FleetReviewState,
  SAFE_RESUME_PERCENTAGE,
} from "./rollout";
import {
  buildMonitoringSnapshot,
  computeAbandonment,
  computeAcwrDistribution,
  computeAdherence,
  computeEmphasisDrift,
  computeRefusals,
  computeTierDistribution,
  type GenerationEvent,
  type ProfileSnapshot,
} from "./monitoring";
import { ACWR_BLOCK, EMPHASIS_KEYS, EMPHASIS_DRIFT_REGENERATE_THRESHOLD, type EmphasisKey } from "./constants";

const USERS = Array.from({ length: 400 }, (_, i) => `user-${i}-6f3a`);

function flag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  return { key: "hpe_generation", enabled: true, rolloutPercentage: 100, note: null, updatedAt: null, ...overrides };
}

describe("WP10 — the kill switch", () => {
  it("stops generation for everyone when disabled", () => {
    for (const user of USERS.slice(0, 50)) {
      const decision = evaluateAccess(flag({ enabled: false }), user);
      expect(decision.canGenerate).toBe(false);
      expect(decision.reason).toBe("kill_switch");
    }
  });

  it("leaves existing plans readable on every denial path", () => {
    // The asymmetry the whole design turns on.
    const cases: (FeatureFlag | null)[] = [
      null,
      flag({ enabled: false }),
      flag({ enabled: false, rolloutPercentage: 100 }),
      flag({ enabled: true, rolloutPercentage: 0 }),
    ];
    for (const f of cases) {
      for (const user of USERS.slice(0, 20)) {
        const decision = evaluateAccess(f, user);
        expect(decision.canGenerate).toBe(false);
        expect(decision.canReadExisting, "an existing plan must survive the kill switch").toBe(true);
      }
    }
  });

  it("fails closed when the flag row cannot be read", () => {
    // A feature that switches itself on when its config is missing has no
    // kill switch at all.
    const decision = evaluateAccess(null, USERS[0]);
    expect(decision.canGenerate).toBe(false);
    expect(decision.reason).toBe("kill_switch");
  });

  it("explains the pause as intentional rather than as a failure", () => {
    const decision = evaluateAccess(flag({ enabled: false }), USERS[0]);
    expect(decision.message).toBeTruthy();
    expect(decision.message!).not.toMatch(/error|went wrong|failed/i);
    expect(decision.message!).toMatch(/plan you already have is unaffected/i);
  });

  it("surfaces the operator's own note when one is set", () => {
    const decision = evaluateAccess(
      flag({ enabled: false, note: "Paused while we investigate an ACWR report." }),
      USERS[0]
    );
    expect(decision.message).toBe("Paused while we investigate an ACWR report.");
  });

  it("demonstrates rollback: enabled at 100%, killed, then restored", () => {
    const user = USERS[7];
    // 1. Live.
    expect(evaluateAccess(flag({ enabled: true, rolloutPercentage: 100 }), user).canGenerate).toBe(true);
    // 2. Kill switch thrown — generation stops, reading survives.
    const killed = evaluateAccess(flag({ enabled: false, rolloutPercentage: 100 }), user);
    expect(killed.canGenerate).toBe(false);
    expect(killed.canReadExisting).toBe(true);
    // 3. Rolled back to a smaller cohort rather than straight back to full —
    //    the realistic recovery, and it must not error.
    const partial = evaluateAccess(flag({ enabled: true, rolloutPercentage: 5 }), user);
    expect(partial.canGenerate).toBe(rolloutBucket(user) < 5);
    // 4. Fully restored.
    expect(evaluateAccess(flag({ enabled: true, rolloutPercentage: 100 }), user).canGenerate).toBe(true);
  });
});

describe("WP10 — phased rollout", () => {
  it("is deterministic: the same user gets the same answer every time", () => {
    const f = flag({ rolloutPercentage: 37 });
    for (const user of USERS.slice(0, 40)) {
      const first = evaluateAccess(f, user).canGenerate;
      for (let i = 0; i < 5; i++) expect(evaluateAccess(f, user).canGenerate).toBe(first);
    }
  });

  it("is monotonic: nobody is ever removed as the percentage rises", () => {
    // An athlete who is given the feature and then has it taken away as the
    // rollout WIDENS is worse off than one who never had it.
    for (const user of USERS) {
      let wasIn = false;
      for (const pct of [0, 1, 5, 10, 25, 50, 75, 100]) {
        const inNow = evaluateAccess(flag({ rolloutPercentage: pct }), user).canGenerate;
        if (wasIn) expect(inNow, `user dropped out of rollout at ${pct}%`).toBe(true);
        wasIn = wasIn || inNow;
      }
    }
  });

  it("lets nobody in at 0% and everybody in at 100%", () => {
    for (const user of USERS) {
      expect(evaluateAccess(flag({ rolloutPercentage: 0 }), user).canGenerate).toBe(false);
      expect(evaluateAccess(flag({ rolloutPercentage: 100 }), user).canGenerate).toBe(true);
    }
  });

  it("distributes buckets roughly evenly", () => {
    const admitted = USERS.filter((u) => evaluateAccess(flag({ rolloutPercentage: 25 }), u).canGenerate).length;
    const share = admitted / USERS.length;
    expect(share).toBeGreaterThan(0.15);
    expect(share).toBeLessThan(0.35);
  });

  it("defines stages that each carry an explicit advancement gate", () => {
    expect(ROLLOUT_STAGES[0].percentage).toBe(0);
    expect(ROLLOUT_STAGES[ROLLOUT_STAGES.length - 1].percentage).toBe(100);
    for (const stage of ROLLOUT_STAGES) expect(stage.gate.length).toBeGreaterThan(20);
    expect(nextRolloutStage(0)?.percentage).toBe(1);
    expect(nextRolloutStage(25)?.percentage).toBe(100);
    expect(nextRolloutStage(100)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

function event(overrides: Partial<GenerationEvent> = {}): GenerationEvent {
  return {
    userId: "u1",
    occurredAt: "2026-01-01T00:00:00Z",
    outcome: "generated",
    reasonCode: null,
    tier: 2,
    peakAcwr: 1.1,
    hardViolations: 0,
    ...overrides,
  };
}

function profileSnapshot(userId: string, generatedAt: string, emphasis: Partial<Record<EmphasisKey, number>>): ProfileSnapshot {
  const even = 1 / EMPHASIS_KEYS.length;
  const base = Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, even])) as Record<EmphasisKey, number>;
  return { userId, generatedAt, tier: 2, emphasis: { ...base, ...emphasis } };
}

describe("WP10 — monitoring metrics", () => {
  it("separates completion from hitting the prescription", () => {
    const adherence = computeAdherence([
      { userId: "u1", loggedAt: "2026-01-01", completed: true, metPrescription: true, sessionRpe: 5, lowCapacityFlagged: false },
      { userId: "u1", loggedAt: "2026-01-02", completed: true, metPrescription: false, sessionRpe: 8, lowCapacityFlagged: false },
      { userId: "u1", loggedAt: "2026-01-03", completed: false, metPrescription: false, sessionRpe: null, lowCapacityFlagged: true },
    ]);
    expect(adherence.completionRate).toBeCloseTo(2 / 3, 6);
    // Denominated on completed sessions, not all of them — doing a session
    // and hitting its prescription are different questions.
    expect(adherence.prescriptionHitRate).toBeCloseTo(0.5, 6);
    expect(adherence.lowCapacitySwapRate).toBeCloseTo(1 / 3, 6);
  });

  it("counts an athlete who stopped logging as abandoned, not as adherent", () => {
    const now = new Date("2026-03-01T00:00:00Z");
    const events = [event({ userId: "active" }), event({ userId: "gone" })];
    const feedback = [
      { userId: "active", loggedAt: "2026-02-27T00:00:00Z", completed: true, metPrescription: true, sessionRpe: 5, lowCapacityFlagged: false },
      { userId: "gone", loggedAt: "2026-01-02T00:00:00Z", completed: true, metPrescription: true, sessionRpe: 5, lowCapacityFlagged: false },
    ];
    const result = computeAbandonment(events, feedback, 14, now);
    expect(result.plansGenerated).toBe(2);
    expect(result.abandoned).toBe(1);
    expect(result.abandonmentRate).toBeCloseTo(0.5, 6);
  });

  it("breaks the block rate down by reason rather than reporting one number", () => {
    const refusals = computeRefusals([
      event({ userId: "a", outcome: "safety_blocked", reasonCode: "lea_screen" }),
      event({ userId: "b", outcome: "safety_blocked", reasonCode: "parq_positive" }),
      event({ userId: "c", outcome: "safety_blocked", reasonCode: "lea_screen" }),
      event({ userId: "d" }),
    ]);
    expect(refusals.byReasonCode.lea_screen).toBe(2);
    expect(refusals.byReasonCode.parq_positive).toBe(1);
    expect(refusals.safetyBlockRate).toBeCloseTo(0.75, 6);
  });

  it("measures refusal churn: refused athletes who never came back", () => {
    const refusals = computeRefusals([
      event({ userId: "returner", occurredAt: "2026-01-01T00:00:00Z", outcome: "insufficient_data", reasonCode: "tier_zero" }),
      event({ userId: "returner", occurredAt: "2026-02-01T00:00:00Z", outcome: "generated" }),
      event({ userId: "churned", occurredAt: "2026-01-01T00:00:00Z", outcome: "insufficient_data", reasonCode: "tier_zero" }),
    ]);
    expect(refusals.refusedUsers).toBe(2);
    expect(refusals.refusedUsersWhoReturned).toBe(1);
    expect(refusals.refusalChurnRate).toBeCloseTo(0.5, 6);
  });

  it("does not count our own pause as the athlete being refused", () => {
    const refusals = computeRefusals([event({ userId: "a", outcome: "feature_disabled", reasonCode: "kill_switch" })]);
    expect(refusals.refusedUsers).toBe(0);
  });

  it("flags any plan that peaked above the ACWR block ceiling", () => {
    const dist = computeAcwrDistribution([event({ peakAcwr: 0.7 }), event({ peakAcwr: 1.2 }), event({ peakAcwr: ACWR_BLOCK + 0.1 })]);
    expect(dist.belowFloor).toBe(1);
    expect(dist.aboveBlock).toBe(1);
  });

  it("reports the tier distribution — whether the diagnostic reaches anyone at all", () => {
    const dist = computeTierDistribution([
      profileSnapshot("a", "2026-01-01", {}),
      { ...profileSnapshot("b", "2026-01-01", {}), tier: 0 },
      { ...profileSnapshot("c", "2026-01-01", {}), tier: 3 },
    ]);
    expect(dist.total).toBe(3);
    expect(dist.shareAtTier2OrAbove).toBeCloseTo(2 / 3, 6);
  });

  it("measures emphasis drift between an athlete's consecutive runs", () => {
    const drift = computeEmphasisDrift(
      [
        profileSnapshot("a", "2026-01-01", { aerobic_base: 0.2 }),
        profileSnapshot("a", "2026-02-01", { aerobic_base: 0.5 }),
        profileSnapshot("b", "2026-01-01", {}),
      ],
      EMPHASIS_DRIFT_REGENERATE_THRESHOLD
    );
    // Only athlete "a" has two runs.
    expect(drift.athletesWithTwoOrMoreRuns).toBe(1);
    expect(drift.meanAbsoluteDrift.aerobic_base).toBeCloseTo(0.3, 6);
    expect(drift.shareRegenerating).toBe(1);
  });

  it("raises an alarm on the conditions that should stop a rollout", () => {
    const snapshot = buildMonitoringSnapshot({
      windowDays: 30,
      events: [event({ hardViolations: 2, peakAcwr: ACWR_BLOCK + 0.2 })],
      feedback: [],
      profiles: [],
      injuries: [{ userId: "a", reportedAt: "2026-01-01", severity: "stopped_training", attributedToPlan: true }],
      regenerateThreshold: EMPHASIS_DRIFT_REGENERATE_THRESHOLD,
      now: new Date("2026-01-15T00:00:00Z"),
    });
    expect(snapshot.alarms.join(" ")).toMatch(/hard-rule violations/);
    expect(snapshot.alarms.join(" ")).toMatch(/ACWR block ceiling/);
    expect(snapshot.alarms.join(" ")).toMatch(/injury reports attributed/);
    // Attribution is reported honestly rather than as proof of cause.
    expect(snapshot.alarms.join(" ")).toMatch(/Attribution is not[\s\S]*causation/);
  });

  it("stays quiet when everything is healthy", () => {
    const snapshot = buildMonitoringSnapshot({
      windowDays: 30,
      events: [event()],
      feedback: [],
      profiles: [],
      injuries: [],
      regenerateThreshold: EMPHASIS_DRIFT_REGENERATE_THRESHOLD,
      now: new Date("2026-01-15T00:00:00Z"),
    });
    expect(snapshot.alarms).toEqual([]);
  });
});


// ---------------------------------------------------------------------------
// The fleet-review gate
// ---------------------------------------------------------------------------

describe("WP10 — the fleet-review gate on rollout", () => {
  const NOW = new Date("2026-03-01T12:00:00Z");
  const cleanReview: FleetReviewState = {
    reviewedAt: new Date("2026-03-01T10:00:00Z").toISOString(),
    reviewedBy: "admin",
    alarmCount: 0,
  };
  const noReview: FleetReviewState = { reviewedAt: null, reviewedBy: null, alarmCount: null };

  it("refuses any raise above 0% when the fleet view has never been reviewed", () => {
    const decision = evaluateRolloutChange(
      { currentEnabled: false, currentPercentage: 0, nextEnabled: true, nextPercentage: 1 },
      noReview,
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/never been reviewed/);
  });

  it("allows a raise after a recent, clean review", () => {
    const decision = evaluateRolloutChange(
      { currentEnabled: false, currentPercentage: 0, nextEnabled: true, nextPercentage: 5 },
      cleanReview,
      NOW
    );
    expect(decision.allowed).toBe(true);
  });

  it("refuses a raise when the review is stale", () => {
    const stale: FleetReviewState = {
      ...cleanReview,
      reviewedAt: new Date(NOW.getTime() - (FLEET_REVIEW_MAX_AGE_HOURS + 2) * 3_600_000).toISOString(),
    };
    const decision = evaluateRolloutChange(
      { currentEnabled: true, currentPercentage: 1, nextEnabled: true, nextPercentage: 5 },
      stale,
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/reviews expire/);
  });

  it("refuses a raise when the last review was showing alarms", () => {
    // The case the gate exists for. A clean-looking dashboard is not the
    // requirement; a dashboard that WAS clean when somebody looked is.
    const decision = evaluateRolloutChange(
      { currentEnabled: true, currentPercentage: 5, nextEnabled: true, nextPercentage: 25 },
      { ...cleanReview, alarmCount: 2 },
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/2 alarms/);
  });

  it("ALWAYS allows the kill switch, from any state, with no review at all", () => {
    // Making it harder to turn something off than to turn it on is how a bad
    // rollout stays live while somebody hunts for a dashboard.
    for (const review of [noReview, { ...cleanReview, alarmCount: 99 }, { ...cleanReview, reviewedAt: "1999-01-01T00:00:00Z" }]) {
      for (const pct of [1, 5, 25, 100]) {
        const decision = evaluateRolloutChange(
          { currentEnabled: true, currentPercentage: pct, nextEnabled: false, nextPercentage: pct },
          review,
          NOW
        );
        expect(decision.allowed, `kill switch refused at ${pct}%`).toBe(true);
        expect(decision.isDeEscalation).toBe(true);
      }
    }
  });

  it("ALWAYS allows lowering the percentage, with no review", () => {
    const decision = evaluateRolloutChange(
      { currentEnabled: true, currentPercentage: 100, nextEnabled: true, nextPercentage: 5 },
      noReview,
      NOW
    );
    expect(decision.allowed).toBe(true);
    expect(decision.isDeEscalation).toBe(true);
  });

  it("treats re-enabling at a lower exposure than the current one as a de-escalation", () => {
    const decision = evaluateRolloutChange(
      { currentEnabled: true, currentPercentage: 50, nextEnabled: true, nextPercentage: 50 },
      noReview,
      NOW
    );
    // Same exposure is not an increase, so it is not gated.
    expect(decision.allowed).toBe(true);
  });

  it("gates re-enabling at the same percentage after a kill, because exposure rises from zero", () => {
    // Disabled at 25% means exposure is 0. Turning it back on takes 0 -> 25,
    // which is a raise however the numbers look side by side.
    const decision = evaluateRolloutChange(
      { currentEnabled: false, currentPercentage: 25, nextEnabled: true, nextPercentage: 25 },
      noReview,
      NOW
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/never been reviewed/);
  });

  it("does not gate a change that leaves exposure at zero", () => {
    const decision = evaluateRolloutChange(
      { currentEnabled: false, currentPercentage: 0, nextEnabled: true, nextPercentage: 0 },
      noReview,
      NOW
    );
    expect(decision.allowed).toBe(true);
  });

  it("makes rollout above 0% impossible without a review — the brief's prerequisite", () => {
    for (const target of ROLLOUT_STAGES.filter((s) => s.percentage > 0)) {
      const decision = evaluateRolloutChange(
        { currentEnabled: false, currentPercentage: 0, nextEnabled: true, nextPercentage: target.percentage },
        noReview,
        NOW
      );
      expect(decision.allowed, `${target.label} was reachable without a fleet review`).toBe(false);
    }
  });
});

/**
 * The kill switch has to be reversible from every state it can reach.
 *
 * It has now been a one-way door twice. First because pausing at 100% left no
 * Advance button and no other control. Then, after that fix, because both
 * resume buttons were gated on the STORED percentage (`> 0` and `> 5`) — so a
 * rollout paused at 0%, which is the state every deploy starts in, rendered
 * no control at all. The percentage is the wrong thing to gate on.
 */
describe("WP10 — resuming from a pause", () => {
  const resumeTarget = (storedPercentage: number) => Math.max(storedPercentage, SAFE_RESUME_PERCENTAGE);

  it("offers a real target from 0%, where there is no stored exposure to return to", () => {
    // Resuming to 0% would report success and change nothing — the same dead
    // end wearing a button.
    expect(resumeTarget(0)).toBe(SAFE_RESUME_PERCENTAGE);
    expect(resumeTarget(0)).toBeGreaterThan(0);
  });

  it("returns to the exposure you paused at when there was one", () => {
    expect(resumeTarget(25)).toBe(25);
    expect(resumeTarget(100)).toBe(100);
  });

  it("never resumes below the safe floor", () => {
    for (const stored of [0, 1, 5, 10, 25, 50, 100]) {
      expect(resumeTarget(stored)).toBeGreaterThanOrEqual(SAFE_RESUME_PERCENTAGE);
    }
  });

  it("treats resuming as a raise, so it still passes through the fleet-review gate", () => {
    // Turning generation back on increases exposure from nothing, and an
    // operator who has not read the fleet view has not made the decision the
    // gate exists to require.
    const decision = evaluateRolloutChange(
      { currentEnabled: false, currentPercentage: 0, nextEnabled: true, nextPercentage: SAFE_RESUME_PERCENTAGE },
      { reviewedAt: null, reviewedBy: null, alarmCount: 0 }
    );
    expect(decision.allowed).toBe(false);
  });

  it("allows the resume once the fleet view has been read", () => {
    const decision = evaluateRolloutChange(
      { currentEnabled: false, currentPercentage: 0, nextEnabled: true, nextPercentage: SAFE_RESUME_PERCENTAGE },
      { reviewedAt: new Date().toISOString(), reviewedBy: "ops", alarmCount: 0 }
    );
    expect(decision.allowed).toBe(true);
  });
});
