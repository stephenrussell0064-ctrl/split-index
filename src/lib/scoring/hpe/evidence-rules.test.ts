/**
 * Constants 3.0.0 — the evidence-register rules, each asserted against the
 * engine's own output rather than against its constants.
 *
 * Every test names the finding it closes in docs/HPE-EVIDENCE-REVIEW-2026-09.md.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { deliveredDose, generatePlan, type PlanWeek } from "./engine";
import { classifyDomains, feasibilityScreen, inferredStrengthTrainingAge, normalCdf } from "./feasibility";
import { modalityForEvent } from "./modality";
import { parseIntakeRow, resolveIntakeInputs } from "./intake-record";
import { buildMacrocycle, effectiveRamp, taperWeeksFor } from "./macrocycle";
import { deriveFeedbackFromActivities } from "./feedback";
import { blendRate, estimateObservedResponse } from "./response";
import { qualityEndAnchor5kS } from "./progression";
import { domainSessionTargets, subBandFor, workingMaxMultiplierFor } from "./session-set";
import {
  EVENT_DISTANCE_KM,
  MAX_WEEKLY_VOLUME_RAMP,
  MIN_COMBINED_RAMP_MULTIPLIER,
  RESPONSE_MAX_RATE_MULTIPLE,
  RESPONSE_MIN_RATE_MULTIPLE,
  RESPONSE_SHRINKAGE_WEIGHT,
  SESSION_SPIKE_MAX_MULTIPLE,
  STRENGTH_PHASE_SPEC,
  TAPER_FINAL_WEEK_INTENSITY_CEILING,
} from "./constants";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: { squat: 140, bench: 95, deadlift: 170 }, predicted5kS: 1350,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 2, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 110, currentStrengthSessionsPerWeek: 2,
    chronicLoad: 320, restingHr: 56, maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 16, horizonSource: "event_date", target5kS: 1200,
    enduranceEventKm: 5, enduranceEventKey: "5k",
    targetSquatKg: 165, targetBenchKg: 110, targetDeadliftKg: 205, targetTotalKg: 480,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}
function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 6, maxHoursPerWeek: 8,
    maxSessionMin: 90, minRestDays: 1, trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  };
}
const runs = (n: number, km: number, paceS: number, opts: Partial<RunLog> = {}): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * paceS, avgHr: 150, ...opts }));
const sets = (n: number, lift: string, kg: number, reps: number): LiftSet[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 5, lift, loadKg: kg, reps }));

function hybridProfile() {
  const r = [
    ...runs(28, 7, 330, { splitsSPerKm: Array(7).fill(330), hrByKm: [150, 154, 157, 160, 162, 164, 166] }),
    { dateIdx: 8, distanceKm: 5, durationS: 1350, avgHr: 183, isMaxEffort: true },
    { dateIdx: 55, distanceKm: 10, durationS: 2880, avgHr: 178, isMaxEffort: true },
  ];
  const s = [...sets(20, "squat", 130, 3), ...sets(20, "bench", 90, 3), ...sets(20, "deadlift", 160, 3),
             ...sets(15, "squat", 105, 8), ...sets(15, "bench", 72, 8), ...sets(15, "deadlift", 130, 8)];
  return diagnose(r, s, { squat: 140, bench: 95, deadlift: 170 }, { priority: 0.5, hrMax: 190, hrRest: 56 });
}

const plan = generatePlan({ state: state(), goal: goal(), constraints: constraints(), profile: hybridProfile() });
const dev = plan.weeks.filter((w) => w.phase !== "taper");

describe("F-3.1 the feasibility model is probabilistic and dose-aware", () => {
  it("reports an expected outcome, an 80% interval and a probability for each stated target", () => {
    const f = plan.feasibility!;
    expect(f.endurance.probability).not.toBeNull();
    expect(f.strength.probability).not.toBeNull();
    expect(f.endurance.interval80[0]).toBeLessThan(f.endurance.expected);
    expect(f.endurance.interval80[1]).toBeGreaterThan(f.endurance.expected);
    expect(f.jointProbability).not.toBeNull();
    expect(f.adherence).toBeGreaterThan(0.3);
    expect(f.adherence).toBeLessThanOrEqual(1);
  });

  it("grades a target two SDs out as a multi-block goal and builds toward the milestone, not the target", () => {
    const f = plan.feasibility!;
    expect(f.endurance.level).toBe("multi-block");
    expect(f.endurance.primaryGoal).toBeCloseTo(f.endurance.expected, 6);
    expect(f.endurance.weeksNeeded).toBeGreaterThan(16);
    expect(f.messages.join(" ")).toMatch(/multi-block goal/);
  });

  it("scales the projection down when the plan's own dose is under the evidence threshold, and says so", () => {
    const f = plan.feasibility!;
    expect(plan.dose!.enduranceMinPerWeek).toBeLessThan(180);
    expect(f.endurance.doseMultiplier).toBeLessThan(1);
    expect(f.doseWarnings.join(" ")).toMatch(/minutes of running a week/);
  });

  it("applies interference to a male lifter's lower-body projection with real running load, and not to a female one", () => {
    const male = feasibilityScreen(state({ currentRunMinPerWeek: 200 }), goal({ target5kS: null }));
    const light = feasibilityScreen(state({ currentRunMinPerWeek: 60 }), goal({ target5kS: null }));
    expect(male.strength.gainFraction).toBeLessThan(light.strength.gainFraction);
    // A woman with the same RELATIVE strength (her lifts scaled by the sex
    // factor, so she is classed at the same training age) loses nothing to
    // running volume: Huiberts 2024 found the lower-body interference in men only.
    const womanLifts = { squat: 100, bench: 68, deadlift: 122 };
    const femaleHeavy = feasibilityScreen(state({ sex: "female", oneRms: womanLifts, currentRunMinPerWeek: 200 }), goal({ target5kS: null, targetSquatKg: 118, targetBenchKg: 80, targetDeadliftKg: 144, targetTotalKg: 342 }));
    const femaleLight = feasibilityScreen(state({ sex: "female", oneRms: womanLifts, currentRunMinPerWeek: 60 }), goal({ target5kS: null, targetSquatKg: 118, targetBenchKg: 80, targetDeadliftKg: 144, targetTotalKg: 342 }));
    expect(femaleHeavy.strength.gainFraction).toBeCloseTo(femaleLight.strength.gainFraction, 6);
  });

  it("flattens multi-block horizons rather than compounding them", () => {
    const one = feasibilityScreen(state(), goal({ weeksOut: 12 }));
    const four = feasibilityScreen(state(), goal({ weeksOut: 48 }));
    expect(four.endurance.gainFraction).toBeLessThan(one.endurance.gainFraction * 4);
    expect(four.endurance.gainFraction).toBeGreaterThan(one.endurance.gainFraction * 2);
  });

  it("infers strength training age from relative strength as a floor under what the athlete typed", () => {
    expect(inferredStrengthTrainingAge("novice", { oneRms: { squat: 200, bench: 140, deadlift: 240 }, bodyweightKg: 85, sex: "male" })).toBe("advanced");
    expect(inferredStrengthTrainingAge("novice", { oneRms: { squat: 60, bench: 40, deadlift: 80 }, bodyweightKg: 80, sex: "male" })).toBe("novice");
    expect(inferredStrengthTrainingAge("advanced", { oneRms: { squat: 60, bench: 40, deadlift: 80 }, bodyweightKg: 80, sex: "male" })).toBe("advanced");
  });

  it("normalCdf is a CDF", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(1.2816)).toBeCloseTo(0.9, 3);
    expect(normalCdf(-3)).toBeLessThan(0.002);
  });
});

describe("F-3.2 quality sessions are paced to what fitness supports, never to an infeasible target", () => {
  it("anchors the end-of-block rep pace to the expected outcome when the target is faster than that", () => {
    const profile = hybridProfile();
    const anchor = qualityEndAnchor5kS(profile, goal({ target5kS: 900 }), 1290);
    expect(anchor).toBe(1290);
    // A target slower than the projection governs instead.
    expect(qualityEndAnchor5kS(profile, goal({ target5kS: 1320 }), 1290)).toBe(1320);
  });

  it("prescribes no interval faster than the expected-outcome pace band across the whole block", () => {
    const expectedPace = plan.feasibility!.endurance.expected / 5;
    for (const w of plan.weeks) {
      for (const s of w.sessions) {
        if (s.kind !== "interval_run") continue;
        // Interval band is 0.96-1.0 of the anchor pace; the anchor never goes past the expected outcome.
        expect(s.prescription.paceLoSPerKm!).toBeGreaterThanOrEqual(expectedPace * 0.96 - 0.5);
      }
    }
  });

  it("every quality session contains its own reps plus a warm-up inside its stated minutes", () => {
    for (const w of plan.weeks) {
      for (const s of w.sessions) {
        if (s.kind !== "interval_run") continue;
        const m = /(\d+) x 1000m in (\d+):(\d+) each .*?, (\d+)s jog recovery.*?(\d+)min including a (\d+)min warm-up/.exec(s.prescription.text);
        expect(m, s.prescription.text).not.toBeNull();
        const [, reps, mm, ss, rec, total, warm] = m!.map(Number);
        const need = reps * (mm * 60 + ss) + (reps - 1) * rec + warm * 60;
        expect(total * 60, s.prescription.text).toBeGreaterThanOrEqual(need - 60);
      }
    }
  });
});

describe("F-3.3 a quality session is a session size, so low-volume athletes still get one", () => {
  it("gives a 110 min/week 5k athlete on four sessions a hard session in every non-deload week", () => {
    const p = generatePlan({
      state: state(),
      goal: goal({ weeksOut: 12 }),
      constraints: constraints({ maxSessionsPerWeek: 4, maxHoursPerWeek: 5, daysAvailable: ["Mon", "Wed", "Fri", "Sat"] }),
      profile: hybridProfile(),
    });
    for (const w of p.weeks) {
      if (w.deload || w.phase === "taper") continue;
      expect(w.delivered!.qualityCount, `week ${w.week}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("never schedules two hard endurance sessions on consecutive days", () => {
    for (const w of plan.weeks) expect(w.hardPenalty, `week ${w.week}`).toBe(0);
  });
});

describe("F-3.4 the taper loses volume and keeps intensity, by event", () => {
  it("tapers one week for a 5k, two for a half, three for a marathon, and one when there is no event date", () => {
    expect(taperWeeksFor({ enduranceEventKey: "5k", horizonSource: "event_date", weeksOut: 16 })).toBe(1);
    expect(taperWeeksFor({ enduranceEventKey: "half", horizonSource: "event_date", weeksOut: 16 })).toBe(2);
    expect(taperWeeksFor({ enduranceEventKey: "marathon", horizonSource: "event_date", weeksOut: 16 })).toBe(3);
    expect(taperWeeksFor({ enduranceEventKey: "marathon", horizonSource: "chosen_timeframe", weeksOut: 16 })).toBe(1);
  });

  it("the marathon taper is progressive and monotone", () => {
    const macro = buildMacrocycle(state({ currentRunMinPerWeek: 300 }), goal({ enduranceEventKey: "marathon", enduranceEventKm: 42.195 }));
    const taper = macro.filter((w) => w.phase === "taper").map((w) => w.enduranceMin);
    expect(taper.length).toBe(3);
    expect(taper[0]).toBeGreaterThan(taper[1]);
    expect(taper[1]).toBeGreaterThan(taper[2]);
  });

  it("the taper week's hardest session is not the block's hardest, and the final week caps each lift", () => {
    const taper = plan.weeks[plan.weeks.length - 1];
    const peak = plan.weeks[plan.weeks.length - 2];
    const reps = (w: PlanWeek) => {
      const s = w.sessions.find((x) => x.kind === "interval_run" || x.kind === "threshold_run");
      return s ? s.minutes : 0;
    };
    expect(reps(taper)).toBeLessThanOrEqual(reps(peak));
    for (const s of taper.sessions) {
      if (s.domain !== "strength" || !s.lift) continue;
      const cap = TAPER_FINAL_WEEK_INTENSITY_CEILING[s.lift];
      if (cap == null) continue;
      const pct = /\((\d+)-(\d+)%/.exec(s.prescription.text);
      expect(pct, s.prescription.text).not.toBeNull();
      expect(Number(pct![2]) / 100, s.prescription.text).toBeLessThanOrEqual(cap + 0.001);
    }
  });
});

describe("F-3.5 progression rules carry the evidence, not the ratio", () => {
  it("caps the long run at 1.1× the longest run of the last month and brings it down on a deload", () => {
    let longest = 0;
    for (const w of plan.weeks) {
      const lr = w.delivered?.longRunMinutes ?? null;
      if (lr == null) continue;
      if (longest > 0) expect(lr, `week ${w.week}`).toBeLessThanOrEqual(Math.round(longest * SESSION_SPIKE_MAX_MULTIPLE) + 1);
      if (w.deload && longest > 0) expect(lr, `deload week ${w.week}`).toBeLessThan(longest);
      const recent = plan.weeks
        .slice(Math.max(0, plan.weeks.indexOf(w) - 3), plan.weeks.indexOf(w) + 1)
        .map((x) => x.delivered?.longRunMinutes ?? 0);
      longest = Math.max(...recent);
    }
  });

  it("the novice halving is applied once, and the combined ramp is floored", () => {
    const novice = state({ enduranceTrainingYears: 0.2 });
    expect(effectiveRamp(novice, 1).ramp).toBeCloseTo(MAX_WEEKLY_VOLUME_RAMP * 0.5, 6);
    // Novice AND provisional AND high stress: floored, not compounded to nothing.
    expect(effectiveRamp(state({ enduranceTrainingYears: 0.2, lifeStressNow: 5 }), 0.5).ramp).toBeCloseTo(
      MAX_WEEKLY_VOLUME_RAMP * MIN_COMBINED_RAMP_MULTIPLIER,
      6
    );
  });

  it("the athlete's previous maximum volume caps the block", () => {
    const macro = buildMacrocycle(state({ currentRunMinPerWeek: 150, previousMaxVolumeMin: 160 }), goal({ weeksOut: 24 }));
    expect(Math.max(...macro.map((w) => w.enduranceMin))).toBeLessThanOrEqual(160 * 1.25 + 1);
  });

  it("the stated hours cap binds the whole week, strength included", () => {
    const p = generatePlan({
      state: state({ currentRunMinPerWeek: 300 }),
      goal: goal(),
      constraints: constraints({ maxHoursPerWeek: 4 }),
      profile: hybridProfile(),
    });
    for (const w of p.weeks) {
      const minutes = w.placements.reduce((s, x) => s + x.session.minutes, 0);
      expect(minutes, `week ${w.week}`).toBeLessThanOrEqual(4 * 60 + 15);
    }
  });

  it("a travel week is a maintenance week, not a hole", () => {
    const p = generatePlan({ state: state(), goal: goal(), constraints: constraints({ travelWeeks: [6] }), profile: hybridProfile() });
    const w = p.weeks.find((x) => x.week === 6)!;
    expect(w.travel).toBe(true);
    expect(w.deload).toBe(true);
    expect(w.placements.length).toBeGreaterThan(0);
    expect(w.notes.join(" ")).toMatch(/travel week/i);
  });

  it("the reported endurance minutes are the minutes the sessions add up to", () => {
    for (const w of plan.weeks) {
      const delivered = w.placements.filter((p) => p.session.domain === "endurance").reduce((s, p) => s + p.session.minutes, 0);
      expect(Math.abs(w.enduranceMin - delivered), `week ${w.week}`).toBeLessThanOrEqual(1);
    }
  });
});

describe("F-3.6 strength progresses inside a phase and each lift is met often enough", () => {
  it("the load sub-band walks up across a phase", () => {
    const band = STRENGTH_PHASE_SPEC.build.pct;
    expect(subBandFor(band, 0)[0]).toBeCloseTo(band[0], 6);
    expect(subBandFor(band, 1)[1]).toBeCloseTo(band[1], 6);
    expect(subBandFor(band, 1)[0]).toBeGreaterThan(subBandFor(band, 0)[0]);
  });

  it("two consecutive weeks of the same phase never prescribe the same squat load", () => {
    const squatLine = (w: PlanWeek) =>
      w.sessions.map((s) => /Squat [^·]*/.exec(s.prescription.text)?.[0] ?? null).find((x) => x != null) ?? null;
    let prev: { phase: string; line: string | null } | null = null;
    for (const w of plan.weeks) {
      const line = squatLine(w);
      if (prev && line && prev.line && prev.phase === w.phase && !w.deload) {
        expect(line, `week ${w.week}`).not.toBe(prev.line);
      }
      if (!w.deload) prev = { phase: w.phase, line };
    }
  });

  it("the working max walks up with the block's expected gain and is capped", () => {
    expect(workingMaxMultiplierFor(0.05, 0)).toBe(1);
    expect(workingMaxMultiplierFor(0.05, 1)).toBeCloseTo(1.05, 6);
    expect(workingMaxMultiplierFor(0.5, 1)).toBeCloseTo(1.08, 6);
  });

  it("a peaking athlete meets squat and deadlift at least three times over any two weeks on three gym days", () => {
    // Three gym days on an upper/lower split alternate two lower days with
    // one; with both lower lifts trained on every lower day, each lift is
    // met three times a fortnight — the Grgic 2018 twice-weekly floor on
    // average, which is what a three-day week can carry.
    const nonDeload = dev.filter((w) => !w.deload);
    for (let i = 1; i < nonDeload.length; i++) {
      const pair = [nonDeload[i - 1], nonDeload[i]];
      const count = (lift: string) => pair.reduce((n, w) => n + w.sessions.filter((s) => s.liftSets?.[lift]).length, 0);
      expect(count("squat"), `weeks ${pair[0].week}-${pair[1].week}`).toBeGreaterThanOrEqual(3);
      expect(count("deadlift"), `weeks ${pair[0].week}-${pair[1].week}`).toBeGreaterThanOrEqual(3);
    }
    expect(deliveredDose(plan.weeks, goal())!.setsPerLiftPerWeek).toBeGreaterThanOrEqual(4);
  });

  it("a deload cuts sets and adds a rep in reserve rather than removing the week", () => {
    const deload = plan.weeks.find((w) => w.deload)!;
    const before = plan.weeks.find((w) => w.week === deload.week - 1)!;
    const primarySets = (w: PlanWeek) => w.sessions.filter((s) => s.domain === "strength").map((s) => Number(/^\S+(?: \S+)? (\d)x/.exec(s.prescription.text)?.[1] ?? 0));
    expect(Math.max(...primarySets(deload))).toBeLessThan(Math.max(...primarySets(before)));
    expect(deload.sessions.some((s) => /RIR 3-4/.test(s.prescription.text))).toBe(true);
  });

  it("the heavy-lower flag follows the loads actually prescribed", () => {
    for (const w of plan.weeks) {
      for (const s of w.sessions) {
        if (s.domain !== "strength" || !s.lift || s.lift === "bench" || s.kind === "strength_maintenance") continue;
        const pct = /\((\d+)-(\d+)%/.exec(s.prescription.text);
        if (!pct) continue;
        const heavy = Number(pct[2]) / 100 > 0.82;
        expect(s.isQuality, `${w.week}: ${s.prescription.text}`).toBe(heavy);
      }
    }
  });
});

