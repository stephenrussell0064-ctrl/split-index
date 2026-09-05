import { describe, expect, it } from "vitest";
import { toPlanWeeks, type StoredWeek } from "./todays-session-data";
import { buildDailyTrainingPayload } from "@/components/hybrid-plan/daily-widget-payload";

/**
 * The dashboard's "today's session" card must distinguish four situations,
 * and the one that matters most is the one this codebase has got wrong
 * before: A REST DAY IS A PRESCRIPTION, not an absence, and must never be
 * rendered as "no plan".
 *
 * These drive the real mapping and the real payload builder over rows shaped
 * exactly as `loadLatestStoredPlan` regroups them, so a change to either the
 * stored-plan shape or the widget builder fails here rather than silently
 * putting the wrong sentence on the home page.
 */

const MONDAY = new Date(2026, 8, 7); // Mon 7 Sep 2026, local time
const WEDNESDAY = new Date(2026, 8, 9);

function placement(
  day: string,
  over: Partial<StoredWeek["placements"][number]["session"]> = {},
  slot: string | null = "AM"
): StoredWeek["placements"][number] {
  return {
    day,
    slot,
    session: {
      kind: "easy_run",
      domain: "endurance",
      minutes: 45,
      isQuality: false,
      findingId: "aerobic_base",
      emphasisKey: "aerobic",
      prescription: { text: "Easy 8.0 km at conversational effort. Keep HR under 145." },
      ...over,
    },
  };
}

function storedWeek(placements: StoredWeek["placements"], deload = false): StoredWeek {
  return {
    week: 1,
    phase: "build",
    deload,
    enduranceMin: 180,
    acwr: 1.05,
    stressCapped: 0,
    notes: [],
    placements,
  };
}

describe("toPlanWeeks — the stored-plan shape the dashboard reads", () => {
  it("carries the engine's prescription sentence through as the session text", () => {
    const [week] = toPlanWeeks([storedWeek([placement("Wed")])]);
    expect(week!.sessions[0]!.prescription).toBe(
      "Easy 8.0 km at conversational effort. Keep HR under 145."
    );
  });

  it("keeps the athlete's own label for a session when the plan stored one", () => {
    const [week] = toPlanWeeks([
      storedWeek([placement("Wed", { kind: "bench_volume", domain: "strength", label: "Push" })]),
    ]);
    expect(week!.sessions[0]!.label).toBe("Push");
  });

  it("invents no structured metrics — the stored rows genuinely carry none", () => {
    const [week] = toPlanWeeks([storedWeek([placement("Wed")])]);
    const session = week!.sessions[0]!;
    expect(session.distanceKm).toBeUndefined();
    expect(session.paceLoSPerKm).toBeUndefined();
    expect(session.hrLo).toBeUndefined();
  });
});

describe("the four states the card has to tell apart", () => {
  it("TRAINING DAY — today's sessions, in slot order", () => {
    const payload = buildDailyTrainingPayload({
      weeks: toPlanWeeks([
        storedWeek([
          placement("Wed", { kind: "bench_volume", domain: "strength", label: "Push" }, "PM"),
          placement("Wed", { kind: "threshold_run", isQuality: true }, "AM"),
        ]),
      ]),
      planStart: MONDAY,
      today: WEDNESDAY,
    });

    expect(payload.status).toBe("ready");
    const today = payload.days![0]!;
    expect(today.isRest).toBe(false);
    expect(today.sessions.map((s) => s.slot)).toEqual(["AM", "PM"]);
    expect(today.weekLabel).toBe("Week 1 · Build");
  });

  it("REST DAY — a real state, with the plan's own reason, NEVER 'no plan'", () => {
    const payload = buildDailyTrainingPayload({
      weeks: toPlanWeeks([
        storedWeek([
          placement("Tue", { kind: "interval_run", isQuality: true }),
          placement("Thu", { kind: "squat_heavy", domain: "strength", isQuality: true }),
        ]),
      ]),
      planStart: MONDAY,
      today: WEDNESDAY,
    });

    // The distinction the whole card hangs on.
    expect(payload.status).toBe("ready");
    const today = payload.days![0]!;
    expect(today.isRest).toBe(true);
    expect(today.sessions).toEqual([]);
    // A rest day with no reason is a blank; the card renders whatever the plan
    // said, so the plan has to have said something.
    expect(today.restReason).toBeTruthy();
    expect(today.restReason).toContain("Rest");
  });

  it("REST DAY on a deload week says the step back IS the training", () => {
    const payload = buildDailyTrainingPayload({
      weeks: toPlanWeeks([storedWeek([placement("Mon")], true)]),
      planStart: MONDAY,
      today: WEDNESDAY,
    });
    expect(payload.days![0]!.isRest).toBe(true);
    expect(payload.days![0]!.restReason).toContain("Deload");
  });

  it("BETWEEN BLOCKS — a finished block is not the same answer as no plan", () => {
    const payload = buildDailyTrainingPayload({
      weeks: toPlanWeeks([storedWeek([placement("Wed")])]),
      planStart: new Date(2026, 5, 1), // a block from three months ago
      today: WEDNESDAY,
    });

    expect(payload.status).toBe("betweenBlocks");
    // Sending this athlete to an intake form they already filled in would be
    // the wrong next step, so the copy must not say "no plan".
    expect(payload.headline).not.toMatch(/no plan/i);
    expect(payload.days).toBeUndefined();
  });

  it("BLOCK NOT STARTED — a plan dated in the future is also not 'no plan'", () => {
    const payload = buildDailyTrainingPayload({
      weeks: toPlanWeeks([storedWeek([placement("Wed")])]),
      planStart: new Date(2026, 11, 1),
      today: WEDNESDAY,
    });

    expect(payload.status).toBe("betweenBlocks");
    expect(payload.headline).toBe("Block not started");
  });

  it("NO PLAN — only when the engine has stored nothing at all", () => {
    const payload = buildDailyTrainingPayload({
      weeks: toPlanWeeks([]),
      planStart: MONDAY,
      today: WEDNESDAY,
    });
    expect(payload.status).toBe("noPlan");
  });
});

describe("week 1 is anchored to when the plan was BUILT, never to today", () => {
  it("does not slide a mid-block plan back to week 1", () => {
    // Generated three weeks ago; today must land in week 3, not week 1.
    const planStart = new Date(2026, 7, 24); // Mon 24 Aug 2026
    const weeks = toPlanWeeks(
      [1, 2, 3, 4].map((n) => ({ ...storedWeek([placement("Wed")]), week: n }))
    );
    const payload = buildDailyTrainingPayload({ weeks, planStart, today: WEDNESDAY });

    expect(payload.status).toBe("ready");
    expect(payload.days![0]!.weekLabel).toBe("Week 3 · Build");
  });
});
