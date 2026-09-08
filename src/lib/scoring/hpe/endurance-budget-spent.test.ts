import { describe, expect, it } from "vitest";
import { diagnose } from "./diagnostics";
import { generatePlan } from "./engine";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import type { LiftSet, RunLog } from "./types";

/**
 * A week spends the budget it advertises.
 *
 * The companion to endurance-budget.test.ts, which pins the other direction.
 * Together they say the same thing once: the number in the week's notes and
 * the minutes in the week's sessions are one number, not two.
 *
 * `enduranceMin` came off the macrocycle's volume ramp, which reads the
 * athlete's current weekly running and nothing else. Every session was then
 * capped at their stated maxSessionMin and the count at maxSessionsPerWeek,
 * and nothing checked the ramp's answer against either. Measured over 32,400
 * generated weeks: 54% prescribed under 90% of what they advertised, the
 * median week spent 84%, and the worst plotted 55 minutes under a heading of
 * 468 — an athlete who had said 30-minute sessions, four times a week. 4 x 30
 * is 120, so 468 was never deliverable.
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
const enduranceMinutes = (w: { sessions: { domain: string; minutes: number }[] }) =>
  w.sessions.filter((s) => s.domain === "endurance").reduce((a, b) => a + b.minutes, 0);

describe("a week spends the budget it advertises", () => {
  it("holds for the worst case found in the sweep", () => {
    // 55 minutes prescribed against 468 advertised, before the fix.
    const p = plan(
      state({ currentRunMinPerWeek: 350 }),
      goal(),
      constraints({ maxSessionMin: 30, maxSessionsPerWeek: 4 })
    );
    expect(p.generated).toBe(true);
    for (const w of p.weeks) {
      if (w.enduranceMin <= 0) continue;
      expect(
        enduranceMinutes(w) / w.enduranceMin,
        `week ${w.week} advertised ${w.enduranceMin} and plotted ${enduranceMinutes(w)}`
      ).toBeGreaterThanOrEqual(0.9);
    }
  });

  it("holds across volumes, ceilings, counts and events", { timeout: 60_000 }, () => {
    const bad: string[] = [];
    for (const runMin of [0, 50, 120, 250, 350]) {
      for (const cap of [30, 60, 90, 120]) {
        for (const n of [3, 5, 8]) {
          const p = plan(state({ currentRunMinPerWeek: runMin }), goal(), constraints({ maxSessionMin: cap, maxSessionsPerWeek: n }));
          if (!p.generated) continue;
          for (const w of p.weeks) {
            if (w.enduranceMin <= 0) continue;
            const spent = enduranceMinutes(w) / w.enduranceMin;
            if (spent < 0.9) bad.push(`run=${runMin} cap=${cap} n=${n} wk${w.week}: ${enduranceMinutes(w)}/${w.enduranceMin}`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("gives a big budget more slots to spend itself in, where there is room", () => {
    // The lever is the session COUNT, in the opposite direction from the
    // overshoot pass: too little time forces fewer sessions, too much forces
    // more. With a 30-minute ceiling and room for 8 sessions, a large weekly
    // volume must not be left sitting in two of them.
    const p = plan(
      state({ currentRunMinPerWeek: 300 }),
      goal(),
      constraints({ maxSessionMin: 30, maxSessionsPerWeek: 8 })
    );
    const peak = p.weeks.reduce((best, w) => (w.enduranceMin > best.enduranceMin ? w : best), p.weeks[0]);
    const slots = peak.sessions.filter((s) => s.domain === "endurance").length;
    expect(slots, `peak week had ${slots} endurance slots`).toBeGreaterThan(2);
  });

  it("quotes the minutes it prescribed, not the ones it started with", () => {
    // Both of these notes read the endurance budget BEFORE the reconciliation
    // trimmed it, so a week that prescribed 63 minutes told the athlete "68
    // minutes split any further" and one that prescribed 105 said "at 113
    // weekly minutes". Found by rebuilding two real athletes' plans and
    // reading them, not by a failing assertion.
    const p = plan(
      state({ currentRunMinPerWeek: 68 }),
      goal({ enduranceEventKm: 5, enduranceEventKey: "5k" }),
      constraints({ maxSessionsPerWeek: 10, maxSessionMin: 150 })
    );
    const quoted = /(\d+) (?:minutes split any further|weekly minutes)/;
    let checked = 0;
    for (const w of p.weeks) {
      const spent = enduranceMinutes(w);
      for (const n of w.notes) {
        const m = quoted.exec(n);
        if (!m) continue;
        checked++;
        expect(Number(m[1]), `week ${w.week} quoted ${m[1]} and prescribed ${spent}`).toBe(spent);
      }
    }
    expect(checked, "no week produced a minute-quoting note, so this proves nothing").toBeGreaterThan(0);
  });

  it("names the intake answer that is holding the athlete back", () => {
    // The shortfall is reported because it is actionable in a way engine
    // internals are not: raising maxSessionMin is entirely in the athlete's gift.
    const p = plan(
      state({ currentRunMinPerWeek: 350 }),
      goal(),
      constraints({ maxSessionMin: 30, maxSessionsPerWeek: 4 })
    );
    const explained = p.weeks.some((w) => w.notes.some((n) => /is the limit you gave/.test(n)));
    expect(explained).toBe(true);
  });
});