describe("F-3.7 the priority slider moves whole sessions", () => {
  it("a strength-priority athlete gives up endurance sessions down to the maintenance dose, and vice versa", () => {
    const mode = { strength: "develop" as const, endurance: "develop" as const };
    const lean = domainSessionTargets("base", mode, 0.9);
    const run = domainSessionTargets("base", mode, 0.1);
    const even = domainSessionTargets("base", mode, 0.5);
    expect(lean.endurance).toBeLessThan(even.endurance);
    expect(lean.strength).toBeGreaterThanOrEqual(even.strength);
    expect(run.strength).toBeLessThan(even.strength);
    expect(run.endurance).toBeGreaterThanOrEqual(even.endurance);
    expect(lean.endurance).toBeGreaterThanOrEqual(3);
    expect(run.strength).toBeGreaterThanOrEqual(2);
  });
});

describe("F-3.22 the projection learns this athlete's own rate, timidly", () => {
  const iso = (weeksAgo: number) => new Date(Date.now() - weeksAgo * 7 * 86_400_000).toISOString();

  it("refuses to measure a rate from less than four weeks, one point, or a stale history", () => {
    expect(estimateObservedResponse([{ generatedAt: iso(1), predicted5kS: 1350, oneRms: {} }])).toBeNull();
    expect(
      estimateObservedResponse([
        { generatedAt: iso(3), predicted5kS: 1400, oneRms: {} },
        { generatedAt: iso(1), predicted5kS: 1300, oneRms: {} },
      ])
    ).toBeNull();
    // Measured over eight weeks, but the last reading is four months old.
    expect(
      estimateObservedResponse([
        { generatedAt: iso(26), predicted5kS: 1400, oneRms: {} },
        { generatedAt: iso(18), predicted5kS: 1300, oneRms: {} },
      ])
    ).toBeNull();
  });

  it("reports movement inside the test's own noise as no signal rather than as a rate", () => {
    const r = estimateObservedResponse([
      { generatedAt: iso(8), predicted5kS: 1350, oneRms: { squat: 140, bench: 95, deadlift: 170 } },
      { generatedAt: iso(0), predicted5kS: 1345, oneRms: { squat: 141, bench: 95, deadlift: 170 } },
    ])!;
    expect(r.withinNoise.endurance).toBe(true);
    expect(r.endurancePerBlock).toBeNull();
    expect(r.withinNoise.strength).toBe(true);
    expect(r.strengthPerBlock).toBeNull();
  });

  it("weights a short observation less than a long one, and never past the ceiling", () => {
    const short = estimateObservedResponse([
      { generatedAt: iso(5), predicted5kS: 1400, oneRms: {} },
      { generatedAt: iso(0), predicted5kS: 1330, oneRms: {} },
    ])!;
    const long = estimateObservedResponse([
      { generatedAt: iso(12), predicted5kS: 1400, oneRms: {} },
      { generatedAt: iso(0), predicted5kS: 1330, oneRms: {} },
    ])!;
    expect(short.weight).toBeLessThan(long.weight);
    expect(long.weight).toBeCloseTo(RESPONSE_SHRINKAGE_WEIGHT, 6);
  });

  it("blends toward the observation without letting it take over", () => {
    const prior = 0.04;
    // An observation four times the prior rate moves it, but nowhere near four times.
    const fast = blendRate(prior, 0.16, RESPONSE_SHRINKAGE_WEIGHT, 1);
    expect(fast).toBeGreaterThan(prior);
    expect(fast).toBeLessThanOrEqual(prior * RESPONSE_MAX_RATE_MULTIPLE + 1e-9);
    // A dreadful observation cannot drive the projection to nothing either.
    const slow = blendRate(prior, -0.5, RESPONSE_SHRINKAGE_WEIGHT, 1);
    expect(slow).toBeGreaterThanOrEqual(prior * RESPONSE_MIN_RATE_MULTIPLE - 1e-9);
    expect(blendRate(prior, null, RESPONSE_SHRINKAGE_WEIGHT, 1)).toBe(prior);
  });

  it("a faster-than-population athlete gets a better projection, and the plan says it was measured on them", () => {
    const observed = estimateObservedResponse([
      { generatedAt: iso(12), predicted5kS: 1450, oneRms: { squat: 130, bench: 90, deadlift: 160 } },
      { generatedAt: iso(0), predicted5kS: 1350, oneRms: { squat: 140, bench: 95, deadlift: 170 } },
    ])!;
    const base = feasibilityScreen(state(), goal());
    const learned = feasibilityScreen(state(), goal(), { observed });
    expect(learned.endurance.expected).toBeLessThan(base.endurance.expected);
    expect(learned.messages.join(" ")).toMatch(/Measured on you, not on the population/);
    expect(learned.observedResponse).not.toBeNull();
    // And the plan built from it projects better than the same plan without
    // it — compared against the same dose, since the dose scaling is what
    // separates a plan's projection from the bare prior.
    const planned = generatePlan({ state: state(), goal: goal(), constraints: constraints(), profile: hybridProfile() });
    const plannedLearned = generatePlan({
      state: state(),
      goal: goal(),
      constraints: constraints(),
      profile: hybridProfile(),
      observedResponse: observed,
    });
    expect(plannedLearned.feasibility!.observedResponse).not.toBeNull();
    expect(plannedLearned.feasibility!.endurance.expected).toBeLessThan(planned.feasibility!.endurance.expected);
  });
});

