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
import { paceBandFor } from "./prescription";
import { ACWR_BLOCK, type TrainingSplit } from "./constants";
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
    trainingSplit: null,
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

describe("regressions: the placeholder 5k and gym access", () => {
  it("uses the app's own prediction rather than a placeholder", () => {
    // The reported bug: an athlete who had logged an 18:25 5k still saw the
    // 25:00 placeholder, because the diagnostic only ever looked at maximal
    // efforts inside its own window and never consulted the prediction engine
    // the rest of the app already maintains.
    const p = diagnose([], [], {}, { hrMax: 190, hrRest: 55, predicted5kFallbackS: 1105 });
    expect(p.predicted5kS).toBe(1105);
    expect(p.predicted5kSource).toBe("prediction_engine");
    expect(p.predicted5kFromEffort).toBe(false);
  });

  it("prefers a real maximal effort over the prediction engine", () => {
    const race: RunLog[] = [{ dateIdx: 0, distanceKm: 5, durationS: 1105, isMaxEffort: true }];
    const p = diagnose(race, [], {}, { hrMax: 190, hrRest: 55, predicted5kFallbackS: 1400 });
    expect(p.predicted5kSource).toBe("maximal_effort");
    expect(p.predicted5kS).toBeCloseTo(1105, 0);
  });

  it("marks the 5k unknown when there is genuinely nothing — not a fake number", () => {
    const p = diagnose([], [], {}, { hrMax: 190, hrRest: 55 });
    expect(p.predicted5kSource).toBe("unknown");
  });

  it("prescribes no barbell work to an athlete with no gym", () => {
    // constraints.equipment was written and never read, so the gym-access
    // answer was collected, stored and ignored by the only code that mattered.
    const profile = diagnose([], sets(40, "squat", 100, 5), { squat: 120 }, { hrMax: 190, hrRest: 55, priority: 0.9 });
    const plan = generatePlan({
      state: state({ oneRms: { squat: 120 } }),
      goal: goal({ targetSquatKg: 140 }),
      constraints: constraints({ equipment: [] }),
      profile,
    });
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "strength");
    expect(strength.length).toBeGreaterThan(0);
    for (const s of strength) {
      expect(s.prescription.text).toMatch(/no gym access|Goblet|Push-up|Single-leg/i);
    }
  });

  it("still prescribes the barbell when the athlete has one", () => {
    const profile = diagnose([], sets(40, "squat", 100, 5), { squat: 120 }, { hrMax: 190, hrRest: 55, priority: 0.9 });
    const plan = generatePlan({
      state: state({ oneRms: { squat: 120 } }),
      goal: goal({ targetSquatKg: 140 }),
      constraints: constraints({ equipment: ["barbell"] }),
      profile,
    });
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "strength");
    expect(strength.some((s) => /no gym access/i.test(s.prescription.text))).toBe(false);
  });
});

describe("regression: ACWR enforcement must actually converge", () => {
  it("caps a plan below the block ceiling even from a near-zero chronic load", () => {
    // Caught by the fleet dashboard in production: "1 plans peaked above the
    // ACWR block ceiling. Enforcement is supposed to cap these before they
    // ship." Two compounding causes — a chronic seed of ~1 for an athlete with
    // no running history made every week read as a 54x spike, and enforcement
    // capped one week per pass for only ten passes, so a 24-week block where
    // every week breached never converged. It ran, emitted notes, and shipped
    // a plan still over the ceiling: a control reported as present while not
    // holding, which is the exact failure the assurance review named.
    for (const currentRunMin of [0, 30, 150]) {
      const plan = generatePlan({
        state: state({ currentRunMinPerWeek: currentRunMin, chronicLoad: 1 }),
        goal: goal({ weeksOut: 24 }),
        constraints: constraints(),
        profile: diagnose([], [], {}, { hrMax: 190, hrRest: 55 }),
      });
      expect(plan.generated).toBe(true);
      expect(plan.acwr!.peakAcwr, `currentRunMin=${currentRunMin}`).toBeLessThanOrEqual(ACWR_BLOCK + 1e-6);
    }
  });

  it("converges across every block length the engine offers", () => {
    for (const weeksOut of [4, 12, 24, 52]) {
      const plan = generatePlan({
        state: state({ currentRunMinPerWeek: 0, chronicLoad: 1 }),
        goal: goal({ weeksOut }),
        constraints: constraints(),
        profile: diagnose([], [], {}, { hrMax: 190, hrRest: 55 }),
      });
      expect(plan.acwr!.peakAcwr, `weeksOut=${weeksOut}`).toBeLessThanOrEqual(ACWR_BLOCK + 1e-6);
    }
  });

  it("leaves a well-seeded athlete's ratios untouched", () => {
    // The fix must not flatten a real athlete's progression.
    const plan = generatePlan({
      state: state({ currentRunMinPerWeek: 150, chronicLoad: 400 }),
      goal: goal({ weeksOut: 24 }),
      constraints: constraints(),
      profile: diagnose([], [], {}, { hrMax: 190, hrRest: 55 }),
    });
    expect(plan.acwr!.peakAcwr).toBeLessThanOrEqual(ACWR_BLOCK + 1e-6);
    expect(plan.acwr!.notes.length).toBe(0);
  });
});

