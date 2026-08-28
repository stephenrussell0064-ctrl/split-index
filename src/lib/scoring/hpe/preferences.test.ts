/**
 * The athlete's own preferences, proved to change the plan.
 *
 * This file exists because of a specific failure already in this repo:
 * `constraints.availabilityVaries` was collected by the intake, parsed into the
 * record, threaded into `Constraints` — and `scheduler.ts` never read it. It
 * looked implemented at every layer a test was likely to check, and the one
 * layer that mattered ignored it. A test asserting the field survives
 * serialisation would have passed the whole way through.
 *
 * So every test below asserts on the GENERATED PLAN, not on the constraint. A
 * rowing athlete has to receive rowing sessions and no runs. A PPL athlete has
 * to receive push, pull and legs days. A chosen exercise has to appear in the
 * prescription string the athlete actually reads. If a preference can be
 * removed from the engine without one of these failing, it is not wired up.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan, type GeneratedPlan } from "./engine";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import {
  emptyModalityFitness,
  ingestModality,
  modalityPaceBand,
  resolveCardioPlan,
  thresholdPaceFromBenchmark,
  type CardioModality,
  type ModalityFitness,
} from "./modality";
import { parseIntakeRow } from "./intake-record";
import { prioritiseWeek } from "./scheduler";
import type { ActivityRow } from "./ingest";
import type { AthleteProfile } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function state(overrides: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 82,
    heightCm: 180,
    age: 30,
    sex: "male",
    oneRms: { squat: 150, bench: 110, deadlift: 190 },
    predicted5kS: 20 * 60,
    strengthTrainingAge: "intermediate",
    enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 3,
    enduranceTrainingYears: 3,
    currentRunMinPerWeek: 150,
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
    weeksOut: 12,
    horizonSource: "chosen_timeframe",
    target5kS: null,
    enduranceEventKm: null,
    enduranceEventKey: null,
    targetSquatKg: null,
    targetBenchKg: null,
    targetDeadliftKg: null,
    targetTotalKg: null,
    priority: 0.5,
    sameDay: false,
    interEventGapH: 4,
    weightClassKg: null,
    eventOrderKnown: false,
    ...overrides,
  };
}

function constraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    twoADaysPossible: true,
    dayWindows: [],
    availabilityVaries: false,
    amHour: 7,
    pmHour: 18,
    maxSessionsPerWeek: 8,
    maxHoursPerWeek: 10,
    maxSessionMin: 90,
    minRestDays: 1,
    trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
    equipment: ["barbell"],
    ...overrides,
  };
}

/** A profile with enough shape that the engine allocates a full week. */
function profile(): AthleteProfile {
  return diagnose([], [], { squat: 150, bench: 110, deadlift: 190 }, {
    hrMax: 190,
    hrRest: 55,
    hrMaxSource: "measured",
    priority: 0.5,
  });
}

function plan(c: Partial<Constraints>, extra: Partial<Parameters<typeof generatePlan>[0]> = {}): GeneratedPlan {
  return generatePlan({
    state: state(),
    goal: goal(),
    constraints: constraints(c),
    profile: profile(),
    ...extra,
  });
}

const enduranceSessions = (p: GeneratedPlan) =>
  p.weeks.flatMap((w) => w.sessions.filter((s) => s.domain === "endurance"));
const strengthSessions = (p: GeneratedPlan) =>
  p.weeks.flatMap((w) => w.sessions.filter((s) => s.domain === "strength"));