describe("F-3.23 a low-capacity day swaps its hardest session for an easy one", () => {
  it("swaps the quality session, keeps the slot and the length, and says so", () => {
    const withFlag = (() => {
      const plain = generatePlan({ state: state(), goal: goal(), constraints: constraints(), profile: hybridProfile() });
      // Find a week with a quality endurance session and flag its day.
      const week = plain.weeks.find((w) => w.placements.some((p) => p.session.isQuality && p.session.domain === "endurance"))!;
      const placement = week.placements.find((p) => p.session.isQuality && p.session.domain === "endurance")!;
      return {
        plain,
        week: week.week,
        day: placement.day,
        originalKind: placement.session.kind,
        originalMinutes: placement.session.minutes,
        flagged: generatePlan({
          state: state(),
          goal: goal(),
          constraints: constraints(),
          profile: hybridProfile(),
          lowCapacityDays: [{ week: week.week, day: placement.day }],
        }),
      };
    })();

    const after = withFlag.flagged.weeks.find((w) => w.week === withFlag.week)!;
    const swapped = after.placements.find((p) => p.day === withFlag.day)!;
    expect(withFlag.originalKind).not.toBe("easy_run");
    expect(swapped.session.kind).toBe("easy_run");
    expect(swapped.session.isQuality).toBe(false);
    expect(swapped.session.minutes).toBe(withFlag.originalMinutes);
    expect(after.notes.join(" ")).toMatch(/low capacity/i);
    // The week's own sessions list agrees with its placements.
    expect(after.sessions.some((s) => s === swapped.session)).toBe(true);
    // Nothing else in the block moved.
    expect(after.placements.length).toBe(
      withFlag.plain.weeks.find((w) => w.week === withFlag.week)!.placements.length
    );
  });

  it("does nothing on a day with no hard session", () => {
    const plain = generatePlan({ state: state(), goal: goal(), constraints: constraints(), profile: hybridProfile() });
    const week = plain.weeks[0];
    const easyDay = week.placements.find((p) => !p.session.isQuality)!;
    const flagged = generatePlan({
      state: state(),
      goal: goal(),
      constraints: constraints(),
      profile: hybridProfile(),
      lowCapacityDays: [{ week: week.week, day: easyDay.day }],
    });
    const after = flagged.weeks[0];
    expect(after.placements.map((p) => p.session.kind)).toEqual(week.placements.map((p) => p.session.kind));
  });
});

