import { describe, expect, it } from "vitest";
import {
  buildPlanCalendar,
  exerciseLines,
  formatMinutes,
  localIso,
  sessionMetrics,
  unscheduledSessions,
  weekOneStart,
  type PlanSessionView,
  type PlanWeekView,
} from "./plan-calendar";

/**
 * The calendar is the one piece of the day-first screen that can be wrong
 * silently. A component that renders the wrong colour is obvious; a calendar
 * that anchors week 1 to the wrong Monday shows the athlete Saturday's long
 * run on a Wednesday and looks completely normal doing it.
 */

function session(overrides: Partial<PlanSessionView> = {}): PlanSessionView {
  return {
    kind: "easy_run",
    domain: "endurance",
    day: "Mon",
    slot: "AM",
    minutes: 45,
    isQuality: false,
    findingId: "low-volume",
    prescription: "8.0km in 45min at 5:30-6:00/km.",
    emphasisKey: "aerobic_base",
    ...overrides,
  };
}

function week(overrides: Partial<PlanWeekView> = {}): PlanWeekView {
  return {
    week: 1,
    phase: "base",
    deload: false,
    enduranceMin: 180,
    acwr: 1.0,
    stressCapped: 100,
    notes: [],
    sessions: [],
    ...overrides,
  };
}

describe("weekOneStart", () => {
  it("anchors to Monday, matching the engine's DAYS order", () => {
    // A Thursday.
    const start = weekOneStart(new Date(2026, 7, 20));
    expect(start.getDay()).toBe(1);
    expect(localIso(start)).toBe("2026-08-17");
  });

  it("leaves a Monday where it is", () => {
    expect(localIso(weekOneStart(new Date(2026, 7, 17)))).toBe("2026-08-17");
  });

  it("does not roll a Sunday forward into the next week", () => {
    // Sunday 23 August belongs to the week beginning Monday 17th, not the 24th.
    expect(localIso(weekOneStart(new Date(2026, 7, 23)))).toBe("2026-08-17");
  });
});

describe("buildPlanCalendar", () => {
  const planStart = new Date(2026, 7, 20); // Thursday 20 August 2026

  it("dates every day of every week, Monday first", () => {
    const calendar = buildPlanCalendar([week(), week({ week: 2 })], planStart, planStart);
    expect(calendar.days).toHaveLength(14);
    expect(calendar.days[0]!.iso).toBe("2026-08-17");
    expect(calendar.days[0]!.dayName).toBe("Mon");
    expect(calendar.days[6]!.dayName).toBe("Sun");
    expect(calendar.days[7]!.iso).toBe("2026-08-24");
    expect(calendar.days[13]!.iso).toBe("2026-08-30");
  });

  it("puts a session on the calendar day its weekday names", () => {
    const calendar = buildPlanCalendar(
      [week({ sessions: [session({ day: "Sat", kind: "long_run", minutes: 90 })] })],
      planStart,
      planStart
    );
    const saturday = calendar.days.find((d) => d.dayName === "Sat")!;
    expect(saturday.iso).toBe("2026-08-22");
    expect(saturday.sessions).toHaveLength(1);
    expect(saturday.totalMinutes).toBe(90);
    expect(saturday.isRest).toBe(false);
  });

  it("finds today, and marks the days before it as past", () => {
    const calendar = buildPlanCalendar([week()], planStart, planStart);
    expect(calendar.todayIndex).toBe(3); // Thursday is the fourth day of a Monday-first week
    expect(calendar.days[3]!.offsetDays).toBe(0);
    expect(calendar.days[0]!.offsetDays).toBe(-3);
    expect(calendar.days[6]!.offsetDays).toBe(3);
  });

  it("reports todayIndex -1 when today is outside the block", () => {
    const calendar = buildPlanCalendar([week()], planStart, new Date(2026, 8, 30));
    expect(calendar.todayIndex).toBe(-1);
  });

  it("orders AM before PM on a two-session day", () => {
    const calendar = buildPlanCalendar(
      [
        week({
          sessions: [
            session({ day: "Tue", slot: "PM", kind: "squat_heavy", domain: "strength" }),
            session({ day: "Tue", slot: "AM", kind: "easy_run" }),
          ],
        }),
      ],
      planStart,
      planStart
    );
    const tuesday = calendar.days.find((d) => d.dayName === "Tue")!;
    expect(tuesday.sessions.map((s) => s.slot)).toEqual(["AM", "PM"]);
    expect(tuesday.totalMinutes).toBe(90);
  });

  it("keeps weeks consecutive when the block is not numbered from 1", () => {
    const calendar = buildPlanCalendar([week({ week: 5 }), week({ week: 6 })], planStart, planStart);
    expect(calendar.days[0]!.iso).toBe("2026-08-17");
    expect(calendar.days[7]!.iso).toBe("2026-08-24");
    expect(calendar.days[0]!.weekNumber).toBe(5);
  });

  it("never silently dates an unscheduled session", () => {
    const stray = session({ day: null, slot: null });
    const calendar = buildPlanCalendar([week({ sessions: [stray] })], planStart, planStart);
    expect(calendar.days.every((d) => d.isRest)).toBe(true);
    expect(unscheduledSessions(week({ sessions: [stray] }))).toHaveLength(1);
  });

  it("returns an empty calendar rather than throwing on a plan with no weeks", () => {
    const calendar = buildPlanCalendar([], planStart, planStart);
    expect(calendar.days).toEqual([]);
    expect(calendar.todayIndex).toBe(-1);
    expect(calendar.firstDay).toBeNull();
  });
});

