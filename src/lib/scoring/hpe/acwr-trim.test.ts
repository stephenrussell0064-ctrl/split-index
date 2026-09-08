import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

/**
 * When the ACWR pass caps a week, the week has to actually change.
 *
 * `enforceAcwr` lowers a week's permitted stress; engine.ts then scaled
 * `enduranceMin` to match and stopped, while the sessions — already built and
 * scheduled by that point — kept their original durations. Its own comment
 * said "the volume the athlete actually does must follow, or the cap is
 * cosmetic". It was cosmetic.
 *
 * Measured across 900 generated plans holding 92 capped weeks, no week was
 * actually over its trimmed budget, so nothing needed trimming and the guard
 * below changes no output today. What DID mislead every one of those 92 weeks
 * was the note, which announced a trim on the ratio alone.
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

/** Reaches the cap: no chronic load to measure against and a large weekly volume. */
function cappedPlan() {
  const profile = diagnose(runs(20, 8, 330), sets(10, "squat", 120, 5), { squat: 130 }, { priority: 0.5, hrMax: 190, hrRest: 55 });
  return generatePlan({
    profile,
    state: state({ chronicLoad: 0, currentRunMinPerWeek: 600 }),
    goal: goal({ weeksOut: 8 }),
    constraints: constraints({ maxSessionsPerWeek: 3 }),
  });
}

const TRIM_NOTE = /Volume trimmed this week/;

describe("an ACWR-capped week", () => {
  it("produces capped weeks at all, or this file proves nothing", () => {
    const plan = cappedPlan();
    expect(plan.generated).toBe(true);
    expect(plan.weeks.filter((w) => w.stressCapped < w.stress - 0.5).length).toBeGreaterThan(0);
  });

  it("never prescribes more endurance than the budget it was cut to", () => {
    const plan = cappedPlan();
    for (const w of plan.weeks) {
      if (w.stressCapped >= w.stress - 0.5) continue;
      const prescribed = w.sessions
        .filter((s) => s.domain === "endurance")
        .reduce((sum, s) => sum + s.minutes, 0);
      expect(prescribed, `week ${w.week}`).toBeLessThanOrEqual(w.enduranceMin);
    }
  });

  it("only says it trimmed the volume when it trimmed the volume", () => {
    // The regression. This note fired on the ratio alone, so a week whose
    // sessions were untouched still told the athlete their training had been
    // cut back for their safety.
    const plan = cappedPlan();
    for (const w of plan.weeks) {
      const claimsTrim = w.notes.some((n) => TRIM_NOTE.test(n));
      if (!claimsTrim) continue;
      const prescribed = w.sessions
        .filter((s) => s.domain === "endurance")
        .reduce((sum, s) => sum + s.minutes, 0);
      // A week that says it was trimmed must be at its budget, not miles under
      // it — being under is the proof nothing was taken away.
      expect(prescribed, `week ${w.week} claims a trim`).toBeGreaterThanOrEqual(w.enduranceMin);
    }
  });

  it("keeps placements and sessions describing the same week", () => {
    // The schedule the athlete reads is built from `placements`, which alias
    // the very objects in `sessions`. Rewriting one and not the other would
    // leave the calendar showing durations the plan no longer prescribes.
    const plan = cappedPlan();
    for (const w of plan.weeks) {
      for (const p of w.placements) {
        expect(w.sessions, `week ${w.week} placement not in sessions`).toContain(p.session);
      }
    }
  });
});
