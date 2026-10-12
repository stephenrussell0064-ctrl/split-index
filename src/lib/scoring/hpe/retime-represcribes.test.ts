/**
 * A session's text describes the session the athlete is given.
 *
 * Three reconciliations shorten endurance sessions after they are built, and
 * each rewrote `minutes` and left `prescription` alone — so a 30-minute long
 * run read "12.3km in 63min". The athlete reads the text.
 */
import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { diagnose } from "./diagnostics";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type Goal } from "./intake";
import { fitEnduranceToMinutes, type PlannedSession } from "./session-set";
import { prescribeEndurance } from "./prescription";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function state(o: Partial<AthleteState> = {}): AthleteState {
  return {
    bodyweightKg: 80, heightCm: 180, age: 30, sex: "male",
    oneRms: { squat: 150, bench: 120, deadlift: 190 }, predicted5kS: 1200, predicted5kFromEffort: true,
    strengthTrainingAge: "advanced", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 5, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 69, currentStrengthSessionsPerWeek: 4,
    chronicLoad: 280, restingHr: 47, maxHr: 209,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [], ...o,
  };
}

function goal(o: Partial<Goal> = {}): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    enduranceEventKm: 10, enduranceEventKey: "10k",
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false, ...o,
  };
}

function constraints(o: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ALL_DAYS, twoADaysPossible: true, dayWindows: [], availabilityVaries: false,
    amHour: 7, pmHour: 18, maxSessionsPerWeek: 10, maxHoursPerWeek: 8, maxSessionMin: 150, minRestDays: 1,
    trainingSplit: "ppl_ul", gymAccessDays: ALL_DAYS, equipment: ["barbell"], ...o,
  };
}

const profile = diagnose([], [], { squat: 150, bench: 120, deadlift: 190 }, {
  hrMax: 209, hrRest: 47, hrMaxSource: "measured", priority: 0.5,
});

const CONTINUOUS = /^(\d+(?:\.\d+)?)km in (\d+)min/;

describe("retimed sessions are re-prescribed", () => {
  it("fitEnduranceToMinutes rebuilds the text and distance along with the minutes", () => {
    const long = prescribeEndurance(profile, "long_run", "hybrid-baseline", { minutes: 60 });
    const session: PlannedSession = {
      kind: "long_run", domain: "endurance", intensity: 0.6, isQuality: false, minutes: 60,
      isHeavyLower: false, isDeadlift: false, prescription: long, emphasisKey: "aerobic_base",
      findingId: "hybrid-baseline", stress: 60,
      rebuild: (m) => ({
        kind: "long_run", domain: "endurance", intensity: 0.6, isQuality: false, minutes: m,
        isHeavyLower: false, isDeadlift: false, emphasisKey: "aerobic_base", findingId: "hybrid-baseline", stress: m,
        prescription: prescribeEndurance(profile, "long_run", "hybrid-baseline", { minutes: m }),
      }),
    };
    const fitted = fitEnduranceToMinutes([session], 30);
    const [out] = fitted.sessions;
    expect(out.minutes).toBe(30);
    const m = out.prescription.text.match(CONTINUOUS)!;
    expect(Number(m[2])).toBe(30);
    expect(out.prescription.minutes).toBe(30);
    expect(out.prescription.distanceKm!).toBeLessThan(long.distanceKm!);
  });

  it("every continuous run in a generated plan states its own minutes", () => {
    const variants: Partial<Constraints>[] = [
      {},
      { maxHoursPerWeek: 5 },
      { maxSessionsPerWeek: 6, maxHoursPerWeek: 6 },
    ];
    for (const v of variants) {
      for (const weeksOut of [8, 12]) {
        const plan = generatePlan({ state: state(), goal: goal({ weeksOut }), profile, constraints: constraints(v) });
        for (const w of plan.weeks) {
          for (const s of w.sessions) {
            if (s.domain !== "endurance" || s.modality !== "run") continue;
            const m = s.prescription.text.match(CONTINUOUS);
            if (!m) continue;
            expect(Number(m[2]), `week ${w.week} ${s.kind}: "${s.prescription.text.slice(0, 40)}"`).toBe(Math.round(s.minutes));
            expect(s.prescription.minutes).toBe(s.minutes);
          }
        }
      }
    }
  });
});
