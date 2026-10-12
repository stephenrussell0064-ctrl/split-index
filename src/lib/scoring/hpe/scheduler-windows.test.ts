/**
 * The scheduler reads the athlete's per-day windows.
 *
 * `Constraints.dayWindows` was collected, parsed and passed in since migration
 * 043 and never read: every session went at the flat `amHour`, a second slot
 * existed only under the GLOBAL two-a-days flag (default false), and the
 * sessions that did not fit were dropped without a note. The reported shape
 * was an athlete with "two sessions possible" ticked on three days who could
 * not get a plan with two sessions on any day.
 */
import { describe, expect, it } from "vitest";
import { generatePlan } from "./engine";
import { diagnose } from "./diagnostics";
import { DEFAULT_SAFETY_FLAGS, type AthleteState, type Constraints, type DayWindow, type Goal } from "./intake";
import { hardViolations, scheduleWeek, slotCandidates, slotHoursFor, type Placement } from "./scheduler";
import type { PlannedSession } from "./session-set";
import { FLOOR_SEPARATION_H } from "./constants";

const ALL_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function constraints(overrides: Partial<Constraints> = {}): Constraints {
  return {
    daysAvailable: ALL_DAYS,
    twoADaysPossible: false,
    dayWindows: [],
    availabilityVaries: false,
    amHour: 7,
    pmHour: 18,
    maxSessionsPerWeek: 10,
    maxHoursPerWeek: 10,
    maxSessionMin: 150,
    minRestDays: 1,
    trainingSplit: null,
    gymAccessDays: ALL_DAYS,
    equipment: ["barbell"],
    ...overrides,
  };
}

function window(day: string, startHour: number, endHour: number, extra: Partial<DayWindow> = {}): DayWindow {
  return { day, available: true, startHour, endHour, twoSessions: false, ...extra };
}

/** The reported week: early mornings Mon-Wed, late evenings Thu-Fri, weekends free, doubles on Wed/Sat/Sun. */
const REPORTED_WINDOWS: DayWindow[] = [
  window("Mon", 5.5, 7),
  window("Tue", 5.5, 7),
  window("Wed", 5.5, 21, { twoSessions: true }),
  window("Thu", 20.5, 22),
  window("Fri", 20.5, 22),
  window("Sat", 7, 18, { twoSessions: true }),
  window("Sun", 7, 18, { twoSessions: true }),
];

function session(
  kind: PlannedSession["kind"],
  domain: PlannedSession["domain"],
  opts: Partial<PlannedSession> = {}
): PlannedSession {
  return {
    kind,
    domain,
    intensity: 0.7,
    isQuality: false,
    minutes: 60,
    isHeavyLower: false,
    isDeadlift: false,
    prescription: { text: kind, findingId: "hybrid-baseline", minutes: 60 },
    emphasisKey: domain === "strength" ? "maximal_strength" : "aerobic_base",
    findingId: "hybrid-baseline",
    stress: 50,
    ...opts,
  };
}

const FIVE_DAY_SPLIT: PlannedSession[] = [
  session("bench_volume", "strength", { label: "Push", lift: "bench" }),
  session("deadlift_volume", "strength", { label: "Pull", lift: "deadlift" }),
  session("squat_volume", "strength", { label: "Legs", lift: "squat" }),
  session("bench_volume", "strength", { label: "Upper", lift: "bench" }),
  session("squat_volume", "strength", { label: "Lower", lift: "squat" }),
];
const THREE_RUNS: PlannedSession[] = [
  session("easy_run", "endurance", { stress: 30 }),
  session("easy_run", "endurance", { stress: 30 }),
  session("long_run", "endurance", { stress: 60 }),
];