describe("rest days", () => {
  const planStart = new Date(2026, 7, 17); // Monday

  it("gives every rest day a reason", () => {
    const calendar = buildPlanCalendar(
      [week({ sessions: [session({ day: "Mon" }), session({ day: "Sat", kind: "long_run" })] })],
      planStart,
      planStart
    );
    const rests = calendar.days.filter((d) => d.isRest);
    expect(rests.length).toBe(5);
    expect(rests.every((d) => (d.restReason ?? "").length > 0)).toBe(true);
  });

  it("says a deload week is deliberate", () => {
    const calendar = buildPlanCalendar([week({ deload: true })], planStart, planStart);
    expect(calendar.days[0]!.restReason).toContain("Deload week");
  });

  it("names the hard session a rest day sits after", () => {
    const calendar = buildPlanCalendar(
      [week({ sessions: [session({ day: "Tue", kind: "interval_run", isQuality: true })] })],
      planStart,
      planStart
    );
    const wednesday = calendar.days.find((d) => d.dayName === "Wed")!;
    expect(wednesday.restReason).toContain("Intervals");
  });

  it("names the hard session a rest day sits before", () => {
    const calendar = buildPlanCalendar(
      [week({ sessions: [session({ day: "Wed", kind: "threshold_run", isQuality: true })] })],
      planStart,
      planStart
    );
    const tuesday = calendar.days.find((d) => d.dayName === "Tue")!;
    expect(tuesday.restReason).toContain("Threshold");
    expect(tuesday.restReason).toContain("tomorrow");
  });

  it("prefers the athlete's own label over the engine's kind", () => {
    const calendar = buildPlanCalendar(
      [week({ sessions: [session({ day: "Tue", kind: "squat_heavy", domain: "strength", label: "Legs", isQuality: true })] })],
      planStart,
      planStart
    );
    expect(calendar.days.find((d) => d.dayName === "Wed")!.restReason).toContain("Legs");
  });
});

describe("presentation helpers", () => {
  it("shows distance, time, pace and heart rate when the engine sent them", () => {
    const metrics = sessionMetrics(
      session({
        distanceKm: 8.04,
        minutes: 45,
        paceLoSPerKm: 330,
        paceHiSPerKm: 360,
        hrLo: 128,
        hrHi: 145,
      })
    );
    expect(metrics.map((m) => m.value)).toEqual(["8.0 km", "45 min", "5:30–6:00/km", "128–145 bpm"]);
    // Distance and time carry the session; the two bands qualify it.
    expect(metrics.map((m) => m.tier)).toEqual(["primary", "primary", "secondary", "secondary"]);
  });

  it("omits what the engine did not send rather than printing a placeholder", () => {
    const metrics = sessionMetrics(session({ minutes: 60, distanceKm: undefined, paceLoSPerKm: undefined }));
    expect(metrics.map((m) => m.key)).toEqual(["time"]);
  });

  it("splits a lift prescription into one exercise per line without changing it", () => {
    const lines = exerciseLines(
      session({
        domain: "strength",
        prescription: "Back squat 4x3-5 @ 140-155kg (85-92% 1RM), RIR 1-2 · Leg press 3x10-15 · Calf raise 3x12-15",
      })
    );
    expect(lines).toEqual([
      "Back squat 4x3-5 @ 140-155kg (85-92% 1RM), RIR 1-2",
      "Leg press 3x10-15",
      "Calf raise 3x12-15",
    ]);
  });

  it("leaves an endurance prescription as one sentence", () => {
    expect(exerciseLines(session())).toEqual([]);
  });

  it("formats durations the way a person says them", () => {
    expect(formatMinutes(45)).toBe("45 min");
    expect(formatMinutes(60)).toBe("1 hr");
    expect(formatMinutes(95)).toBe("1 hr 35 min");
  });
});