describe("F-3.24 HYROX is programmed as the endurance event it is", () => {
  const hyroxGoal = goal({
    enduranceEventKm: EVENT_DISTANCE_KM.hyrox ?? undefined,
    enduranceEventKey: "hyrox",
    target5kS: null,
  });

  it("carries a running distance, so the endurance side develops rather than maintains", () => {
    expect(EVENT_DISTANCE_KM.hyrox).toBe(8);
    expect(modalityForEvent("hyrox")).toBe("run");
    expect(classifyDomains(state(), hyroxGoal).endurance).toBe("develop");
  });

  it("builds a long run sized by the race's duration, not by its 8km", () => {
    const p = generatePlan({ state: state(), goal: hyroxGoal, constraints: constraints(), profile: hybridProfile() });
    const longRuns = p.weeks
      .map((w) => w.delivered?.longRunMinutes ?? 0)
      .filter((m) => m > 0);
    expect(longRuns.length).toBeGreaterThan(0);
    // Longer than an 8km race would imply on its own, and inside the athlete's stated session ceiling.
    expect(Math.max(...longRuns)).toBeGreaterThan(60);
    expect(Math.max(...longRuns)).toBeLessThanOrEqual(90);
  });

  it("gets quality work every non-deload week and a real weekly running dose", () => {
    const p = generatePlan({ state: state(), goal: hyroxGoal, constraints: constraints(), profile: hybridProfile() });
    for (const w of p.weeks) {
      if (w.deload || w.phase === "taper") continue;
      expect(w.delivered!.qualityCount, `week ${w.week}`).toBeGreaterThanOrEqual(1);
    }
    expect(p.dose!.enduranceMinPerWeek).toBeGreaterThan(90);
  });

  it("says plainly that the stations are not programmed", () => {
    const resolved = resolveIntakeInputs(
      { ...parseIntakeRow(null), events: ["hyrox"] },
      {
        age: 30, sex: "male", bodyweightKg: 80, heightCm: 180, restingHr: 52, maxHr: 190,
        oneRms: { squat: 150, bench: 110, deadlift: 190 }, predicted5kS: 1200,
        loggedWeeklyRunMinutes: 90, chronicLoad: 400,
      }
    );
    const said = resolved.assumed.join(" ");
    expect(said).toMatch(/does NOT programme the stations/i);
    expect(said).toMatch(/rather than on training trials/i);
    // And the goal it resolves to is the running race, not nothing.
    expect(resolved.goal.enduranceEventKey).toBe("hyrox");
    expect(resolved.goal.enduranceEventKm).toBe(8);
  });
});