describe("slotHoursFor — what one day offers", () => {
  it("falls back to the flat hours for a day with no window, honouring the global two-a-days flag", () => {
    expect(slotHoursFor("Mon", constraints())).toEqual([7]);
    expect(slotHoursFor("Mon", constraints({ twoADaysPossible: true }))).toEqual([7, 18]);
  });

  it("offers nothing on a day the athlete marked as a rest day, whatever the days list says", () => {
    const c = constraints({ dayWindows: [window("Mon", 7, 18, { available: false })] });
    expect(slotHoursFor("Mon", c)).toEqual([]);
  });

  it("starts the single session at the window's own start, not the flat morning hour", () => {
    const c = constraints({ dayWindows: [window("Thu", 20.5, 22)] });
    expect(slotHoursFor("Thu", c)).toEqual([20.5]);
  });

  it("gives one slot per window when the athlete entered several", () => {
    const c = constraints({
      dayWindows: [window("Mon", 6, 21, { windows: [{ startHour: 6, endHour: 7 }, { startHour: 18, endHour: 21 }] })],
    });
    expect(slotHoursFor("Mon", c)).toEqual([6, 18]);
  });

  it("puts the second session of a two-session day late in the window, so it still fits", () => {
    const c = constraints({ dayWindows: [window("Sat", 7, 18, { twoSessions: true })] });
    expect(slotHoursFor("Sat", c)).toEqual([7, 17]);
  });

  it("refuses a double inside a window too short to separate the two sessions", () => {
    const c = constraints({ dayWindows: [window("Mon", 5.5, 7, { twoSessions: true })] });
    expect(slotHoursFor("Mon", c)).toEqual([5.5]);
    expect(7 - 5.5).toBeLessThan(FLOOR_SEPARATION_H);
  });

  it("ignores the global flag on a day that has its own window", () => {
    const c = constraints({ twoADaysPossible: true, dayWindows: [window("Mon", 5.5, 7)] });
    expect(slotHoursFor("Mon", c)).toEqual([5.5]);
  });
});

describe("scheduleWeek — the reported week", () => {
  const c = constraints({ dayWindows: REPORTED_WINDOWS, trainingSplit: "ppl_ul" });

  it("counts ten slots: seven days, three of them doubles", () => {
    expect(slotCandidates(c)).toHaveLength(10);
  });

  it("places all eight sessions, trains twice on at least one day, and keeps a rest day", () => {
    const result = scheduleWeek([...FIVE_DAY_SPLIT, ...THREE_RUNS], c);
    expect(result.droppedSessions).toEqual([]);
    expect(result.placements).toHaveLength(8);
    expect(result.hardPenalty).toBe(0);

    const perDay = new Map<string, Placement[]>();
    for (const p of result.placements) perDay.set(p.day, [...(perDay.get(p.day) ?? []), p]);
    expect([...perDay.values()].some((ps) => ps.length === 2)).toBe(true);
    // Eight sessions on at most six days means a rest day survived.
    expect(perDay.size).toBeLessThanOrEqual(6);
  });

  it("places every session at a clock time inside that day's own window", () => {
    const result = scheduleWeek([...FIVE_DAY_SPLIT, ...THREE_RUNS], c);
    for (const p of result.placements) {
      const w = REPORTED_WINDOWS.find((x) => x.day === p.day)!;
      expect(p.hour, `${p.day} ${p.session.label ?? p.session.kind}`).toBeGreaterThanOrEqual(w.startHour);
      expect(p.hour).toBeLessThanOrEqual(w.endHour);
      expect(p.slot).toBe(p.hour! < 12 ? "AM" : "PM");
    }
  });

  it("only doubles up on the days the athlete said they could", () => {
    const result = scheduleWeek([...FIVE_DAY_SPLIT, ...THREE_RUNS], c);
    const counts = new Map<string, number>();
    for (const p of result.placements) counts.set(p.day, (counts.get(p.day) ?? 0) + 1);
    for (const [day, n] of counts) {
      if (n > 1) expect(["Wed", "Sat", "Sun"], day).toContain(day);
    }
  });

  it("without the windows — the old behaviour — the same week has no room and carries hard violations", () => {
    const flat = constraints({ trainingSplit: "ppl_ul" });
    const result = scheduleWeek([...FIVE_DAY_SPLIT, ...THREE_RUNS], flat);
    expect(result.slotCount).toBe(7);
    expect(result.droppedSessions).toHaveLength(1);
    // Seven sessions on seven days: no rest day, and a seven-day streak.
    expect(result.hardPenalty).toBeGreaterThan(0);
  });
});

