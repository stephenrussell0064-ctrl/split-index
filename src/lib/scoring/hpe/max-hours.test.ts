import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

/**
 * The hours the athlete said they have are a limit, not a suggestion.
 *
 * `maxHoursPerWeek` is asked for in the intake, stored on the record and
 * carried into `Constraints` — and until now read by nothing at all. The
 * comment on STRENGTH_WARMUP_MIN describes giving strength sessions real
 * durations so "the athlete's own maxHoursPerWeek and maxSessionMin limits
 * could see them", but only maxSessionMin was ever wired up.
 *
 * Measured across 8,640 generated weeks: 22% exceeded the stated hours. The
 * worst handed someone who answered "3 hours a week" a 542-minute week — nine
 * hours, every week, for a whole block.
 */

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male", oneRms: {}, predicted5kS: 1400,
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
    maxSessionMin: 90, minRestDays: 1, trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  };
}
const runs = (n: number, km: number, p: number): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * p, avgHr: 150 }));
const sets = (n: number, l: string, kg: number, r: number): LiftSet[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 5, lift: l, loadKg: kg, reps: r }));

function plan(s: AthleteState, g: Goal, c: Constraints) {
  const profile = diagnose(runs(20, 8, 330), sets(10, "squat", 120, 5), { squat: 130 }, { priority: g.priority, hrMax: 190, hrRest: 55 });
  return generatePlan({ profile, state: s, goal: g, constraints: c });
}
const totalMinutes = (w: { sessions: { minutes: number }[] }) =>
  w.sessions.reduce((a, b) => a + b.minutes, 0);
const domainMinutes = (w: { sessions: { domain: string; minutes: number }[] }, d: string) =>
  w.sessions.filter((s) => s.domain === d).reduce((a, b) => a + b.minutes, 0);

describe("the athlete's stated weekly hours", () => {
  it("are not exceeded in the worst case found in the sweep", () => {
    // 542 minutes against a stated 3 hours, before the fix.
    const p = plan(
      state({ currentRunMinPerWeek: 350 }),
      goal({ priority: 0.1 }),
      constraints({ maxHoursPerWeek: 3, maxSessionsPerWeek: 8, maxSessionMin: 90 })
    );
    expect(p.generated).toBe(true);
    for (const w of p.weeks) {
      expect(totalMinutes(w), `week ${w.week}`).toBeLessThanOrEqual(3 * 60);
    }
  });

  it("hold across hours, volumes, session counts and ceilings", { timeout: 60_000 }, () => {
    const bad: string[] = [];
    for (const hours of [3, 4, 5, 6, 8, 10]) {
      for (const runMin of [0, 120, 350]) {
        for (const n of [3, 6, 8]) {
          const p = plan(state({ currentRunMinPerWeek: runMin }), goal(), constraints({ maxHoursPerWeek: hours, maxSessionsPerWeek: n }));
          if (!p.generated) continue;
          for (const w of p.weeks) {
            if (totalMinutes(w) > hours * 60) bad.push(`hrs=${hours} run=${runMin} n=${n} wk${w.week}: ${totalMinutes(w)} > ${hours * 60}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("take it out of endurance before touching the lifting", () => {
    // Endurance is the volume dial; strength is a session count carrying a
    // minimum dose. A tight week should shorten the running, not delete the
    // squat day.
    const tight = plan(state({ currentRunMinPerWeek: 350 }), goal(), constraints({ maxHoursPerWeek: 4 }));
    for (const w of tight.weeks) {
      expect(
        w.sessions.filter((s) => s.domain === "strength").length,
        `week ${w.week} kept no lifting`
      ).toBeGreaterThanOrEqual(1);
    }
  });

  it("still leave the endurance label equal to the endurance prescribed", () => {
    // The companion invariant from endurance-budget-spent.test.ts must survive
    // this second trim — cutting the sessions and not the heading is exactly
    // the defect that pass exists to prevent.
    const p = plan(state({ currentRunMinPerWeek: 350 }), goal(), constraints({ maxHoursPerWeek: 4 }));
    for (const w of p.weeks) {
      if (w.enduranceMin <= 0) continue;
      expect(domainMinutes(w, "endurance"), `week ${w.week}`).toBeLessThanOrEqual(w.enduranceMin);
    }
  });
});