describe("regression: easy pace must stay plausible for a trained runner", () => {
  it("refuses to invert the HR model outside the speeds it was fitted on", () => {
    // Reported: 6:04-8:38/km prescribed to an athlete chasing a sub-18 5k.
    // Their runs were all around 162bpm, so the HR-pace model was fitted only
    // on moderate-effort running — and inverting it at 62% of HR reserve
    // extrapolated far below every speed it had ever seen. Because the
    // slowest anchor governs, that extrapolation then won. The engine was
    // reading "you never run easy" and answering with a number derived from
    // the absence of the very data it was complaining about.
    const runs: RunLog[] = [
      { dateIdx: 0, distanceKm: 5, durationS: 1105, avgHr: 184, isMaxEffort: true },
      { dateIdx: 30, distanceKm: 10, durationS: 2320, avgHr: 180, isMaxEffort: true },
      // Twenty runs, every one at moderate effort — never easy.
      ...Array.from({ length: 20 }, (_, i) => ({
        dateIdx: i * 3,
        distanceKm: 8,
        durationS: 8 * 258,
        avgHr: 162,
      })),
    ];
    const p = diagnose(runs, [], {}, { hrMax: 190, hrRest: 50 });
    const band = p.easyBand!;
    const paceOf5k = p.predicted5kS / 5;

    // Easy running sits roughly 25-45% slower than 5k pace. Anything past 1.5x
    // is walking, and prescribing it to this athlete wastes the session.
    expect(band.lo).toBeLessThanOrEqual(paceOf5k * 1.5 + 1);
    expect(band.hi).toBeLessThanOrEqual(paceOf5k * 1.5 + 1);
    expect(band.lo).toBeGreaterThanOrEqual(paceOf5k * 1.15 - 1);
    // And the band must be a band, not a 2.5-minute chasm.
    expect(band.hi - band.lo).toBeLessThan(90);
  });

  it("still uses the HR inversion when the athlete DOES run easy", () => {
    // The bound must not disable a legitimately fitted anchor.
    const runs: RunLog[] = [
      { dateIdx: 0, distanceKm: 5, durationS: 1105, avgHr: 184, isMaxEffort: true },
      { dateIdx: 30, distanceKm: 10, durationS: 2320, avgHr: 180, isMaxEffort: true },
      ...Array.from({ length: 20 }, (_, i) => ({
        dateIdx: i * 3,
        distanceKm: 10,
        // Faster runs carry a higher heart rate — the relationship the model
        // is meant to fit.
        durationS: 10 * (348 - (i % 5) * 12),
        avgHr: 132 + (i % 5) * 4,
      })),
    ];
    const p = diagnose(runs, [], {}, { hrMax: 190, hrRest: 50 });
    expect(p.easyBand!.candidates.hr_inverted).toBeDefined();
  });
});

describe("regression: gym access implies a barbell", () => {
  it("prescribes barbell work to an athlete with a gym who listed only dumbbells", () => {
    // The equipment list is a refinement, not an exhaustive inventory. An
    // athlete who said yes to a gym and ticked "dumbbells" was handed
    // bodyweight substitutions.
    const profile = diagnose([], sets(40, "squat", 100, 5), { squat: 120 }, { hrMax: 190, hrRest: 55, priority: 0.9 });
    const plan = generatePlan({
      state: state({ oneRms: { squat: 120 } }),
      goal: goal({ targetSquatKg: 140 }),
      constraints: constraints({ equipment: ["barbell", "dumbbells"] }),
      profile,
    });
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "strength");
    expect(strength.some((s) => /no gym access/i.test(s.prescription.text))).toBe(false);
  });
});

