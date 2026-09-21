/**
 * The single-session spike rule (Frandsen 2025), and the deload's long run.
 *
 * The rule is the one progression control in the running literature with a
 * large prospective cohort behind it: 5,205 runners, 588,071 sessions, and a
 * hazard ratio of 1.64 to 2.28 for a run past 10% of the longest of the last
 * 30 days. In the same cohort the week-to-week ratio predicted nothing and
 * the acute:chronic ratio ran the wrong way, which is why this is the rule
 * the long run is bound by and ACWR is not.
 */

import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { SESSION_SPIKE_MAX_MULTIPLE } from "./constants";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { RunLog } from "./types";

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 78, heightCm: 178, age: 32, sex: "male",
    oneRms: { squat: 140, bench: 95, deadlift: 170 },
    predicted5kS: 1350, predicted5kFromEffort: true,
    strengthTrainingAge: "intermediate", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 2, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 150, currentStrengthSessionsPerWeek: 2,
    chronicLoad: 320, restingHr: 56, maxHr: 190,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}
function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 16, horizonSource: "event_date", target5kS: 1200,
    enduranceEventKm: 42.195, enduranceEventKey: "marathon",
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.3, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}
function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    twoADaysPossible: false, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 6, maxHoursPerWeek: 10,
    maxSessionMin: 180, minRestDays: 1, trainingSplit: null,
    gymAccessDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    equipment: ["barbell"], ...o,
  };
}
const runs = (n: number, km: number, paceS: number, opts: Partial<RunLog> = {}): RunLog[] =>
  Array.from({ length: n }, (_, i) => ({ dateIdx: i * 3, distanceKm: km, durationS: km * paceS, avgHr: 150, ...opts }));

function profile() {
  return diagnose(
    [
      ...runs(30, 10, 330, { splitsSPerKm: Array(10).fill(330), hrByKm: [148, 150, 153, 156, 158, 160, 162, 164, 166, 168] }),
      { dateIdx: 8, distanceKm: 5, durationS: 1350, avgHr: 183, isMaxEffort: true },
      { dateIdx: 55, distanceKm: 10, durationS: 2880, avgHr: 178, isMaxEffort: true },
    ],
    [], { squat: 140, bench: 95, deadlift: 170 }, { priority: 0.3, hrMax: 190, hrRest: 56 }
  );
}

describe("the single-session spike rule binds the long run", () => {
  const plan = generatePlan({
    // A marathoner whose longest recent run is 60 minutes. The race distance
    // wants far more than that, and the rule is what makes it a ramp.
    state: state({ longestRecentRunMin: 60 }),
    goal: goal(),
    constraints: constraints(),
    profile: profile(),
  });
  const longRuns = plan.weeks.map((w) => w.sessions.find((s) => s.kind === "long_run")?.minutes ?? 0);

  it("never steps more than 10% past the longest of the previous four weeks", () => {
    for (let i = 0; i < longRuns.length; i++) {
      if (longRuns[i] <= 0) continue;
      const priorWindow = longRuns.slice(Math.max(0, i - 4), i).filter((m) => m > 0);
      const anchor = priorWindow.length > 0 ? Math.max(...priorWindow) : 60;
      expect(longRuns[i], `week ${i + 1} stepped past its anchor`).toBeLessThanOrEqual(
        Math.round(anchor * SESSION_SPIKE_MAX_MULTIPLE) + 1
      );
    }
  });

  it("still builds toward the race rather than staying flat", () => {
    const first = longRuns.find((m) => m > 0)!;
    const peak = Math.max(...longRuns);
    expect(peak).toBeGreaterThan(first * 1.3);
  });

  it("brings the long run down on a deload rather than leaving it untouched", () => {
    for (const w of plan.weeks) {
      if (!w.deload) continue;
      const i = plan.weeks.indexOf(w);
      const before = longRuns.slice(Math.max(0, i - 4), i).filter((m) => m > 0);
      const thisWeek = longRuns[i];
      if (before.length === 0 || thisWeek <= 0) continue;
      expect(thisWeek, `deload week ${w.week} kept its long run`).toBeLessThan(Math.max(...before));
    }
  });

  it("does not fire when there is no recent long run to anchor on", () => {
    const noAnchor = generatePlan({
      state: state({ longestRecentRunMin: null }),
      goal: goal(),
      constraints: constraints(),
      profile: profile(),
    });
    // Week one is free to be sized by the race and the week's own volume;
    // the rule has nothing to measure against and says nothing.
    const firstLong = noAnchor.weeks[0].sessions.find((s) => s.kind === "long_run")?.minutes ?? 0;
    expect(firstLong).toBeGreaterThan(0);
  });
});