/** Twelve weeks of logged rowing, ~2:05/500m steady — a real club-level rower. */
function rowingLogs(): ActivityRow[] {
  const rows: ActivityRow[] = [];
  for (let w = 0; w < 12; w++) {
    rows.push({
      started_at: new Date(Date.now() - (11 - w) * 7 * 86_400_000).toISOString(),
      sport: "rowing",
      duration_seconds: 2400,
      // 2400s at 2:05/500m => 9600m
      distance_meters: 9600,
      avg_heart_rate: 150,
      max_heart_rate: 175,
      avg_cadence: null,
      session_type: null,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// 1. Cardio modality — the plan is written in the athlete's own sport
// ---------------------------------------------------------------------------

describe("cardio modality reaches the prescription", () => {
  const rowingFitness = { row: ingestModality(rowingLogs(), "row") };

  it("gives a rowing-only athlete rowing sessions and NOT ONE run", () => {
    const p = plan(
      { cardioModalities: ["row"], crossTrainOk: false },
      { modalityFitness: rowingFitness }
    );

    const endurance = enduranceSessions(p);
    expect(endurance.length).toBeGreaterThan(0);

    // Every endurance session is rowing.
    expect(endurance.every((s) => s.modality === "row")).toBe(true);

    // And nothing anywhere tells them to run. This is the assertion that would
    // have caught a running plan wearing a rowing label.
    for (const s of endurance) {
      expect(s.label ?? "").not.toMatch(/run/i);
      expect(s.prescription.text).not.toMatch(/\brun\b/i);
      expect(s.prescription.text).not.toMatch(/\bstrides\b/i);
    }
  });

  it("quotes rowing pace in /500m and never in /km", () => {
    const p = plan(
      { cardioModalities: ["row"], crossTrainOk: false },
      { modalityFitness: rowingFitness }
    );
    const endurance = enduranceSessions(p);
    const withPace = endurance.filter((s) => /\d:\d\d/.test(s.prescription.text));
    expect(withPace.length).toBeGreaterThan(0);

    for (const s of withPace) {
      expect(s.prescription.text).toMatch(/\/500m/);
      expect(s.prescription.text).not.toMatch(/\/km/);
    }

    // The downstream renderers format `paceLoSPerKm` unconditionally as
    // "mm:ss/km". A 500m split must never be smuggled into that field.
    for (const s of endurance) {
      expect(s.prescription.paceLoSPerKm).toBeUndefined();
      expect(s.prescription.paceHiSPerKm).toBeUndefined();
    }
  });

  it("prescribes a plausible rowing pace rather than a converted running one", () => {
    const fitness = ingestModality(rowingLogs(), "row");
    // 2:05/500m for 40 minutes projects to roughly a 7:15-7:50 2k.
    expect(fitness.benchmarkS).toBeGreaterThan(400);
    expect(fitness.benchmarkS).toBeLessThan(500);

    const easy = modalityPaceBand(fitness, "easy_run");
    expect(easy).not.toBeNull();
    // An easy row for this athlete sits around 2:10-2:35/500m. Anything near
    // 4:30 (a running number) or near 1:50 (their 2k pace) is wrong.
    expect(easy!.lo).toBeGreaterThan(125);
    expect(easy!.hi).toBeLessThan(160);

    // And it is genuinely slower than their threshold pace.
    const threshold = modalityPaceBand(fitness, "threshold_run")!;
    expect(easy!.lo).toBeGreaterThan(threshold.hi);
  });

  it("swims are quoted per 100m and rides in km/h", () => {
    const swimFitness: Partial<Record<CardioModality, ModalityFitness>> = {
      swim: { ...emptyModalityFitness("swim"), thresholdPaceS: 100, benchmarkS: 360, benchmarkSource: "projected" },
    };
    const swimPlan = plan({ cardioModalities: ["swim"], crossTrainOk: false }, { modalityFitness: swimFitness });
    const swimText = enduranceSessions(swimPlan).map((s) => s.prescription.text).join(" ");
    expect(swimText).toMatch(/\/100m/);
    expect(swimText).not.toMatch(/\/km/);
    expect(swimText).toMatch(/Swim/);

    const cycleFitness: Partial<Record<CardioModality, ModalityFitness>> = {
      cycle: { ...emptyModalityFitness("cycle"), thresholdPaceS: 122, benchmarkS: 2400, benchmarkSource: "projected" },
    };
    const cyclePlan = plan({ cardioModalities: ["cycle"], crossTrainOk: false }, { modalityFitness: cycleFitness });
    const cycleText = enduranceSessions(cyclePlan).map((s) => s.prescription.text).join(" ");
    expect(cycleText).toMatch(/km\/h/);
    expect(cycleText).toMatch(/Ride/);
  });

  it("changing the modality changes the plan — a runner and a rower do not get the same sessions", () => {
    const runner = plan({ cardioModalities: ["run"], crossTrainOk: false });
    const rower = plan({ cardioModalities: ["row"], crossTrainOk: false }, { modalityFitness: rowingFitness });

    const runnerText = enduranceSessions(runner).map((s) => s.prescription.text).join("|");
    const rowerText = enduranceSessions(rower).map((s) => s.prescription.text).join("|");
    expect(runnerText).not.toEqual(rowerText);
    expect(runnerText).toMatch(/\/km/);
    expect(rowerText).toMatch(/\/500m/);
  });

  it("an unanswered modality question leaves the existing running behaviour exactly as it was", () => {
    const unanswered = plan({});
    const explicitRun = plan({ cardioModalities: ["run"], crossTrainOk: false });
    expect(enduranceSessions(unanswered).map((s) => s.prescription.text)).toEqual(
      enduranceSessions(explicitRun).map((s) => s.prescription.text)
    );
  });

  it("declining cross-training keeps every session inside the chosen modality", () => {
    const p = plan(
      { cardioModalities: ["row"], crossTrainOk: false },
      { modalityFitness: rowingFitness }
    );
    const modalities = new Set(enduranceSessions(p).map((s) => s.modality));
    expect([...modalities]).toEqual(["row"]);
  });

  it("choosing two modalities spreads easy volume across both and keeps quality in one", () => {
    const p = plan(
      { cardioModalities: ["run", "row"], crossTrainOk: true },
      { modalityFitness: rowingFitness }
    );
    const endurance = enduranceSessions(p);
    const used = new Set(endurance.map((s) => s.modality));
    expect(used.has("run")).toBe(true);
    expect(used.has("row")).toBe(true);

    // Quality progresses against ONE benchmark across the block, so every hard
    // session is in the same sport.
    const qualityModalities = new Set(
      endurance.filter((s) => s.isQuality && s.kind !== "long_run").map((s) => s.modality)
    );
    expect(qualityModalities.size).toBeLessThanOrEqual(1);
  });

  it("never prescribes a modality the athlete did not choose", () => {
    const p = plan(
      { cardioModalities: ["row", "swim"], crossTrainOk: true },
      { modalityFitness: rowingFitness }
    );
    for (const s of enduranceSessions(p)) {
      expect(["row", "swim"]).toContain(s.modality);
    }
  });

  it("a walking-only athlete gets steady walks and no invented walking intervals", () => {
    const p = plan({ cardioModalities: ["walk"], crossTrainOk: false });
    const endurance = enduranceSessions(p);
    expect(endurance.length).toBeGreaterThan(0);
    for (const s of endurance) {
      expect(s.modality).toBe("walk");
      expect(s.label ?? "").not.toMatch(/interval|reps/i);
      expect(s.prescription.text).toMatch(/Walk/);
    }
    // And the plan says out loud that this is what it has done.
    expect(p.weeks[0].notes.join(" ")).toMatch(/walking cannot carry one/i);
  });

  it("prescribes by effort, not by a borrowed number, when nothing is logged in the modality", () => {
    const p = plan({ cardioModalities: ["swim"], crossTrainOk: false });
    const texts = enduranceSessions(p).map((s) => s.prescription.text).join(" ");
    expect(texts).not.toMatch(/\/km/);
    const notes = enduranceSessions(p).flatMap((s) => s.prescription.notes ?? []).join(" ");
    expect(notes).toMatch(/no swimming pace target yet/i);
  });

  it("takes a modality's maximum heart rate below the running one", () => {
    const swimFitness: Partial<Record<CardioModality, ModalityFitness>> = {
      swim: { ...emptyModalityFitness("swim"), thresholdPaceS: 100, benchmarkS: 360, benchmarkSource: "projected" },
    };
    const runner = plan({ cardioModalities: ["run"], crossTrainOk: false });
    const swimmer = plan({ cardioModalities: ["swim"], crossTrainOk: false }, { modalityFitness: swimFitness });

    const runEasy = enduranceSessions(runner).find((s) => s.kind === "easy_run");
    const swimEasy = enduranceSessions(swimmer).find((s) => s.kind === "easy_run");
    expect(runEasy?.prescription.hrHi).toBeDefined();
    expect(swimEasy?.prescription.hrHi).toBeDefined();
    expect(swimEasy!.prescription.hrHi!).toBeLessThan(runEasy!.prescription.hrHi!);
  });
});

// ---------------------------------------------------------------------------
// 2. What a non-runner sees instead of a predicted 5k
// ---------------------------------------------------------------------------

describe("the 5k projection is running's and stays running's", () => {
  it("suppresses running diagnostics and names the athlete's own benchmark instead", () => {
    const p = plan(
      { cardioModalities: ["row"], crossTrainOk: false },
      { modalityFitness: { row: ingestModality(rowingLogs(), "row") } }
    );
    expect(p.cardio).not.toBeNull();
    expect(p.cardio!.suppressRunningDiagnostics).toBe(true);
    expect(p.cardio!.benchmark.label).toBe("2k row");
    expect(p.cardio!.benchmark.seconds).toBeGreaterThan(0);
    expect(p.cardio!.benchmark.thresholdPace).toMatch(/\/500m/);
  });

  it("leaves a runner's 5k alone", () => {
    const p = plan({ cardioModalities: ["run"], crossTrainOk: false });
    expect(p.cardio!.suppressRunningDiagnostics).toBe(false);
    expect(p.cardio!.benchmark.label).toBe("5k");
  });

  it("reports a null rather than a guess when the modality has no logs", () => {
    const p = plan({ cardioModalities: ["swim"], crossTrainOk: false });
    expect(p.cardio!.benchmark.seconds).toBeNull();
    expect(p.cardio!.benchmark.source).toBe("none");
    expect(p.cardio!.benchmark.unmeasured).toMatch(/log a hard swimming effort/i);
  });

  it("threshold pace from a benchmark is arithmetically the sport's own, not running's", () => {
    // A 7:04.6 2k is the male 50th percentile in cardio-benchmarks.ts. Paul's
    // Law puts that athlete's hour pace near 2:00/500m.
    const hourPace = thresholdPaceFromBenchmark("row", 424.6);
    expect(hourPace).toBeGreaterThan(112);
    expect(hourPace).toBeLessThan(128);
  });
});

// ---------------------------------------------------------------------------
// 3. Training split and chosen exercises
// ---------------------------------------------------------------------------

describe("the gym week is the athlete's own", () => {
  it("a PPL athlete gets push, pull and legs days", () => {
    const p = plan({ trainingSplit: "ppl" });
    const labels = new Set(strengthSessions(p).map((s) => s.label));
    expect(labels.has("Push")).toBe(true);
    expect(labels.has("Pull")).toBe(true);
    expect(labels.has("Legs")).toBe(true);
    // And no upper/lower leakage from the default split.
    expect(labels.has("Upper")).toBe(false);
    expect(labels.has("Lower")).toBe(false);
  });

  it("changing the split changes the plan", () => {
    const ppl = new Set(strengthSessions(plan({ trainingSplit: "ppl" })).map((s) => s.label));
    const ul = new Set(strengthSessions(plan({ trainingSplit: "upper_lower" })).map((s) => s.label));
    expect([...ppl].sort()).not.toEqual([...ul].sort());
    expect(ul.has("Upper")).toBe(true);
  });

  it("an athlete's OWN day structure overrides all five stock splits", () => {
    const p = plan({
      customSplitDays: [
        { label: "Chest and arms", primaryLift: "bench", patterns: ["push"] },
        { label: "Back day", primaryLift: "deadlift", patterns: ["pull"] },
        { label: "Wheels", primaryLift: "squat", patterns: ["legs", "core"] },
      ],
    });
    const labels = new Set(strengthSessions(p).map((s) => s.label));
    expect(labels.has("Chest and arms")).toBe(true);
    expect(labels.has("Back day")).toBe(true);
    expect(labels.has("Wheels")).toBe(true);
    expect(p.weeks[0].notes.join(" ")).toMatch(/your own day structure/i);
  });

  it("chosen exercises appear in the prescription the athlete reads", () => {
    const p = plan({
      trainingSplit: "ppl",
      exercisesByDay: {
        Push: ["Incline dumbbell press", "Cable fly", "Overhead press"],
        Legs: ["Hack squat", "Leg curl"],
      },
    });

    const push = strengthSessions(p).filter((s) => s.label === "Push");
    expect(push.length).toBeGreaterThan(0);
    for (const s of push) {
      expect(s.prescription.text).toMatch(/Incline dumbbell press/i);
      expect(s.prescription.text).toMatch(/Cable fly/i);
      expect(s.prescription.text).toMatch(/Overhead press/i);
    }

    const legs = strengthSessions(p).filter((s) => s.label === "Legs");
    for (const s of legs) {
      expect(s.prescription.text).toMatch(/Hack squat/i);
      expect(s.prescription.text).toMatch(/Leg curl/i);
    }
  });

  it("a chosen exercise gets a set and rep scheme, not a bare name", () => {
    const p = plan({
      trainingSplit: "ppl",
      exercisesByDay: { Push: ["Bench press", "Cable fly"] },
    });
    const push = strengthSessions(p).find((s) => s.label === "Push")!;
    expect(push.prescription.text).toMatch(/Cable fly 3x8-12/);
  });

  it("respects a scheme the athlete typed themselves", () => {
    const p = plan({
      trainingSplit: "ppl",
      exercisesByDay: { Push: ["Bench press", "Cable fly 4x15"] },
    });
    const push = strengthSessions(p).find((s) => s.label === "Push")!;
    expect(push.prescription.text).toMatch(/Cable fly 4x15/);
    expect(push.prescription.text).not.toMatch(/Cable fly 4x15 3x8-12/);
  });

  it("leaves days the athlete did not answer for to the engine", () => {
    const p = plan({
      trainingSplit: "ppl",
      exercisesByDay: { Push: ["Incline dumbbell press", "Cable fly"] },
    });
    const legs = strengthSessions(p).filter((s) => s.label === "Legs");
    expect(legs.length).toBeGreaterThan(0);
    // Untouched days still come from the accessory pool.
    expect(legs.some((s) => /Romanian deadlift|Bulgarian split squat|Leg press|Walking lunge/i.test(s.prescription.text))).toBe(true);
  });

  it("choosing nothing produces exactly the plan the engine produced before the question existed", () => {
    const withEmpty = plan({ trainingSplit: "ppl", exercisesByDay: {}, customSplitDays: [] });
    const withNothing = plan({ trainingSplit: "ppl" });
    expect(strengthSessions(withEmpty).map((s) => s.prescription.text)).toEqual(
      strengthSessions(withNothing).map((s) => s.prescription.text)
    );
  });

  it("keeps the competition lift leading when a numeric target is set, and says so", () => {
    const p = generatePlan({
      state: state(),
      goal: goal({ targetBenchKg: 140, targetTotalKg: 140 }),
      constraints: constraints({
        trainingSplit: "ppl",
        exercisesByDay: { Push: ["Incline dumbbell press", "Cable fly"] },
      }),
      profile: profile(),
    });
    expect(p.weeks[0].notes.join(" ")).toMatch(/competition lift still leads/i);
    // The picks are still there — they became the accessories rather than being discarded.
    const push = strengthSessions(p).find((s) => s.label === "Push")!;
    expect(push.prescription.text).toMatch(/Incline dumbbell press/i);
  });
});

// ---------------------------------------------------------------------------
// 4. The preference that was dead: availabilityVaries
// ---------------------------------------------------------------------------

describe("availabilityVaries is no longer collected and ignored", () => {
  it("produces an ordered list when the week varies, and none when it does not", () => {
    const varies = plan({ availabilityVaries: true });
    const fixed = plan({ availabilityVaries: false });

    expect(varies.weeks[0].prioritisedOrder).not.toBeNull();
    expect(varies.weeks[0].prioritisedOrder!.length).toBeGreaterThan(0);
    expect(fixed.weeks[0].prioritisedOrder).toBeNull();
  });

  it("surfaces the order to the athlete rather than storing it silently", () => {
    const varies = plan({ availabilityVaries: true });
    const notes = varies.weeks[0].notes.join(" ");
    expect(notes).toMatch(/place these yourself in this order of priority/i);
    expect(notes).toMatch(/not a fixture/i);
  });

  it("puts the hard sessions at the top of the order", () => {
    const varies = plan({ availabilityVaries: true });
    const order = varies.weeks[0].prioritisedOrder!;
    const firstEasyIndex = order.findIndex((s) => s.kind === "easy_run" || s.kind === "recovery_run");
    const lastQualityIndex = order.map((s) => s.isQuality && s.kind !== "long_run").lastIndexOf(true);
    if (firstEasyIndex >= 0 && lastQualityIndex >= 0) {
      expect(lastQualityIndex).toBeLessThan(firstEasyIndex);
    }
  });

  it("prioritiseWeek is stable inside a priority band", () => {
    const varies = plan({ availabilityVaries: true });
    const sessions = varies.weeks[0].sessions;
    expect(prioritiseWeek(sessions)).toEqual(prioritiseWeek(sessions));
  });
});

// ---------------------------------------------------------------------------
// 5. The stored row reaches the engine
// ---------------------------------------------------------------------------

describe("the stored intake row carries the new answers", () => {
  it("parses modalities, cross-training, custom days and exercise picks", () => {
    const record = parseIntakeRow({
      cardio_modalities: ["row", "swim", "not_a_sport"],
      cross_train_ok: true,
      custom_split_days: [
        { label: "Chest", primary_lift: "bench", patterns: ["push"] },
        { label: "Nothing useful", patterns: ["nonsense"] },
      ],
      exercises_by_day: { Chest: ["Bench press", "Bench press", " ", "Cable fly"] },
    });

    // Unknown modalities are dropped rather than trusted.
    expect(record.cardioModalities).toEqual(["row", "swim"]);
    expect(record.crossTrainOk).toBe(true);
    // A day with no recognisable pattern is dropped — the accessory selector
    // could not fill it, and a day with a primary lift and nothing else is the
    // "fragment of a session" the split work exists to prevent.
    expect(record.customSplitDays).toHaveLength(1);
    expect(record.customSplitDays[0].label).toBe("Chest");
    // Duplicates and blanks are cleaned.
    expect(record.exercisesByDay.Chest).toEqual(["Bench press", "Cable fly"]);
  });

  it("defaults to the pre-question behaviour on an empty row", () => {
    const record = parseIntakeRow(null);
    expect(record.cardioModalities).toEqual([]);
    expect(record.crossTrainOk).toBe(false);
    expect(record.customSplitDays).toEqual([]);
    expect(record.exercisesByDay).toEqual({});
    // And an empty choice resolves to running, which is what the engine did
    // before the question existed.
    expect(resolveCardioPlan(record.cardioModalities, record.crossTrainOk).modalities).toEqual(["run"]);
  });
});