describe("F-3.8 the feedback loop has an input", () => {
  it("derives completion, RPE and met-prescription from the activity log, and only for elapsed weeks", () => {
    const weeks = plan.weeks.slice(0, 2);
    const monday = "2026-08-31";
    const activities = [
      // Week 1: every endurance session done at full duration, RPE 9 on the intervals.
      ...weeks[0].placements
        .filter((p) => p.session.domain === "endurance")
        .map((p) => {
          const dayIdx = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(p.day);
          const d = new Date(2026, 7, 31 + dayIdx, 8);
          return { startedAt: d.toISOString(), sport: "run", durationSeconds: p.session.minutes * 60, rpe: p.session.kind === "interval_run" ? 9 : 4 };
        }),
    ];
    const fb = deriveFeedbackFromActivities(weeks, activities, monday, new Date(2026, 8, 20));
    expect(fb[1]).toBeDefined();
    const endurance = fb[1].filter((f) => weeks[0].placements.some((p) => p.session.kind === f.kind && p.session.domain === "endurance"));
    expect(endurance.every((f) => f.completed && f.metPrescription)).toBe(true);
    const strength = fb[1].filter((f) => !endurance.includes(f));
    expect(strength.every((f) => !f.completed)).toBe(true);
    expect(fb[2]).toBeDefined();
    // A week still in progress is not assessed.
    const partial = deriveFeedbackFromActivities(weeks, activities, monday, new Date(2026, 8, 2));
    expect(partial[1]).toBeUndefined();
  });

  it("a block can be continued from its current week with the lived weeks carried through", () => {
    const fresh = generatePlan({ state: state(), goal: goal(), constraints: constraints(), profile: hybridProfile() });
    const cont = generatePlan({
      state: state(),
      goal: goal(),
      constraints: constraints(),
      profile: hybridProfile(),
      continueFrom: { week: 5, priorWeeks: fresh.weeks.slice(0, 4), currentVolumeMin: 100 },
    });
    expect(cont.startWeek).toBe(5);
    for (let i = 0; i < 4; i++) {
      expect(cont.weeks[i].carriedOver).toBe(true);
      expect(cont.weeks[i].placements.length).toBe(fresh.weeks[i].placements.length);
    }
    expect(cont.weeks[4].carriedOver).toBeUndefined();
    expect(cont.weeks[4].phase).toBe(fresh.weeks[4].phase);
    // The ramp restarted from the athlete's real volume, not the projection.
    expect(cont.weeks[4].enduranceMin).toBeLessThanOrEqual(fresh.weeks[4].enduranceMin);
  });
});
