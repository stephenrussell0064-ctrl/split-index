/**
 * Full-functionality simulation across five athletes with genuinely different
 * backgrounds and goals.
 *
 * The product claim under test is the one the brief stakes everything on:
 * "Two athletes with identical goals and identical availability get different
 * weeks because their emphasis vectors differ." These five differ in history
 * as well as goal, so the bar is higher — each should get a week that is
 * recognisably about THEM, and none should be told they have no history when
 * they plainly do.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: {}, predicted5kS: 1400,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 3, enduranceTrainingYears: 3,
    currentRunMinPerWeek: 120, currentStrengthSessionsPerWeek: 2,
    chronicLoad: 300, restingHr: 55, maxHr: 188,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}
function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 6, maxHoursPerWeek: 8,
    maxSessionMin: 90, minRestDays: 1,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  };
}
const runs = (n: number, km: number, paceS: number, opts: Partial<RunLog> = {}): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * paceS, avgHr: 150, ...opts }));
const sets = (n: number, lift: string, kg: number, reps: number): LiftSet[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 5, lift, loadKg: kg, reps }));

// ---------------------------------------------------------------------------

/** 1. Pure runner, no gym at all. The persona whose tier-0 bug started this. */
function marathonRunner() {
  const r = [
    ...runs(36, 12, 300),
    { dateIdx: 10, distanceKm: 21.1, durationS: 5400, avgHr: 172, isMaxEffort: true },
    { dateIdx: 60, distanceKm: 10, durationS: 2400, avgHr: 175, isMaxEffort: true },
  ];
  return {
    name: "Marathon runner, never lifts",
    profile: diagnose(r, [], {}, { priority: 0.1, hrMax: 186, hrRest: 48 }),
    state: state({ currentRunMinPerWeek: 220, enduranceTrainingAge: "advanced", enduranceTrainingYears: 8, strengthTrainingYears: 0 }),
    goal: goal({ target5kS: 1080, priority: 0.1, weeksOut: 16 }),
  };
}

/** 2. Powerlifter who does no cardio. */
function powerlifter() {
  const s = [...sets(30, "squat", 200, 3), ...sets(30, "bench", 140, 3), ...sets(30, "deadlift", 240, 3),
             ...sets(20, "squat", 160, 8), ...sets(20, "bench", 110, 8), ...sets(20, "deadlift", 190, 8)];
  return {
    name: "Powerlifter, no cardio",
    profile: diagnose([], s, { squat: 220, bench: 150, deadlift: 260 }, { priority: 0.9, hrMax: 185, hrRest: 62 }),
    state: state({ oneRms: { squat: 220, bench: 150, deadlift: 260 }, currentRunMinPerWeek: 0, strengthTrainingAge: "advanced", strengthTrainingYears: 9, enduranceTrainingYears: 0, bodyweightKg: 95 }),
    goal: goal({ targetSquatKg: 240, targetBenchKg: 165, targetDeadliftKg: 280, priority: 0.9, weeksOut: 20 }),
  };
}

/** 3. Rower who never runs — the "aerobic base 0" persona. */
function rower() {
  return {
    name: "Rower, never runs",
    profile: diagnose([], sets(12, "squat", 120, 5), { squat: 130 }, {
      priority: 0.4, hrMax: 190, hrRest: 52,
      crossTrainingMinPerWeek: 300, crossTrainingKmPerWeek: 70, crossTrainingSessions: 40,
    }),
    state: state({ currentRunMinPerWeek: 0, oneRms: { squat: 130 } }),
    goal: goal({ weeksOut: 12 }),
  };
}

/** 4. Complete beginner. Nothing logged, no targets, no event. */
function beginner() {
  return {
    name: "Complete beginner",
    profile: diagnose([], [], {}, { priority: 0.5, hrMax: 195, hrRest: 70 }),
    state: state({ currentRunMinPerWeek: 0, strengthTrainingYears: 0, enduranceTrainingYears: 0, strengthTrainingAge: "novice", enduranceTrainingAge: "novice" }),
    goal: goal({ horizonSource: "suggested" }),
  };
}

/** 5. Well-rounded hybrid athlete with a same-day dual event. */
function hybridAthlete() {
  const r = [...runs(30, 8, 280, { splitsSPerKm: Array(8).fill(280), hrByKm: [148,152,155,158,160,163,165,168] }),
             { dateIdx: 5, distanceKm: 5, durationS: 1140, avgHr: 184, isMaxEffort: true },
             { dateIdx: 50, distanceKm: 10, durationS: 2400, avgHr: 180, isMaxEffort: true }];
  const s = [...sets(25, "squat", 170, 3), ...sets(25, "bench", 120, 3), ...sets(25, "deadlift", 200, 3),
             ...sets(20, "squat", 140, 8), ...sets(20, "bench", 95, 8), ...sets(20, "deadlift", 165, 8)];
  return {
    name: "Hybrid athlete, dual event",
    profile: diagnose(r, s, { squat: 185, bench: 130, deadlift: 220 }, { priority: 0.5, hrMax: 192, hrRest: 50 }),
    state: state({ oneRms: { squat: 185, bench: 130, deadlift: 220 }, currentRunMinPerWeek: 150, strengthTrainingYears: 5, enduranceTrainingYears: 5 }),
    goal: goal({ target5kS: 1050, targetSquatKg: 200, targetBenchKg: 140, targetDeadliftKg: 240, sameDay: true, weeksOut: 24 }),
  };
}

const PERSONAS = [marathonRunner(), powerlifter(), rower(), beginner(), hybridAthlete()];

