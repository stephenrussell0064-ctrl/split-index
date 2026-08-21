import { describe, expect, it } from "vitest";
import { buildDailyTrainingPayload, widgetDetail, widgetWeekLabel } from "./daily-widget-payload";
import { buildPlanCalendar, type PlanSessionView, type PlanWeekView } from "./plan-calendar";

/**
 * The widget payload is the one output in this feature that nobody proofreads
 * before an athlete acts on it. A wrong colour on a screen is obvious; a
 * confident "10km easy" on a home screen at 7am on a rest day is not, and it
 * gets trained.
 *
 * So these tests are mostly about what the payload must REFUSE to say.
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
    prescription: "8.0km in 45min at 5:30-6:00/km. HR 128-145 (physiological easy band from HR reserve).",
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

const MONDAY = new Date(2026, 7, 17);

describe("status is never collapsed", () => {
  it("is ready when a plan covers today", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session()] })],
      planStart: MONDAY,
      today: MONDAY,
    });
    expect(payload.status).toBe("ready");
    expect(payload.days?.[0]?.date).toBe("2026-08-17");
  });

  it("is noPlan when the engine built nothing", () => {
    const payload = buildDailyTrainingPayload({ weeks: [], planStart: MONDAY, today: MONDAY });
    expect(payload.status).toBe("noPlan");
    expect(payload.days).toBeUndefined();
  });

  it("names the intake as the next step when that is what is missing", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [],
      planStart: MONDAY,
      today: MONDAY,
      needsIntake: true,
      refusalReason: "Your intake is incomplete.",
    });
    // A concrete action beats a description of the problem.
    expect(payload.message).toBe("Finish your intake");
  });

  it("passes the engine's own refusal through when there is no action to name", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [],
      planStart: MONDAY,
      today: MONDAY,
      refusalReason: "New plans are paused while the rollout widens.",
    });
    expect(payload.message).toBe("New plans are paused while the rollout widens.");
  });

  it("is betweenBlocks — not noPlan — when a plan exists but has finished", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session()] })],
      planStart: MONDAY,
      today: new Date(2026, 8, 30),
    });
    // Sending this athlete to an intake form they already filled in would be
    // the wrong instruction, which is why these two statuses are separate.
    expect(payload.status).toBe("betweenBlocks");
    expect(payload.headline).toBe("Block finished");
  });

  it("distinguishes a block that has not started yet", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session()] })],
      planStart: new Date(2026, 8, 7),
      today: MONDAY,
    });
    expect(payload.status).toBe("betweenBlocks");
    expect(payload.headline).toBe("Block not started");
  });
});

describe("a rest day is a real day", () => {
  it("publishes a rest day as a rest day with its reason, never as an absent day", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session({ day: "Tue", kind: "interval_run", isQuality: true })] })],
      planStart: MONDAY,
      today: MONDAY,
    });
    expect(payload.status).toBe("ready");
    const today = payload.days![0]!;
    expect(today.isRest).toBe(true);
    expect(today.restReason).toBeTruthy();
    expect(today.sessions).toEqual([]);
  });

  it("carries no sessions on a rest day, so nothing can render as one", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week()],
      planStart: MONDAY,
      today: MONDAY,
    });
    expect(payload.days!.every((d) => d.isRest && d.sessions.length === 0)).toBe(true);
  });
});

describe("the published horizon", () => {
  it("starts at today and runs a week ahead, so the widget can roll over unaided", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session()] }), week({ week: 2, sessions: [session()] })],
      planStart: MONDAY,
      today: new Date(2026, 7, 19), // Wednesday
    });
    expect(payload.days![0]!.date).toBe("2026-08-19");
    expect(payload.days).toHaveLength(7);
    expect(payload.days![6]!.date).toBe("2026-08-25");
  });

  it("stops at the end of the block rather than inventing days past it", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session()] })],
      planStart: MONDAY,
      today: new Date(2026, 7, 21), // Friday of the only week
    });
    expect(payload.days!.map((d) => d.date)).toEqual(["2026-08-21", "2026-08-22", "2026-08-23"]);
  });

  it("agrees with the screen's own calendar about what today is", () => {
    const weeks = [week({ sessions: [session({ day: "Wed", kind: "long_run", minutes: 90 })] })];
    const today = new Date(2026, 7, 19);
    const calendar = buildPlanCalendar(weeks, MONDAY, today);
    const payload = buildDailyTrainingPayload({ weeks, planStart: MONDAY, today });
    expect(payload.days![0]!.date).toBe(calendar.days[calendar.todayIndex]!.iso);
    expect(payload.days![0]!.totalMinutes).toBe(90);
  });
});

describe("session detail restates, never invents", () => {
  it("gives an endurance session its own numbers", () => {
    expect(
      widgetDetail(
        session({ distanceKm: 10.74, paceLoSPerKm: 299, paceHiSPerKm: 343, hrLo: 141, hrHi: 156 })
      )
    ).toBe("10.7 km · 4:59–5:43/km · HR 141–156");
  });

  it("falls back to the engine's sentence when there are no structured numbers", () => {
    const detail = widgetDetail(
      session({
        distanceKm: undefined,
        prescription: "6 x 800m in 2:48 each (3:24-3:36/km), 90s jog recovery. HR 178-188 on the reps.",
      })
    );
    expect(detail).toBe("6 x 800m in 2:48 each (3:24-3:36/km), 90s jog recovery.");
  });

  it("names the lift that leads a gym session and counts the rest rather than dropping it", () => {
    expect(
      widgetDetail(
        session({
          domain: "strength",
          prescription: "Squat 4x3-6 @ 120-128kg (75-80% 1RM), RIR 1-3 · Leg press 3x10-15 · Leg curl 3x12-15",
        })
      )
    ).toBe("Squat 4x3-6 @ 120-128kg (75-80% 1RM), RIR 1-3 · +2 more");
  });

  it("uses the athlete's own name for the session", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [
        week({
          sessions: [session({ day: "Mon", kind: "squat_volume", domain: "strength", label: "Legs" })],
        }),
      ],
      planStart: MONDAY,
      today: MONDAY,
    });
    expect(payload.days![0]!.sessions[0]!.title).toBe("Legs");
  });

  it("omits an absent slot rather than sending an empty one", () => {
    const payload = buildDailyTrainingPayload({
      weeks: [week({ sessions: [session({ day: "Mon", slot: null })] })],
      planStart: MONDAY,
      today: MONDAY,
    });
    expect(payload.days![0]!.sessions[0]).not.toHaveProperty("slot");
  });
});

describe("week label", () => {
  it("names the phase, and flags a deload", () => {
    const calendar = buildPlanCalendar([week({ week: 4, phase: "base", deload: true })], MONDAY, MONDAY);
    expect(widgetWeekLabel(calendar.days[0]!)).toBe("Week 4 · Base · deload");
  });

  it("leaves a normal week unflagged", () => {
    const calendar = buildPlanCalendar([week({ week: 6, phase: "build" })], MONDAY, MONDAY);
    expect(widgetWeekLabel(calendar.days[0]!)).toBe("Week 6 · Build");
  });
});
