/**
 * WP2 acceptance — the intake spec's rules, tested where they live.
 *
 * The spec's own framing: "If a field is here and missing at generation time,
 * the behaviour in the *Missing* column is mandatory — the engine never
 * silently guesses." Most of what follows checks that unanswered resolves the
 * cautious way rather than the convenient one, because that is the difference
 * between an intake and a form.
 */

import { describe, expect, it } from "vitest";
import {
  MANDATORY_SECTIONS,
  hasMinimumViableIntake,
  parseIntakeRow,
  resolveIntakeInputs,
  resolveSafetyFlags,
  type IntakeRecord,
  type PrefilledFromSplitIndex,
} from "./intake-record";
import { validateIntake } from "./intake";

const NOW = new Date("2026-03-01T00:00:00Z");
const EVENT = "2026-08-01"; // ~22 weeks out

function prefilled(overrides: Partial<PrefilledFromSplitIndex> = {}): PrefilledFromSplitIndex {
  return {
    age: 30,
    sex: "male",
    bodyweightKg: 80,
    heightCm: 180,
    restingHr: 52,
    maxHr: 190,
    oneRms: { squat: 150, bench: 110, deadlift: 190 },
    predicted5kS: 1200,
    loggedWeeklyRunMinutes: 90,
    chronicLoad: 400,
    ...overrides,
  };
}

/** A fully answered, all-clear intake. Individual tests knock one piece out. */
function completeRecord(overrides: Partial<IntakeRecord> = {}): IntakeRecord {
  return {
    ...parseIntakeRow(null),
    sectionsCompleted: ["safety", "goal", "availability", "strength", "endurance", "heart_rate", "recovery", "preferences"],
    parqPositive: false,
    chestPainOnExertion: false,
    currentInjuryLimiting: false,
    injuryLast12Weeks: false,
    surgeryLast6Months: false,
    pregnantOrPostpartum12wk: false,
    medicationAffectingHr: false,
    leaRestrictedFood: false,
    leaTrainsFasted: false,
    leaUnintendedWeightLoss: false,
    leaBoneStressInjury: false,
    eventDate: EVENT,
    events: ["5k"],
    strengthTrainingYears: 5,
    enduranceTrainingYears: 4,
    currentRunMinPerWeek: 90,
    daysAvailable: ["Mon", "Wed", "Fri", "Sat"],
    gymAccessDays: ["Mon", "Wed"],
    sleepHoursTypical: 8,
    ...overrides,
  };
}

describe("WP2 — unanswered is not 'no'", () => {
  it("assumes a recent injury and recent surgery until answered", () => {
    const { flags } = resolveSafetyFlags(parseIntakeRow(null), { age: 30, sex: "male" });
    expect(flags.injuryLast12Weeks).toBe(true);
    expect(flags.surgeryLast6Months).toBe(true);
  });

  it("scores every unanswered LEA question as positive", () => {
    // Four questions, all unanswered, male athlete (the fifth does not apply).
    const { flags } = resolveSafetyFlags(parseIntakeRow(null), { age: 30, sex: "male" });
    expect(flags.leaRiskFlags).toBe(4);
  });

  it("includes the female-only LEA question only where it applies", () => {
    const male = resolveSafetyFlags(parseIntakeRow(null), { age: 30, sex: "male" });
    const female = resolveSafetyFlags(parseIntakeRow(null), { age: 30, sex: "female" });
    expect(female.flags.leaRiskFlags).toBe(male.flags.leaRiskFlags + 1);
  });

  it("does not score an unasked LEA screen as clear", () => {
    // The failure this guards: treating "never asked" as zero flags silently
    // clears the safeguard the screen exists to enforce.
    const answeredClear = completeRecord();
    const neverAsked = completeRecord({ sectionsCompleted: ["goal"] });
    expect(resolveSafetyFlags(answeredClear, { age: 30, sex: "male" }).flags.leaRiskFlags).toBe(0);
    expect(resolveSafetyFlags(neverAsked, { age: 30, sex: "male" }).flags.leaRiskFlags).toBeGreaterThanOrEqual(2);
  });

  it("derives under-18 from the profile rather than trusting a stored answer", () => {
    const { flags } = resolveSafetyFlags(completeRecord(), { age: 17, sex: "male" });
    expect(flags.under18).toBe(true);
  });

  it("says out loud what it assumed", () => {
    const { assumed } = resolveSafetyFlags(parseIntakeRow(null), { age: 30, sex: "male" });
    expect(assumed.join(" ")).toMatch(/recent injury is assumed/i);
    expect(assumed.join(" ")).toMatch(/halves your volume ramp/i);
  });

  it("stops assuming once the athlete answers", () => {
    const { flags, assumed } = resolveSafetyFlags(completeRecord(), { age: 30, sex: "male" });
    expect(flags.injuryLast12Weeks).toBe(false);
    expect(flags.surgeryLast6Months).toBe(false);
    expect(assumed).toEqual([]);
  });
});

