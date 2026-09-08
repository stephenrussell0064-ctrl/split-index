import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

/**
 * A week may not prescribe more endurance than its own budget.
 *
 * `week.enduranceMin` is not an internal number. It is quoted back to the
 * athlete in the week's notes, it is what `affordableBySessionLength` divides
 * up, and the ACWR pass scales it when a week is too hard. When the sessions
 * add up to more than it, the plan is asserting two different volumes for the
 * same week and every one of those readers is working from the wrong one.
 *
 * Swept across 32,400 generated weeks before the fix: 28% were over budget.
 * The worst was a deload week budgeted 25 minutes that carried a 120-minute
 * long run — 4.8x — because the race-distance branch sizes the long run from
 * the event and the athlete's pace and was bounded by everything except the
 * week it has to fit inside.
 */

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
    enduranceEventKm: null, enduranceEventKey: null,
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
const runs = (n: number, km: number, paceS: number): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * paceS, avgHr: 150 }));
const sets = (n: number, lift: string, kg: number, reps: number): LiftSet[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 5, lift, loadKg: kg, reps }));

const ENDURANCE_KINDS = new Set([
  "recovery_run", "easy_run", "long_run", "threshold_run", "interval_run", "rep_run",
]);

/** Every week's prescribed endurance minutes, paired with what it budgeted. */
function weeklyBudgetVsPrescribed(
  s: AthleteState,
  g: Goal,
  c: Constraints
): { week: number; budget: number; prescribed: number }[] {
  const profile = diagnose(
    runs(20, 8, 330),
    sets(10, "squat", 120, 5),
    { squat: 130 },
    { priority: g.priority, hrMax: 190, hrRest: 55 }
  );
  const plan = generatePlan({ profile, state: s, goal: g, constraints: c });
  if (!plan.generated) return [];
  return plan.weeks.map((w) => ({
    week: w.week,
    budget: w.enduranceMin,
    prescribed: w.sessions
      .filter((x) => ENDURANCE_KINDS.has(x.kind))
      .reduce((sum, x) => sum + x.minutes, 0),
  }));
}

describe("a week never prescribes more endurance than it budgeted", () => {
  it("holds for the worst case found in the sweep — a deload week with a marathon long run", () => {
    // budget=25, prescribed=120 before the fix. The 120 is the long run,
    // sized from 42.2km and the athlete's easy pace, capped only by their
    // 120-minute session ceiling — never by the 25-minute week.
    const rows = weeklyBudgetVsPrescribed(
      state({ currentRunMinPerWeek: 30 }),
      goal({ priority: 0.1, weeksOut: 12, enduranceEventKm: 42.2, enduranceEventKey: "marathon" }),
      constraints({ maxSessionMin: 120, maxSessionsPerWeek: 3 })
    );

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(
        r.prescribed,
        `week ${r.week} prescribed ${r.prescribed} against a budget of ${r.budget}`
      ).toBeLessThanOrEqual(r.budget);
    }
  });

  // 96 plans, ~1,150 weeks. Deliberately slower than a unit test: the defect
  // it guards was invisible in any single plan and only showed up in a sweep.
  it("holds across volumes, session ceilings, session counts and events", { timeout: 30_000 }, () => {
    const offenders: string[] = [];
    for (const runMin of [0, 30, 180, 350]) {
      for (const maxSessionMin of [30, 90, 120]) {
        for (const maxSessionsPerWeek of [3, 8]) {
          for (const ev of [
            null,
            { km: 5, key: "5k" },
            { km: 21.1, key: "half_marathon" },
            { km: 42.2, key: "marathon" },
          ]) {
            const rows = weeklyBudgetVsPrescribed(
              state({ currentRunMinPerWeek: runMin }),
              goal({
                weeksOut: 12,
                enduranceEventKm: ev?.km ?? null,
                enduranceEventKey: (ev?.key ?? null) as Goal["enduranceEventKey"],
              }),
              constraints({ maxSessionMin, maxSessionsPerWeek })
            );
            for (const r of rows) {
              if (r.prescribed > r.budget) {
                offenders.push(
                  `run=${runMin} cap=${maxSessionMin} n=${maxSessionsPerWeek} ev=${ev?.key ?? "none"} ` +
                    `wk${r.week}: ${r.prescribed} > ${r.budget}`
                );
              }
            }
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not pay for that by emptying the week", () => {
    // The first version of this fix dropped a whole session whenever a week
    // was over by any amount, so a week 5% over landed far UNDER — it bought
    // more undershoot than it removed. Durations give way before the count
    // does, so a normal week keeps its sessions and stays near its budget.
    const rows = weeklyBudgetVsPrescribed(
      state({ currentRunMinPerWeek: 150 }),
      goal({ weeksOut: 12 }),
      constraints()
    );

    const nonTrivial = rows.filter((r) => r.budget >= 60);
    expect(nonTrivial.length).toBeGreaterThan(0);
    for (const r of nonTrivial) {
      expect(
        r.prescribed / r.budget,
        `week ${r.week} spent only ${r.prescribed} of ${r.budget}`
      ).toBeGreaterThan(0.5);
    }
  });
});
