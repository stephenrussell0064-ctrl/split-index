import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { planFindingsById } from "./session-set";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { RunLog } from "./types";

/**
 * THE MARKETING CLAIM, PINNED.
 *
 * "Every session in your plan is traceable to a named diagnostic finding"
 * appears in docs/CLAUDE-CODE-BRIEF-hybrid-plan-engine-v2.md as
 * non-negotiable #7, with a Traceability row asserting 100%, and from there
 * it reached the marketing site and a TikTok hook.
 *
 * `scripts/check-post-claims.mjs` exists to stop exactly this — "the specific
 * way this venture loses is by saying a number in public that its own engine
 * contradicts" — but it cannot reach this one. That file is a SOURCE-TEXT
 * SCANNER: `constant()` and `row()` read .ts and .md files as strings and
 * regex values out of them. Traceability is not a constant anywhere. It only
 * exists after running `diagnose()` and `generatePlan()` over an athlete, so
 * it has to be asserted from a test, which is what this is. `npm test` is the
 * gate.
 *
 * To have `check-post-claims.mjs` cover it under one command too, shell out
 * rather than trying to regex it — three lines, no new dependency:
 *
 *     import { spawnSync } from 'node:child_process';
 *     const r = spawnSync('npx', ['vitest', 'run', 'src/lib/scoring/hpe/traceability-claim.test.ts'], { cwd: ROOT });
 *     if (r.status !== 0) fail('traceability', 'the "every session" claim no longer matches the engine');
 *
 * What the engine actually guarantees, and what it does not:
 *
 *   WEAK CLAIM  — every session resolves to a named, readable reason.
 *                 TRUE, and enforced by the NOT NULL foreign key on
 *                 hpe_sessions.finding_id. Safe to say in public.
 *   STRONG CLAIM— every session is traceable to a diagnostic finding ABOUT
 *                 THIS ATHLETE. FALSE. Where no finding backs a session's
 *                 emphasis dimension, the engine attributes it to
 *                 `hybrid-baseline`, whose own text reads "This session is
 *                 not answering a specific finding about you."
 *
 * A complete beginner is the case that breaks a hook: a valid plan in which
 * EVERY session says that. These tests fail if the copy is ever strengthened
 * back to the absolute form — and they also fail if finding coverage widens
 * enough to make the strong claim true, which is the good direction and
 * should come with a deliberate copy change rather than silently.
 */

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: {}, predicted5kS: 1400, predicted5kFromEffort: true,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 3, enduranceTrainingYears: 3,
    currentRunMinPerWeek: 120, currentStrengthSessionsPerWeek: 2,
    chronicLoad: 300, restingHr: 55, maxHr: 188,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  } as AthleteState;
}

function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    enduranceEventKm: null, enduranceEventKey: null,
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  } as Goal;
}

function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 6, maxHoursPerWeek: 8,
    maxSessionMin: 90, minRestDays: 1,
    trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  } as Constraints;
}

/** The persona from personas.test.ts: no runs, no lifts, no 1RMs. */
function beginnerPlan() {
  const profile = diagnose([], [], {}, { priority: 0.5, hrMax: 195, hrRest: 70 });
  const plan = generatePlan({
    state: state({ currentRunMinPerWeek: 0, strengthTrainingYears: 0, enduranceTrainingYears: 0, strengthTrainingAge: "novice", enduranceTrainingAge: "novice" }),
    goal: goal({ horizonSource: "suggested" }),
    constraints: constraints(),
    profile,
  });
  const sessions = plan.weeks.flatMap((w) => w.sessions);
  return { profile, plan, sessions };
}

describe("what the traceability claim may say in public", () => {
  it("a beginner gets a real plan, so this is not a hypothetical athlete", () => {
    const { plan, profile, sessions } = beginnerPlan();
    expect(plan.generated, "a beginner must still get a plan — that is non-negotiable #9").toBe(true);
    expect(sessions.length).toBeGreaterThan(0);
    // The premise of everything below: the diagnosis found nothing about them.
    expect(profile.findings).toHaveLength(0);
  });

  it("WEAK CLAIM HOLDS — every session resolves to a named, readable reason", () => {
    const { profile, sessions } = beginnerPlan();
    const byId = planFindingsById(profile.findings);
    for (const s of sessions) {
      const finding = byId.get(s.findingId);
      expect(finding, `${s.kind} cited unresolvable finding ${s.findingId}`).toBeDefined();
      expect(finding!.text, `${s.kind} cited an empty finding`).toMatch(/\S/);
    }
  });

  it("STRONG CLAIM FAILS — every one of a beginner's sessions is baseline, not a finding about them", () => {
    const { sessions } = beginnerPlan();
    const baseline = sessions.filter((s) => s.findingId === "hybrid-baseline");

    /*
      If this ever stops being ALL of them, finding coverage has widened and
      the public claim can legitimately get stronger — but that is a copy
      decision, so it should break a test rather than drift quietly. Widen
      FINDINGS_BY_EMPHASIS in session-set.ts and update the marketing line
      together.
    */
    expect(
      baseline.length,
      `${baseline.length}/${sessions.length} of a beginner's sessions are baseline-attributed. ` +
        `While this is all of them, "every session is traceable to a named diagnostic finding" is false in public.`
    ).toBe(sessions.length);
  });

  it("the baseline text says plainly that it is not about the athlete", () => {
    // This sentence is what a beginner reads under every card. It is the
    // reason the strong claim cannot be defended by pointing at the screen.
    const { profile } = beginnerPlan();
    const baseline = planFindingsById(profile.findings).get("hybrid-baseline")!;
    expect(baseline.text).toMatch(/not answering a specific finding about you/i);
  });

  it("a well-logged athlete does better, which is why the claim is tempting", () => {
    /*
      Contrast case, so the failure above cannot be dismissed as "the engine
      never attributes anything to anyone". This is the marathon runner from
      personas.test.ts.

      The two `isMaxEffort` runs are what make it work, and they are the whole
      point: without a max effort there is no predicted 5k, so no Riegel
      exponent, so no findings at all. Attribution is a function of what the
      athlete has logged, which is exactly why an absolute public claim about
      it cannot hold.
    */
    const log: RunLog[] = [
      ...Array.from({ length: 36 }, (_, i) => ({ dateIdx: i * 3, distanceKm: 12, durationS: 12 * 300, avgHr: 150 })),
      { dateIdx: 10, distanceKm: 21.1, durationS: 5400, avgHr: 172, isMaxEffort: true },
      { dateIdx: 60, distanceKm: 10, durationS: 2400, avgHr: 175, isMaxEffort: true },
    ];
    const profile = diagnose(log, [], {}, { priority: 0.1, hrMax: 186, hrRest: 48 });
    expect(profile.findings.length, "the contrast case needs findings to contrast with").toBeGreaterThan(0);
  });
});