describe("WP2 — documented degradation", () => {
  it("degrades a skipped strength section to novice, and says what that costs", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ strengthTrainingYears: null }),
      prefilled(),
      NOW
    );
    expect(resolved.state.strengthTrainingYears).toBe(0);
    expect(resolved.state.strengthTrainingAge).toBe("novice");
    expect(resolved.assumed.join(" ")).toMatch(/blocks a competition peaking block/i);
  });

  it("degrades a skipped endurance section to a halved ramp, and says so", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ enduranceTrainingYears: null }),
      prefilled(),
      NOW
    );
    expect(resolved.state.enduranceTrainingYears).toBe(0);
    expect(resolved.assumed.join(" ")).toMatch(/volume ramp is halved/i);
  });

  it("reports every assumption rather than defaulting silently", () => {
    const resolved = resolveIntakeInputs(parseIntakeRow(null), prefilled({ restingHr: null, maxHr: null }), NOW);
    const text = resolved.assumed.join(" ");
    expect(text).toMatch(/safety questionnaire has not been completed/i);
    expect(text).toMatch(/Resting heart rate was assumed/i);
    expect(text).toMatch(/age-estimated/i);
    expect(resolved.missingSections.length).toBeGreaterThan(0);
  });

  it("defaults gym access to every training day and says it did", () => {
    const resolved = resolveIntakeInputs(completeRecord({ gymAccessDays: [] }), prefilled(), NOW);
    expect(resolved.constraints.gymAccessDays).toEqual(resolved.constraints.daysAvailable);
    expect(resolved.assumed.join(" ")).toMatch(/Gym access is assumed/i);
  });
});

describe("WP2 — the cross-check rule", () => {
  it("uses the LOWER of stated and logged weekly volume", () => {
    // "Optimistic self-report is the norm and it is the on-ramp anchor, so it
    // must be conservative."
    const resolved = resolveIntakeInputs(
      completeRecord({ currentRunMinPerWeek: 200 }),
      prefilled({ loggedWeeklyRunMinutes: 60 }),
      NOW
    );
    expect(resolved.state.currentRunMinPerWeek).toBe(60);
    expect(resolved.assumed.join(" ")).toMatch(/said 200/);
    expect(resolved.assumed.join(" ")).toMatch(/logs show 60/);
  });

  it("uses the stated figure when there are no logs to check it against", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ currentRunMinPerWeek: 120 }),
      prefilled({ loggedWeeklyRunMinutes: null }),
      NOW
    );
    expect(resolved.state.currentRunMinPerWeek).toBe(120);
    expect(resolved.assumed.join(" ")).toMatch(/no logs to check it against/i);
  });

  it("stays quiet when the two agree", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ currentRunMinPerWeek: 90 }),
      prefilled({ loggedWeeklyRunMinutes: 90 }),
      NOW
    );
    expect(resolved.assumed.join(" ")).not.toMatch(/logs show/);
  });
});

