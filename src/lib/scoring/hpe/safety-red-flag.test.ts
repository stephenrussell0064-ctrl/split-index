import { describe, expect, it } from "vitest";
import { safetyScreen } from "./safety";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Goal } from "./intake";

/**
 * THE ONE THING ON THE HEALTH FORM THAT IS NOT A TRAINING QUESTION.
 *
 * The plan screen used to render `advisories`, `warnings` and `referrals` as
 * two full cards above the block. They were removed on purpose: for most
 * athletes both fired on answers nobody had given, because `injuryLast12Weeks`
 * and `surgeryLast6Months` resolve to true until answered.
 *
 * Removing them also removed the only place the cardiac referral reached a
 * human. `safetyScreen` went on generating "GP / sports physician" for someone
 * reporting exertional chest pain, and the UI showed it to nobody — a
 * regression nothing caught, because the existing test asserts only that the
 * function RETURNS a referral, never that anything renders one.
 *
 * `medicalRedFlag` exists so the banner can key off a structured field rather
 * than string-matching an advisories array, and this file pins the two
 * properties that make it safe to render alone: it fires for the cardiac
 * answers, and it fires for nothing else.
 */

function state(overrides: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 80,
    heightCm: 180,
    age: 30,
    sex: "male",
    oneRms: { squat: 140, bench: 100, deadlift: 180 },
    predicted5kS: 20 * 60,
    strengthTrainingAge: "intermediate",
    enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 4,
    enduranceTrainingYears: 3,
    currentRunMinPerWeek: 90,
    currentStrengthSessionsPerWeek: 3,
    chronicLoad: 400,
    restingHr: 55,
    maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [],
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 16,
    horizonSource: "event_date",
    target5kS: 19 * 60,
    enduranceEventKm: 5,
    enduranceEventKey: "5k",
    targetSquatKg: 160,
    targetBenchKg: 120,
    targetDeadliftKg: 200,
    targetTotalKg: 480,
    sameDay: false,
    priority: 0.5,
    interEventGapH: 0,
    weightClassKg: null,
    eventOrderKnown: false,
    ...overrides,
  };
}

const flags = (over: Partial<AthleteState["safety"]>) => ({
  ...DEFAULT_SAFETY_FLAGS,
  injuryLast12Weeks: false,
  surgeryLast6Months: false,
  ...over,
});

describe("medicalRedFlag — the cardiac banner's only input", () => {
  it("fires on exertional chest pain, and names who to see", () => {
    const screen = safetyScreen(state({ safety: flags({ chestPainOnExertion: true }) }), goal());
    expect(screen.medicalRedFlag).not.toBeNull();
    expect(screen.medicalRedFlag!.message).toMatch(/chest pain/i);
    expect(screen.medicalRedFlag!.referral).toMatch(/GP|physician/i);
  });

  it("fires on a positive PAR-Q+", () => {
    const screen = safetyScreen(state({ safety: flags({ parqPositive: true }) }), goal());
    expect(screen.medicalRedFlag).not.toBeNull();
  });

  it("is null for an athlete who flagged nothing", () => {
    expect(safetyScreen(state(), goal()).medicalRedFlag).toBeNull();
  });

  /*
    The whole point of the banner being narrow. Each of these still shapes the
    block through `intensityCeiling` / `rampMultiplier`, and each of them used
    to put a card on the screen. None of them may put this one there — a
    banner that also fires for an unanswered injury question is the wall of
    caveats it replaced.
  */
  it.each([
    ["a current limiting injury", { currentInjuryLimiting: true }],
    ["an injury in the last 12 weeks", { injuryLast12Weeks: true }],
    ["surgery in the last 6 months", { surgeryLast6Months: true }],
    ["two low-energy-availability flags", { leaRiskFlags: 2, leaScreenAnswered: true }],
    ["medication affecting heart rate", { medicationAffectingHr: true }],
    ["an intended weight cut", { intendsWeightCut: true }],
  ])("stays null for %s", (_label, over) => {
    const screen = safetyScreen(state({ safety: flags(over) }), goal({ sameDay: true }));
    expect(screen.medicalRedFlag).toBeNull();
  });

  it("stays null for an athlete who has answered nothing at all", () => {
    // The exact case the two removed cards got wrong: every conservative
    // default resolves true, and none of them is a cardiac symptom.
    const screen = safetyScreen(state({ safety: { ...DEFAULT_SAFETY_FLAGS } }), goal());
    expect(screen.medicalRedFlag).toBeNull();
  });

  it("still caps the block as well as raising the banner", () => {
    // The banner is not a substitute for the plan backing off — both, or the
    // removal traded one failure for another.
    const screen = safetyScreen(state({ safety: flags({ chestPainOnExertion: true }) }), goal());
    expect(screen.intensityCeiling).toBeLessThan(1);
    expect(screen.rampMultiplier).toBeLessThan(1);
  });
});
