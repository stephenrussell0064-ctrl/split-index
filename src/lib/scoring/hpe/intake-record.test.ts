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
import { deriveTargetTotal, resolveHorizon, validateIntake } from "./intake";
import { DEFAULT_PLANNING_HORIZON_WEEKS, MAX_HORIZON_WEEKS, MIN_HORIZON_WEEKS } from "./constants";

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
    // Three scored questions, all unanswered, male athlete (the female-only
    // one does not apply). Training fasted is collected but deliberately not
    // scored — it is an ordinary practice, not a clinical finding, and it used
    // to move an athlete a fifth of the way toward being told they were
    // under-fuelling for eating breakfast after their run instead of before.
    const { flags } = resolveSafetyFlags(parseIntakeRow(null), { age: 30, sex: "male" });
    expect(flags.leaRiskFlags).toBe(3);
  });

  it("does not count training fasted as a risk flag", () => {
    const fastedOnly = parseIntakeRow({
      lea_trains_fasted: true,
      lea_restricted_food: false,
      lea_unintended_weight_loss: false,
      lea_bone_stress_injury: false,
      lea_amenorrhoea: false,
      sections_completed: ["safety"],
    } as Record<string, unknown>);
    const { flags } = resolveSafetyFlags(fastedOnly, { age: 30, sex: "male" });
    expect(flags.leaRiskFlags).toBe(0);
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

describe("WP2 — missing fields degrade, they no longer block", () => {
  // The behaviour change. Every one of these used to refuse outright. They now
  // produce a documented, surfaced assumption and a more cautious plan — the
  // engine pays for uncertainty in caution rather than in silence.
  it("assumes rather than refuses when the on-ramp anchor is unknown", () => {
    const result = validateIntake(
      { age: 30, bodyweightKg: 80, heightCm: 180, sex: "male", currentRunMinPerWeek: undefined },
      { weeksOut: 12 },
      { daysAvailable: ["Mon", "Wed", "Fri"] }
    );
    expect(result.ok).toBe(true);
    const issue = result.issues.find((i) => i.field === "currentRunMinPerWeek")!;
    expect(issue.severity).toBe("assumed");
    // It must still say what the cost is. This is the field that prevents the
    // most common injury pathway in generated plans, so degrading it quietly
    // would be worse than refusing.
    expect(issue.message).toMatch(/half rate/);
  });

  it("assumes rather than refuses on fewer than three available days", () => {
    const result = validateIntake(
      { age: 30, bodyweightKg: 80, heightCm: 180, sex: "male", currentRunMinPerWeek: 100 },
      { weeksOut: 12 },
      { daysAvailable: ["Mon"] }
    );
    expect(result.ok).toBe(true);
    expect(result.issues.find((i) => i.field === "daysAvailable")?.severity).toBe("assumed");
  });

  it("assumes rather than refuses without an event date, height or bodyweight", () => {
    const result = validateIntake({ age: 30, sex: "male", currentRunMinPerWeek: 100 }, {}, { daysAvailable: ["Mon", "Wed", "Fri"] });
    expect(result.ok).toBe(true);
    for (const field of ["bodyweightKg", "heightCm", "weeksOut"]) {
      expect(result.issues.find((i) => i.field === field)?.severity, field).toBe("assumed");
    }
  });

  it("suppresses bodyweight guidance entirely when bodyweight is unknown", () => {
    // Degrading must not mean guessing. Nothing in the plan needs bodyweight
    // except the energy-availability safeguard, so the correct degradation is
    // to withhold that output rather than to invent a number for it.
    const result = validateIntake({ age: 30, sex: "male", currentRunMinPerWeek: 100 }, { weeksOut: 12 }, { daysAvailable: ["Mon", "Wed", "Fri"] });
    expect(result.issues.find((i) => i.field === "bodyweightKg")?.message).toMatch(/no bodyweight guidance/i);
  });

  it("reports every gap at once rather than one at a time", () => {
    const result = validateIntake({}, {}, {});
    expect(result.ok).toBe(true);
    expect(result.issues.length).toBeGreaterThanOrEqual(4);
    expect(result.issues.every((i) => i.severity === "assumed")).toBe(true);
  });
});

describe("WP2 — planning horizon without an event date", () => {
  const NOW = new Date("2026-01-01T00:00:00Z");

  it("uses a real event date when there is one", () => {
    const h = resolveHorizon("2026-04-02", null, NOW);
    expect(h.horizonSource).toBe("event_date");
    expect(h.weeksOut).toBe(13);
    expect(h.note).toBeNull();
  });

  it("uses a chosen timeframe when there is no date", () => {
    const h = resolveHorizon(null, 24, NOW);
    expect(h.horizonSource).toBe("chosen_timeframe");
    expect(h.weeksOut).toBe(24);
  });

  it("suggests a block when given neither, and says it is suggesting", () => {
    const h = resolveHorizon(null, null, NOW);
    expect(h.horizonSource).toBe("suggested");
    expect(h.weeksOut).toBe(DEFAULT_PLANNING_HORIZON_WEEKS);
    // It must not imply the athlete committed to a date they never entered.
    expect(h.note).toMatch(/have not set an event date/i);
  });

  it("clamps an event that is too close, and reframes what the block is for", () => {
    const h = resolveHorizon("2026-01-15", null, NOW);
    expect(h.weeksOut).toBe(MIN_HORIZON_WEEKS);
    expect(h.note).toMatch(/arriving fresh, not fitter/);
  });

  it("clamps an event more than a year out", () => {
    const h = resolveHorizon("2028-01-01", null, NOW);
    expect(h.weeksOut).toBe(MAX_HORIZON_WEEKS);
  });
});

describe("WP2 — per-lift targets", () => {
  it("accepts any subset, because a partial answer is still an answer", () => {
    expect(deriveTargetTotal(200, null, null)).toBe(200);
    expect(deriveTargetTotal(200, 140, null)).toBe(340);
    expect(deriveTargetTotal(200, 140, 240)).toBe(580);
  });

  it("returns null when nothing was given, rather than a total of zero", () => {
    // Zero is a claim about the athlete. Null is the absence of one.
    expect(deriveTargetTotal(null, null, null)).toBeNull();
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

/**
 * The athlete's own numbers beat the engine's estimates.
 *
 * The intake showed a derived 1RM and an age-estimated max HR as read-only
 * facts. They are not facts: an adaptive 1RM is inferred from submaximal sets,
 * and an estimated max HR is arithmetic on a birthday that is wrong for most
 * individuals by a wide margin. Someone who had actually tested a single had
 * no way to say so, and the plan was built on the estimate regardless.
 */
describe("manual overrides", () => {
  const prefilledWith = () =>
    parseIntakeRow({
      squat_1rm_override: 185,
      max_hr_override: 197,
      resting_hr_override: 44,
      sections_completed: ["safety", "goal", "availability", "strength", "heart_rate"],
    } as Record<string, unknown>);

  it("parses an override and leaves the untouched ones null", () => {
    const record = prefilledWith();
    expect(record.squat1rmOverride).toBe(185);
    expect(record.maxHrOverride).toBe(197);
    expect(record.restingHrOverride).toBe(44);
    // Null means "use what the engine proposed", not zero.
    expect(record.bench1rmOverride).toBeNull();
    expect(record.deadlift1rmOverride).toBeNull();
  });

  it("treats a missing override as absent rather than as zero", () => {
    const record = parseIntakeRow(null);
    expect(record.squat1rmOverride).toBeNull();
    expect(record.maxHrOverride).toBeNull();
    expect(record.restingHrOverride).toBeNull();
  });
});