describe("strength stays on gym days", () => {
  it("never places a lift on a day the athlete cannot reach a gym", () => {
    const c = constraints({ gymAccessDays: ["Mon", "Wed", "Fri"] });
    const result = scheduleWeek([...FIVE_DAY_SPLIT.slice(0, 3), ...THREE_RUNS.slice(0, 2)], c);
    expect(result.hardPenalty).toBe(0);
    for (const p of result.placements) {
      if (p.session.domain === "strength") expect(["Mon", "Wed", "Fri"]).toContain(p.day);
    }
  });

  it("a lift on a non-gym day is a hard violation", () => {
    const c = constraints({ gymAccessDays: ["Mon"] });
    const placements: Placement[] = [{ session: FIVE_DAY_SPLIT[0], day: "Tue", slot: "AM", hour: 7 }];
    expect(hardViolations(placements, c)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Through the whole engine
// ---------------------------------------------------------------------------

function state(): AthleteState {
  return {
    bodyweightKg: 80, heightCm: 180, age: 30, sex: "male",
    oneRms: { squat: 150, bench: 120, deadlift: 190 }, predicted5kS: 1200, predicted5kFromEffort: true,
    strengthTrainingAge: "advanced", enduranceTrainingAge: "intermediate",
    strengthTrainingYears: 5, enduranceTrainingYears: 2,
    currentRunMinPerWeek: 120, currentStrengthSessionsPerWeek: 4,
    chronicLoad: 500, restingHr: 50, maxHr: 195,
    safety: { ...DEFAULT_SAFETY_FLAGS, injuryLast12Weeks: false, surgeryLast6Months: false },
    assumed: [],
  };
}

function goal(): Goal {
  return {
    weeksOut: 12, horizonSource: "chosen_timeframe", target5kS: null,
    enduranceEventKm: 10, enduranceEventKey: "10k",
    targetSquatKg: null, targetBenchKg: null, targetDeadliftKg: null, targetTotalKg: null,
    priority: 0.5, sameDay: false, interEventGapH: 4, weightClassKg: null, eventOrderKnown: false,
  };
}

const profile = diagnose([], [], { squat: 150, bench: 120, deadlift: 190 }, {
  hrMax: 195, hrRest: 50, hrMaxSource: "measured", priority: 0.5,
});

describe("generatePlan honours the per-day windows", () => {
  it("a five-day split plus running fits a week with doubles, and nothing is dropped", () => {
    const plan = generatePlan({
      state: state(), goal: goal(), profile,
      constraints: constraints({ dayWindows: REPORTED_WINDOWS, trainingSplit: "ppl_ul" }),
    });
    expect(plan.generated).toBe(true);
    const developing = plan.weeks.filter((w) => w.phase !== "taper");
    for (const w of developing) {
      expect(w.droppedSessions, `week ${w.week}`).toEqual([]);
      expect(w.hardPenalty, `week ${w.week}`).toBe(0);
      expect(w.placements.length).toBe(w.sessions.length);
    }
    const doubled = developing.some((w) => {
      const counts = new Map<string, number>();
      for (const p of w.placements) counts.set(p.day, (counts.get(p.day) ?? 0) + 1);
      return [...counts.values()].some((n) => n > 1);
    });
    expect(doubled).toBe(true);
  });

  it("tells the athlete when a week could not hold every session, and what would make room", () => {
    const plan = generatePlan({
      state: state(), goal: goal(), profile,
      constraints: constraints({
        daysAvailable: ["Mon", "Tue", "Wed", "Thu"],
        gymAccessDays: ["Mon", "Tue", "Wed", "Thu"],
        trainingSplit: "ppl_ul",
      }),
    });
    const week = plan.weeks[0];
    expect(week.droppedSessions.length).toBeGreaterThan(0);
    expect(week.notes.join(" ")).toMatch(/could not be placed this week/);
    expect(week.notes.join(" ")).toMatch(/two sessions/);
  });
});
