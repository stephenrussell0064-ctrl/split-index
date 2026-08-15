/**
 * Regression tests for the five programming defects an athlete found by
 * reading their own plan.
 *
 * Every one of these was live in a plan shown to a real user, and every one is
 * the same shape of failure: a value the athlete supplied never reached the
 * code that needed it, so the engine fell back to a default and presented the
 * default as a decision. The chosen split did not reach the rotation. The
 * "grow muscle" goal did not reach the rep range. The block phase did not
 * reach the quality-session picker. The stored plan did not reach the paused
 * screen. The athlete's actual 5k time did not reach the gain-rate lookup.
 *
 * These test the fixes at the seam where the value was being dropped, not at
 * the surface where it was noticed, because the surface symptom is the easier
 * thing to make pass and the wrong thing to hold still.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { feasibilityScreen, inferredEnduranceTrainingAge } from "./feasibility";
import { ENDURANCE_GAIN_PER_BLOCK, MAX_GAIN_MULTIPLE_OF_RATE } from "./constants";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

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

/** A hybrid athlete with enough history for tier 2+ in both domains. */
function hybrid(c: Partial<Constraints> = {}, g: Partial<Goal> = {}) {
  const runLogs = [
    ...runs(14, 8, 300, 148),
    ...runs(6, 5, 224, 178),
    ...runs(5, 16, 330, 145),
  ];
  const liftSets = [
    ...sets(9, "squat", 130, 5), ...sets(9, "bench", 92, 5),
    ...sets(8, "deadlift", 170, 5), ...sets(8, "squat", 120, 8),
  ];
  const s = state();
  const profile = diagnose(runLogs, liftSets, s.oneRms, {
    priority: g.priority ?? 0.5, hrMax: s.maxHr ?? 190, hrRest: s.restingHr ?? 52, hrMaxSource: "measured",
  });
  return generatePlan({ state: s, goal: goal(g), constraints: constraints(c), profile });
}

describe("training split governs the strength rotation", () => {
  it("gives a PPL athlete push, pull and legs days — not bench and squat days", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    expect(plan.generated).toBe(true);

    const lifts = new Set(
      plan.weeks.flatMap((w) => w.sessions.filter((x) => x.domain === "strength").map((x) => x.lift))
    );
    // A push/pull/legs rotation must reach a pulling primary. The defect was a
    // hardcoded squat/bench alternation that ignored the split entirely, so
    // "deadlift" is the discriminating observation.
    expect(lifts.has("deadlift")).toBe(true);
    expect(lifts.size).toBeGreaterThanOrEqual(3);
  });

  it("gives an upper/lower athlete a different rotation from a PPL athlete", () => {
    const seq = (split: "ppl" | "upper_lower") =>
      hybrid({ trainingSplit: split })
        .weeks[2]?.sessions.filter((s) => s.domain === "strength").map((s) => s.lift).join(",");
    expect(seq("ppl")).not.toEqual(seq("upper_lower"));
  });
});

describe("strength sessions are whole sessions", () => {
  it("prescribes accessories, not a single lift on its own", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const strength = plan.weeks.flatMap((w) => w.sessions).filter((s) => s.domain === "strength");
    expect(strength.length).toBeGreaterThan(0);
    // Every strength session should name more than its primary lift. The
    // defect showed "Bench 4x2" as the entire session.
    for (const s of strength) {
      expect(s.prescription.text.split("·").length).toBeGreaterThan(1);
    }
  });
});

describe("rep ranges follow the goal, not a 1RM default", () => {
  it("uses growth ranges when the athlete set no numeric lift target", () => {
    const plan = hybrid({ trainingSplit: "ppl" });
    const texts = plan.weeks
      .flatMap((w) => w.sessions)
      .filter((s) => s.domain === "strength")
      .map((s) => s.prescription.text);

    // The defect prescribed doubles to an athlete who asked for muscle growth
    // and strength. Nothing in a hypertrophy-leaning block should sit at 2 reps.
    expect(texts.some((t) => /x(1|2)\b/.test(t))).toBe(false);
    expect(texts.some((t) => /x[4-9]|x1[0-2]|-\s?(8|10|12)/.test(t))).toBe(true);
  });
});