describe("five-persona functionality test", () => {
  const plans = PERSONAS.map((p) => ({
    ...p,
    plan: generatePlan({ state: p.state, goal: p.goal, constraints: constraints(), profile: p.profile }),
  }));

  it("every persona gets a plan — nobody is refused for thin data", () => {
    for (const { name, plan } of plans) {
      expect(plan.generated, `${name} was refused`).toBe(true);
      expect(plan.weeks.length, name).toBeGreaterThan(0);
    }
  });

  it("nobody who has logged sessions is told they have no history", () => {
    for (const { name, profile } of plans) {
      if (name === "Complete beginner") continue;
      expect(profile.dataGaps.join(" "), name).not.toMatch(/No logged history/i);
    }
  });

  it("the runner and the powerlifter are both diagnosed, not written off", () => {
    const runner = plans.find((p) => p.name.startsWith("Marathon"))!;
    const lifter = plans.find((p) => p.name.startsWith("Power"))!;
    // The exact bug: a conjunctive tier gate scored both of these at 0.
    expect(runner.profile.tier, "runner").toBeGreaterThan(0);
    expect(runner.profile.aerobicTier).toBeGreaterThan(0);
    expect(lifter.profile.tier, "lifter").toBeGreaterThan(0);
    expect(lifter.profile.strengthTier).toBeGreaterThan(0);
  });

  it("the rower's aerobic base is not reported as zero", () => {
    const r = plans.find((p) => p.name.startsWith("Rower"))!;
    expect(r.profile.weeklyVolumeMin).toBeGreaterThan(200);
    expect(r.profile.runningVolumeMin).toBe(0);
    // And is not then told they have ample RUNNING volume.
    expect(r.profile.findings.map((f) => f.id)).not.toContain("ample-volume");
  });

  it("each persona's week is materially different from the others", () => {
    const signature = (p: (typeof plans)[number]) =>
      p.plan.weeks[Math.min(4, p.plan.weeks.length - 1)].sessions.map((s) => s.kind).sort().join(",");
    const sigs = plans.map(signature);
    // Five genuinely different athletes must not converge on two weeks.
    expect(new Set(sigs).size).toBeGreaterThanOrEqual(4);
  });

  it("emphasis reflects each athlete's actual limiter", () => {
    const runner = plans.find((p) => p.name.startsWith("Marathon"))!;
    const lifter = plans.find((p) => p.name.startsWith("Power"))!;
    // A runner chasing a 5k should not be weighted like a powerlifter.
    const runnerEndurance = runner.profile.emphasis.aerobic_base + runner.profile.emphasis.threshold;
    const lifterStrength = lifter.profile.emphasis.maximal_strength + lifter.profile.emphasis.strength_endurance;
    expect(runnerEndurance).toBeGreaterThan(0.3);
    expect(lifterStrength).toBeGreaterThan(0.3);
    expect(runner.profile.limiter).toBe("endurance");
    expect(lifter.profile.limiter).toBe("strength");
  });

  it("every plan is labelled with how tailored it actually is", () => {
    for (const { name, plan } of plans) {
      expect(plan.tailoring, name).not.toBeNull();
      expect(plan.tailoring!.headline.length, name).toBeGreaterThan(5);
    }
    // The beginner's must say so; the hybrid athlete's must not.
    expect(plans.find((p) => p.name.startsWith("Complete"))!.plan.tailoring!.isProvisional).toBe(true);
    expect(plans.find((p) => p.name.startsWith("Hybrid"))!.plan.tailoring!.isProvisional).toBe(false);
  });

  it("the beginner ramps more cautiously than the trained athletes", () => {
    const b = plans.find((p) => p.name.startsWith("Complete"))!;
    const h = plans.find((p) => p.name.startsWith("Hybrid"))!;
    expect(b.plan.tailoring!.rampMultiplier).toBeLessThan(h.plan.tailoring!.rampMultiplier);
  });

  it("no persona is prescribed a heart rate above their own maximum", () => {
    for (const { name, plan, profile } of plans) {
      for (const w of plan.weeks) {
        for (const s of w.sessions) {
          for (const m of s.prescription.text.matchAll(/HR (\d+)-(\d+)/g)) {
            expect(Number(m[2]), `${name}: ${s.prescription.text}`).toBeLessThanOrEqual(profile.hrMax);
          }
        }
      }
    }
  });

  it("every session in every plan is traceable to a named finding", () => {
    for (const { name, plan, profile } of plans) {
      const known = new Set([...profile.findings.map((f) => f.id), "hybrid-baseline"]);
      for (const w of plan.weeks) {
        for (const s of w.sessions) expect(known.has(s.findingId), `${name}/${s.kind}`).toBe(true);
      }
    }
  });

  it("no plan emits calorie, macro or weight-loss output for anyone", () => {
    for (const { name, plan } of plans) {
      const all = JSON.stringify(plan).toLowerCase();
      for (const phrase of ["calorie", "kcal", "energy deficit", "rate of loss"]) {
        expect(all, `${name}: ${phrase}`).not.toContain(phrase);
      }
    }
  });

  it("every plan schedules zero hard-rule violations", () => {
    for (const { name, plan } of plans) {
      expect(plan.weeks.reduce((s, w) => s + w.hardPenalty, 0), name).toBe(0);
    }
  });

  it("no plan leaves a week with no sessions at all", () => {
    for (const { name, plan } of plans) {
      for (const w of plan.weeks) {
        expect(w.sessions.length, `${name} week ${w.week}`).toBeGreaterThan(0);
      }
    }
  });
});
