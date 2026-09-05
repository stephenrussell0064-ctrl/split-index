/**
 * Regression tests for correctness defects an athlete found by reading their
 * own plan and diagnostic.
 *
 *   1. "It gives a lower session but then states you should do cable rows and
 *      pull ups along with Bulgarian split squats and deadlifts."
 *   2. "The plan does not give specific weights based on what I have logged
 *      previously, which I have asked for."
 *   3. The diagnostic's predicted 5k disagreed with the number shown elsewhere.
 *   4. "Why does my strength profile not update with my new bench from logging
 *      the session in hybrid plan?"
 *   6. "Get rid of stalled lifts or ensure there is a value here."
 *
 * The first two are asserted on GENERATED PLAN TEXT rather than on fields
 * surviving serialisation. `constraints.availabilityVaries` is the precedent:
 * it was collected by the intake, parsed into the record and passed into
 * `Constraints`, and the scheduler never read it — every test that checked the
 * field passed, and the athlete's preference did nothing. A field arriving is
 * not the same as a field being used, and only the string the athlete reads
 * can tell the two apart.
 */

import { describe, expect, it } from "vitest";
import { diagnose, strengthAssessability } from "./diagnostics";
import { generatePlan } from "./engine";
import { overriddenOneRms } from "./intake";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { AthleteProfile, LiftSet, RunLog } from "./types";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: { squat: 140, bench: 100, deadlift: 180 }, predicted5kS: 1400,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 3, enduranceTrainingYears: 3,
    currentRunMinPerWeek: 150, currentStrengthSessionsPerWeek: 3,
    chronicLoad: 400, restingHr: 52, maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    enduranceEventKm: null, enduranceEventKey: null,
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}
function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 6, maxHoursPerWeek: 9,
    maxSessionMin: 90, minRestDays: 1,
    trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  };
}
const runs = (n: number, km: number, paceS: number, hr: number): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * paceS, avgHr: hr }));
const sets = (n: number, lift: string, kg: number, reps: number): LiftSet[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 5, lift, loadKg: kg, reps }));

function hybridProfile(extra: Partial<AthleteProfile> = {}): AthleteProfile {
  const s = state();
  const profile = diagnose(
    [...runs(14, 8, 300, 148), ...runs(6, 5, 224, 178), ...runs(5, 16, 330, 145)],
    [
      ...sets(9, "squat", 130, 5), ...sets(9, "bench", 92, 5),
      ...sets(8, "deadlift", 170, 5), ...sets(8, "squat", 120, 8),
    ],
    s.oneRms,
    { priority: 0.5, hrMax: 190, hrRest: 52, hrMaxSource: "measured" }
  );
  return { ...profile, ...extra };
}

function plan(c: Partial<Constraints> = {}, g: Partial<Goal> = {}, p: Partial<AthleteProfile> = {}) {
  return generatePlan({
    state: state(),
    goal: goal(g),
    constraints: constraints(c),
    profile: hybridProfile(p),
  });
}

/** Every strength session in the plan, as { label, text }. */
function strengthSessions(generated: ReturnType<typeof generatePlan>) {
  return generated.weeks.flatMap((w) =>
    w.placements
      .filter((pl) => pl.session.domain === "strength")
      .map((pl) => ({
        week: w.week,
        label: pl.session.label ?? pl.session.lift ?? "",
        text: pl.session.prescription.text,
      }))
  );
}

// ---------------------------------------------------------------------------
// Defect 1 — a lower-body day filled from an undifferentiated pool
// ---------------------------------------------------------------------------

/**
 * The upper-body pulls. Every one of these is an exercise whose working
 * muscles are entirely above the waist, and none of them belongs in a session
 * the athlete was told was a lower day.
 *
 * Deliberately spelled out rather than derived from the pool constant: a test
 * that reads the same table the code reads cannot catch a mistake in the
 * table, and the mistake WAS in the table — `upper_lower`'s Lower day carried
 * the `pull` pattern, whose pool is upper-body throughout.
 */
const UPPER_BODY_PULLS = [
  "pull-up", "lat pulldown", "cable row", "barbell row", "dumbbell row",
  "face pull", "barbell or dumbbell curl", "rear-delt",
];