describe("WP2 — the blocking fields", () => {
  it("refuses when the on-ramp anchor can be neither derived nor stated", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ currentRunMinPerWeek: null }),
      prefilled({ loggedWeeklyRunMinutes: null }),
      NOW
    );
    const validation = validateIntake(resolved.state, resolved.goal, resolved.constraints);
    expect(validation.ok).toBe(false);
    expect(validation.issues.find((i) => i.field === "currentRunMinPerWeek")?.message).toMatch(
      /single most common way generated plans cause injury/i
    );
  });

  it("refuses on fewer than three available days", () => {
    const resolved = resolveIntakeInputs(completeRecord({ daysAvailable: ["Mon", "Wed"] }), prefilled(), NOW);
    const validation = validateIntake(resolved.state, resolved.goal, resolved.constraints);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((i) => i.field === "daysAvailable")).toBe(true);
  });

  it("refuses without an event date, and without height or bodyweight", () => {
    const noDate = resolveIntakeInputs(completeRecord({ eventDate: null }), prefilled(), NOW);
    expect(validateIntake(noDate.state, noDate.goal, noDate.constraints).ok).toBe(false);

    const noBody = resolveIntakeInputs(completeRecord(), prefilled({ bodyweightKg: null, heightCm: null }), NOW);
    const validation = validateIntake(noBody.state, noBody.goal, noBody.constraints);
    expect(validation.ok).toBe(false);
    expect(validation.issues.some((i) => i.field === "heightCm")).toBe(true);
  });

  it("reports every blocking field at once rather than one at a time", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ eventDate: null, daysAvailable: [], currentRunMinPerWeek: null }),
      prefilled({ loggedWeeklyRunMinutes: null, bodyweightKg: null }),
      NOW
    );
    const blocking = validateIntake(resolved.state, resolved.goal, resolved.constraints).issues.filter(
      (i) => i.severity === "block"
    );
    expect(blocking.length).toBeGreaterThanOrEqual(4);
  });

  it("passes a complete intake", () => {
    const resolved = resolveIntakeInputs(completeRecord(), prefilled(), NOW);
    expect(validateIntake(resolved.state, resolved.goal, resolved.constraints).ok).toBe(true);
    expect(resolved.goal.weeksOut).toBeGreaterThanOrEqual(20);
    expect(resolved.goal.weeksOut).toBeLessThanOrEqual(24);
  });
});

describe("WP2 — the minimum viable intake", () => {
  it("needs the three mandatory sections and nothing more", () => {
    const minimal = completeRecord({ sectionsCompleted: [...MANDATORY_SECTIONS] });
    expect(hasMinimumViableIntake(minimal, prefilled())).toBe(true);
  });

  it("is not satisfied by optional sections alone", () => {
    const wrongSections = completeRecord({ sectionsCompleted: ["preferences", "recovery", "heart_rate"] });
    expect(hasMinimumViableIntake(wrongSections, prefilled())).toBe(false);
  });

  it("is not satisfied without a way to know current weekly volume", () => {
    const noAnchor = completeRecord({ sectionsCompleted: [...MANDATORY_SECTIONS], currentRunMinPerWeek: null });
    expect(hasMinimumViableIntake(noAnchor, prefilled({ loggedWeeklyRunMinutes: null }))).toBe(false);
    // Logged history alone is enough — the athlete does not have to retype it.
    expect(hasMinimumViableIntake(noAnchor, prefilled({ loggedWeeklyRunMinutes: 80 }))).toBe(true);
  });
});

describe("WP2 — nothing is asked twice", () => {
  it("takes body metrics, HR and 1RMs from Split Index rather than the form", () => {
    const resolved = resolveIntakeInputs(completeRecord(), prefilled(), NOW);
    expect(resolved.state.bodyweightKg).toBe(80);
    expect(resolved.state.heightCm).toBe(180);
    expect(resolved.state.restingHr).toBe(52);
    expect(resolved.state.oneRms.squat).toBe(150);
    expect(resolved.state.predicted5kS).toBe(1200);
  });

  it("keeps a priority the athlete moved themselves", () => {
    const resolved = resolveIntakeInputs(
      completeRecord({ priority: 0.75, priorityUserSet: true }),
      prefilled(),
      NOW
    );
    expect(resolved.goal.priority).toBe(0.75);
  });
});

describe("WP2 — the stored row parses safely", () => {
  it("treats a missing row as a blank intake rather than throwing", () => {
    const record = parseIntakeRow(null);
    expect(record.sectionsCompleted).toEqual([]);
    expect(record.parqPositive).toBeNull();
    expect(record.daysAvailable).toEqual([]);
    // Structural defaults are fine; safety defaults are not.
    expect(record.amHour).toBe(7);
    expect(record.substitutionOk).toBe(true);
  });

  it("keeps null distinct from false on every safety answer", () => {
    const record = parseIntakeRow({ parq_positive: false, injury_last_12_weeks: null });
    expect(record.parqPositive).toBe(false);
    expect(record.injuryLast12Weeks).toBeNull();
  });
});