describe("endurance quality is programmed, not just volume", () => {
  it("schedules interval and threshold work across the block, not only easy and long runs", () => {
    const plan = hybrid({}, { target5kS: 1080, priority: 0.7 });
    const kinds = plan.weeks.flatMap((w) => w.sessions.map((s) => s.kind));
    expect(kinds).toContain("interval_run");
    expect(kinds).toContain("threshold_run");
  });

  it("rotates the quality kind rather than repeating one session every week", () => {
    const plan = hybrid({}, { target5kS: 1080, priority: 0.7 });
    const perWeek = plan.weeks.map((w) =>
      w.sessions.filter((s) => s.kind === "interval_run" || s.kind === "threshold_run").map((s) => s.kind).join("+")
    );
    expect(new Set(perWeek.filter(Boolean)).size).toBeGreaterThan(1);
  });
});

describe("projected improvement stays inside what a human can do", () => {
  it("does not project an 18:25 runner to 16:22 in eleven weeks", () => {
    const s = state({ predicted5kS: 1105, enduranceTrainingAge: "novice" });
    const f = feasibilityScreen(s, goal({ weeksOut: 11, target5kS: 1080, priority: 0 }));
    // Was 16:22 (982s) — a projection no 18:25 runner has any business being
    // shown. Now ~18:03, which is roughly 2% and is what the advanced rate
    // actually supports over eleven weeks.
    expect(f.projected5kS).toBeGreaterThan(1075);
    expect(f.enduranceGainPct).toBeLessThan(2.5);
  });

  it("scales focus down, never up", () => {
    // The defect was a `2 * share` term that DOUBLED the published rate for a
    // single-sport athlete. Focusing entirely on running may not beat the rate
    // for someone who trains running — that rate already assumes they do.
    const s = state({ predicted5kS: 1105 });
    const focused = feasibilityScreen(s, goal({ weeksOut: 12, priority: 0 }));
    const rate = ENDURANCE_GAIN_PER_BLOCK[inferredEnduranceTrainingAge("intermediate", 1105)];
    expect(focused.enduranceGainPct / 100).toBeLessThanOrEqual(rate * MAX_GAIN_MULTIPLE_OF_RATE + 1e-9);

    // And a split athlete gets less than the focused one, not more.
    const split = feasibilityScreen(s, goal({ weeksOut: 12, priority: 0.5 }));
    expect(split.enduranceGainPct).toBeLessThan(focused.enduranceGainPct);
  });

  it("still lets a genuine beginner improve like a beginner", () => {
    // The caps must not flatten everyone. A 30:00 runner really does move.
    const s = state({ predicted5kS: 1800, enduranceTrainingAge: "novice" });
    const f = feasibilityScreen(s, goal({ weeksOut: 11, priority: 0 }));
    expect(f.enduranceGainPct).toBeGreaterThan(3.5);
  });

  it("quotes a range and says plainly that progress is not linear", () => {
    const s = state({ predicted5kS: 1105, enduranceTrainingAge: "novice" });
    const f = feasibilityScreen(s, goal({ weeksOut: 11, target5kS: 1080, priority: 0 }));

    // The slow end of the band is today's fitness. Eleven weeks of good work
    // can return the same time, and the athlete should not read that as having
    // failed at something the plan promised them.
    expect(f.projected5kRangeS[1]).toBe(1105);
    expect(f.projected5kRangeS[0]).toBe(f.projected5kS);
    expect(f.messages.join(" ")).toMatch(/not improve in a straight line/);
    expect(f.messages.join(" ")).toMatch(/18:0\d-18:25/);
  });

  it("stops treating a fast runner as a novice whatever the intake said", () => {
    // 18:25. Self-reported novice, but nobody runs this as a beginner.
    expect(inferredEnduranceTrainingAge("novice", 1105)).toBe("advanced");
    // A genuinely slow runner keeps the age they reported.
    expect(inferredEnduranceTrainingAge("novice", 1800)).toBe("novice");
    // Inference only ever raises — it never demotes a self-reported veteran.
    expect(inferredEnduranceTrainingAge("elite", 1800)).toBe("elite");
  });
});