describe("a lower-body day contains no upper-body pulls", () => {
  it("upper/lower: the Lower day is legs and posterior chain only", () => {
    const sessions = strengthSessions(plan({ trainingSplit: "upper_lower" }));
    const lower = sessions.filter((s) => s.label.toLowerCase() === "lower");
    expect(lower.length).toBeGreaterThan(0);

    for (const session of lower) {
      const text = session.text.toLowerCase();
      for (const pull of UPPER_BODY_PULLS) {
        expect(
          text.includes(pull),
          `week ${session.week} "${session.label}" prescribes "${pull}": ${session.text}`
        ).toBe(false);
      }
    }
  });

  it("upper/lower: the Lower day is still a full session, not a stub", () => {
    const sessions = strengthSessions(plan({ trainingSplit: "upper_lower" }));
    const lower = sessions.filter((s) => s.label.toLowerCase() === "lower");
    // Removing the upper-body pulls must not be done by simply deleting them —
    // a three-exercise "session" is the defect this pool was deepened to fix.
    for (const session of lower) {
      expect(session.text.split(" · ").length).toBeGreaterThanOrEqual(5);
    }
  });

  it("push/pull/legs: the Legs day is legs only", () => {
    const sessions = strengthSessions(plan({ trainingSplit: "ppl" }));
    const legs = sessions.filter((s) => s.label.toLowerCase() === "legs");
    expect(legs.length).toBeGreaterThan(0);
    for (const session of legs) {
      const text = session.text.toLowerCase();
      for (const pull of UPPER_BODY_PULLS) expect(text.includes(pull)).toBe(false);
    }
  });

  it("push/pull/legs: the Pull day still gets its upper-body pulls", () => {
    // The fix must not sterilise the pattern everywhere. A Pull day led by a
    // deadlift is exactly where a row and a pull-up belong.
    const sessions = strengthSessions(plan({ trainingSplit: "ppl" }));
    const pulls = sessions.filter((s) => s.label.toLowerCase() === "pull");
    expect(pulls.length).toBeGreaterThan(0);
    expect(
      pulls.some((s) => UPPER_BODY_PULLS.some((p) => s.text.toLowerCase().includes(p)))
    ).toBe(true);
  });

  it("full body: a full-body day is allowed everything", () => {
    const sessions = strengthSessions(plan({ trainingSplit: "full_body" }));
    const full = sessions.filter((s) => s.label.toLowerCase() === "full body");
    expect(full.length).toBeGreaterThan(0);
    expect(
      full.some((s) => UPPER_BODY_PULLS.some((p) => s.text.toLowerCase().includes(p)))
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Defect 2 — no specific weights, when the weights are known
// ---------------------------------------------------------------------------

const KG = /\b\d+(?:-\d+)?kg\b/;

describe("weights come from what the athlete has logged", () => {
  it("the leading lift is prescribed in kg when a 1RM is on file", () => {
    // Peaking a total keeps the competition lift in front, which is the path
    // that already printed kg. This is the guard on it.
    const sessions = strengthSessions(plan({ trainingSplit: "upper_lower" }, { targetSquatKg: 160 }));
    expect(sessions.length).toBeGreaterThan(0);
    for (const session of sessions) {
      expect(KG.test(session.text.split(" · ")[0]), session.text).toBe(true);
    }
  });

  it("a rotated variation is prescribed in kg when THAT exercise has history", () => {
    // No numeric target, so the day is led by a rotating variation rather than
    // the competition lift. The variation used to be prescribed as "a load you
    // can hold for the reps" unconditionally — including for an athlete who
    // had logged the exercise dozens of times.
    // No stalled lifts: a stall variation outranks the rotation for the lead
    // slot and is deliberately anchored to the competition 1RM instead, so it
    // would never exercise this path.
    const sessions = strengthSessions(
      plan({ trainingSplit: "upper_lower" }, {}, {
        stalledLifts: [],
        exerciseOneRms: { "incline dumbbell press": 70, "front squat": 110, "romanian deadlift": 150 },
      })
    );
    const leads = sessions.map((s) => s.text.split(" · ")[0].toLowerCase());
    const withHistory = leads.filter((l) =>
      ["incline dumbbell press", "front squat", "romanian deadlift"].some((n) => l.startsWith(n))
    );
    expect(withHistory.length, leads.join("\n")).toBeGreaterThan(0);
    for (const lead of withHistory) {
      expect(KG.test(lead), lead).toBe(true);
      expect(lead).not.toContain("a load you can hold for the reps");
    }
  });

  it("an exercise with NO history is never given an invented number", () => {
    // The other half of the contract, and the more important one. With an
    // empty history every accessory must fall back to the qualitative
    // prescription rather than borrowing a number from a different exercise.
    const sessions = strengthSessions(plan({ trainingSplit: "ppl" }, {}, { exerciseOneRms: {} }));
    const accessories = sessions.flatMap((s) => s.text.split(" · ").slice(1));
    expect(accessories.length).toBeGreaterThan(0);
    for (const line of accessories) {
      expect(KG.test(line), `invented a load for an unlogged exercise: ${line}`).toBe(false);
    }
  });

  it("an accessory WITH history is given the athlete's own numbers", () => {
    const sessions = strengthSessions(
      plan({ trainingSplit: "ppl" }, {}, {
        exerciseOneRms: { "leg press": 220, "seated cable row": 95, "face pull": 40 },
      })
    );
    const accessories = sessions.flatMap((s) => s.text.split(" · ").slice(1));
    const logged = accessories.filter((l) =>
      ["Leg press", "Seated cable row", "Face pull"].some((n) => l.startsWith(n))
    );
    expect(logged.length, accessories.join("\n")).toBeGreaterThan(0);
    for (const line of logged) expect(KG.test(line), line).toBe(true);

    // And the ones with no history in the same session still carry none.
    const unlogged = accessories.filter(
      (l) => !["Leg press", "Seated cable row", "Face pull"].some((n) => l.startsWith(n))
    );
    for (const line of unlogged) expect(KG.test(line), line).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Defect 3 — two 5k numbers, one label
// ---------------------------------------------------------------------------

describe("the predicted 5k says which quantity it is", () => {
  it("a sustained-pace ceiling is not labelled as the prediction engine's answer", () => {
    // No maximal effort, and a stale benchmark that is slower than a pace this
    // athlete has already held for 16km. The engine pulls the fallback back to
    // the evidence — correctly — but the RESULT is a ceiling, and it is a
    // different quantity from the `predicted_benchmarks` number the dashboard
    // reads. The source is what lets the screen say so.
    const profile = diagnose(
      [...runs(8, 16, 210, 150)],
      [],
      {},
      { hrMax: 190, hrRest: 52, hrMaxSource: "measured", predicted5kFallbackS: 1800 }
    );
    expect(profile.predicted5kSource).toBe("sustained_pace_bound");
    // And it genuinely disagrees with the app's own prediction, which is the
    // whole reason the two must not share a label.
    expect(profile.predicted5kS).not.toBe(1800);
    expect(profile.predicted5kS).toBe(210 * 5);
  });

  it("the prediction engine's own answer is passed through unchanged", () => {
    // Nothing sustained to bound it, so the number the rest of the app shows
    // is the number this screen shows.
    const profile = diagnose(
      [...runs(8, 3, 400, 150)],
      [],
      {},
      { hrMax: 190, hrRest: 52, hrMaxSource: "measured", predicted5kFallbackS: 1800 }
    );
    expect(profile.predicted5kSource).toBe("prediction_engine");
    expect(profile.predicted5kS).toBe(1800);
  });
});

// ---------------------------------------------------------------------------
// Defect 4 — a typed 1RM that outranked every later logged lift
// ---------------------------------------------------------------------------

describe("an intake 1RM override is a floor, not a permanent value", () => {
  it("a newer logged lift that beats the typed number wins", () => {
    expect(overriddenOneRms({ bench: 140 }, { bench: 120 })).toEqual({ bench: 140 });
  });

  it("a typed single still beats a lower inference", () => {
    expect(overriddenOneRms({ bench: 110 }, { bench: 130 })).toEqual({ bench: 130 });
  });

  it("a lift with no logged history takes the typed number", () => {
    expect(overriddenOneRms({}, { squat: 150 })).toEqual({ squat: 150 });
  });

  it("an absent or nonsensical override changes nothing", () => {
    expect(overriddenOneRms({ squat: 150 }, { squat: null, bench: 0 })).toEqual({ squat: 150 });
  });
});

// ---------------------------------------------------------------------------
// Defect 6 — a labelled slot that never carried a value
// ---------------------------------------------------------------------------

describe("stalled lifts always says something about this athlete", () => {
  it("names the closest lift and what is missing when it cannot reach a verdict", () => {
    const partial = sets(4, "bench", 100, 5).map((s, i) => ({ ...s, dateIdx: i * 10 }));
    const result = strengthAssessability({ bench: 120 }, partial);
    expect(result.stallAssessed).toBe(false);
    expect(result.stallShortfall).toContain("bench");
    expect(result.stallShortfall).toMatch(/more set/);
  });

  it("says so plainly when there is no lift history at all", () => {
    const result = strengthAssessability({}, []);
    expect(result.stallAssessed).toBe(false);
    expect(result.stallShortfall).toContain("no squat, bench or deadlift sets logged yet");
  });

  it("carries no shortfall once the verdict is reachable", () => {
    const enough = sets(8, "squat", 140, 5).map((s, i) => ({ ...s, dateIdx: i * 6 }));
    const result = strengthAssessability({ squat: 160 }, enough);
    expect(result.stallAssessed).toBe(true);
    expect(result.stallShortfall).toBeNull();
  });
});