describe("gym training splits", () => {
  const liftHistory = () => sets(60, "squat", 140, 5);
  const profile = () => diagnose([], liftHistory(), { squat: 160, bench: 110, deadlift: 190 }, { hrMax: 190, hrRest: 55, priority: 0.8 });

  const weekFor = (trainingSplit: TrainingSplit) => {
    const plan = generatePlan({
      state: state({ oneRms: { squat: 160, bench: 110, deadlift: 190 } }),
      goal: goal({ targetSquatKg: 180, targetBenchKg: 125, targetDeadliftKg: 215 }),
      constraints: constraints({ trainingSplit, maxSessionsPerWeek: 8 }),
      profile: profile(),
    });
    return plan.weeks[4].sessions.filter((s) => s.domain === "strength");
  };

  it("gives a push/pull/legs athlete push, pull and legs days", () => {
    const strength = weekFor("ppl");
    const text = strength.map((s) => s.prescription.text).join(" | ");
    // A day, not a lone lift: the accessories follow the day's patterns.
    expect(strength.length).toBeGreaterThan(1);
    expect(text).toMatch(/row|pulldown|face pull/i);
  });

  it("gives an upper/lower athlete upper and lower days", () => {
    const text = weekFor("upper_lower").map((s) => s.prescription.text).join(" | ");
    expect(text).toMatch(/overhead press|row|pulldown/i);
  });

  it("gives a full-body athlete sessions spanning several patterns", () => {
    const text = weekFor("full_body").map((s) => s.prescription.text).join(" | ");
    expect(text).toMatch(/romanian|split squat|row|press/i);
  });

  it("still supports lift-specific days for a peaking powerlifter", () => {
    const strength = weekFor("lift_specific");
    expect(strength.some((s) => s.lift === "squat")).toBe(true);
  });

  it("produces materially different weeks for different splits", () => {
    const sig = (split: TrainingSplit) =>
      weekFor(split).map((s) => s.prescription.text).join("|");
    const all = (["ppl", "upper_lower", "full_body", "lift_specific"] as TrainingSplit[]).map(sig);
    expect(new Set(all).size).toBeGreaterThan(1);
  });

  it("never prescribes a lone lift with no supporting work on a split day", () => {
    for (const split of ["ppl", "upper_lower", "full_body"] as const) {
      for (const s of weekFor(split)) {
        // The complaint that started this: single exercises rather than whole
        // sessions. Every split day must carry accessory work.
        expect(s.prescription.text.split("·").length, `${split}/${s.kind}`).toBeGreaterThan(1);
      }
    }
  });
});

describe("easy pace for an athlete who runs their easy days too hard", () => {
  const greyZoneAthlete = () => {
    const runs: RunLog[] = [
      { dateIdx: 0, distanceKm: 5, durationS: 1105, avgHr: 184, isMaxEffort: true },
      { dateIdx: 30, distanceKm: 10, durationS: 2320, avgHr: 180, isMaxEffort: true },
      // Every run at 162bpm — above their own easy ceiling of 151.
      ...Array.from({ length: 20 }, (_, i) => ({
        dateIdx: i * 3, distanceKm: 8, durationS: 8 * 258, avgHr: 162,
      })),
    ];
    return diagnose(runs, [], {}, { hrMax: 190, hrRest: 50 });
  };

  it("prescribes the slower part of the band, not the whole of it", () => {
    // The band is a range and the athlete picks a point in it. Someone in the
    // grey zone picks the fast end — that is what put them there.
    const p = greyZoneAthlete();
    expect(p.findings.map((f) => f.id)).toContain("grey-zone");
    expect(p.runsInsideEasyBand).toBe(0);

    const prescribed = paceBandFor(p, "easy_run");
    const mmss = (x: number) => `${Math.floor(Math.round(x) / 60)}:${String(Math.round(x) % 60).padStart(2, "0")}`;
    // Around 4:58-5:14 for this athlete — the slower half of their own band.
    expect(prescribed.lo, `got ${mmss(prescribed.lo)}`).toBeGreaterThan(p.easyBand!.lo);
    expect(prescribed.lo).toBeGreaterThanOrEqual(290);
    expect(prescribed.hi).toBeCloseTo(p.easyBand!.hi, 0);
  });

  it("leaves an athlete who already runs easy properly with their full band", () => {
    const runs: RunLog[] = [
      { dateIdx: 0, distanceKm: 5, durationS: 1105, avgHr: 184, isMaxEffort: true },
      { dateIdx: 30, distanceKm: 10, durationS: 2320, avgHr: 180, isMaxEffort: true },
      ...Array.from({ length: 20 }, (_, i) => ({
        dateIdx: i * 3, distanceKm: 10, durationS: 10 * (348 - (i % 5) * 12), avgHr: 132 + (i % 5) * 4,
      })),
    ];
    const p = diagnose(runs, [], {}, { hrMax: 190, hrRest: 50 });
    expect(p.runsInsideEasyBand).toBeGreaterThan(0);
    expect(paceBandFor(p, "easy_run").lo).toBeCloseTo(p.easyBand!.lo, 6);
  });

  it("never calls anything faster than 1.22x 5k pace easy", () => {
    const p = greyZoneAthlete();
    const paceOf5k = p.predicted5kS / 5;
    expect(p.easyBand!.lo).toBeGreaterThanOrEqual(paceOf5k * 1.22 - 1);
  });
});
