/**
 * A week the athlete has logged into is kept as it was, and a block whose rows
 * did not change is the same block.
 */
import { describe, expect, it } from "vitest";
import {
  FROZEN_WEEK_NOTE,
  freezeLoggedWeeks,
  mondayOf,
  sessionFromStored,
  weekOffset,
  weeksMatchStoredRows,
  type PlanContinuity,
  type StoredPlanSession,
} from "./plan-continuity";
import type { PlanWeek } from "./engine";
import type { PlannedSession } from "./session-set";

function session(kind: PlannedSession["kind"], minutes: number, distanceKm?: number): PlannedSession {
  const domain = kind.endsWith("_run") ? "endurance" : "strength";
  return {
    kind, domain, intensity: 0.7, isQuality: false, minutes, isHeavyLower: false, isDeadlift: false,
    prescription: { text: `${kind} ${minutes}`, findingId: "hybrid-baseline", minutes, ...(distanceKm != null ? { distanceKm } : {}) },
    emphasisKey: domain === "strength" ? "maximal_strength" : "aerobic_base", findingId: "hybrid-baseline", stress: 40,
  };
}

function week(n: number, placements: { day: string; session: PlannedSession }[]): PlanWeek {
  return {
    week: n, phase: "base", deload: false, enduranceMin: 60, phaseProgress: 0,
    sessions: placements.map((p) => p.session),
    placements: placements.map((p) => ({ session: p.session, day: p.day, slot: "AM" as const, hour: 7 })),
    allocation: {} as PlanWeek["allocation"], notes: ["generated note"], penalty: 0, hardPenalty: 0, stress: 80, stressCapped: 80, acwr: 1, droppedSessions: [],
  } as unknown as PlanWeek;
}

function stored(id: string, w: number, day: string, kind: StoredPlanSession["kind"], minutes: number, extra: Partial<StoredPlanSession> = {}): StoredPlanSession {
  return {
    id, week: w, phase: "base", isDeload: false, day, slot: "PM", kind, label: null, lift: null, intensity: null,
    isHeavyLower: null, isDeadlift: null, stress: null, domain: kind.endsWith("_run") ? "endurance" : "strength",
    emphasisKey: "aerobic_base", isQuality: false, minutes, distanceKm: null, paceLoSPerKm: null, paceHiSPerKm: null,
    hrLo: null, hrHi: null, hrSource: null, prescription: `stored ${kind} ${minutes}`, findingId: "low-volume", ...extra,
  };
}

const GENERATED_AT = "2026-10-12T09:00:00.000Z"; // Monday 12 Oct

function continuity(sessions: StoredPlanSession[], logged: string[]): PlanContinuity {
  return {
    planId: "plan-old", generatedAt: GENERATED_AT, sessions, loggedSessionIds: new Set(logged),
    findings: [{ id: "low-volume", text: "You run less than your 5k needs." }],
  };
}

describe("calendar anchoring", () => {
  it("finds the Monday, and counts whole weeks between two anchors", () => {
    expect(mondayOf(new Date("2026-10-18T20:00:00")).getDay()).toBe(1);
    expect(weekOffset(new Date("2026-10-12T09:00:00"), new Date("2026-10-18T20:00:00"))).toBe(0);
    expect(weekOffset(new Date("2026-10-12T09:00:00"), new Date("2026-10-19T06:00:00"))).toBe(1);
  });
});

describe("freezeLoggedWeeks", () => {
  it("replaces a logged week with the stored one and says so, leaving the rest alone", () => {
    const weeks = [
      week(1, [{ day: "Sun", session: session("long_run", 37, 6.2) }]),
      week(2, [{ day: "Sun", session: session("long_run", 40, 6.8) }]),
    ];
    const c = continuity(
      [stored("s1", 1, "Sun", "long_run", 33, { distanceKm: 5.55 }), stored("s2", 2, "Sun", "long_run", 36)],
      ["s1"]
    );
    const out = freezeLoggedWeeks(weeks, c, new Date("2026-10-18T13:01:00"));
    expect(out.frozenWeeks).toEqual([1]);
    expect(out.weeks[0].placements[0].session.minutes).toBe(33);
    expect(out.weeks[0].placements[0].session.prescription.distanceKm).toBe(5.55);
    expect(out.weeks[0].placements[0].slot).toBe("PM");
    expect(out.weeks[0].notes[0]).toBe(FROZEN_WEEK_NOTE);
    expect(out.weeks[0].notes).toContain("generated note");
    expect(out.weeks[1].placements[0].session.minutes).toBe(40);
    expect(out.findings).toEqual([{ id: "low-volume", text: "You run less than your 5k needs." }]);
  });

  it("matches by calendar week when the rebuild happens in a later week", () => {
    // Stored week 2 is the calendar week a plan rebuilt on Monday 19 Oct calls week 1.
    const weeks = [week(1, [{ day: "Tue", session: session("easy_run", 30) }])];
    const c = continuity([stored("s1", 1, "Sun", "long_run", 33), stored("s2", 2, "Tue", "easy_run", 25)], ["s2"]);
    const out = freezeLoggedWeeks(weeks, c, new Date("2026-10-19T06:00:00"));
    expect(out.frozenWeeks).toEqual([1]);
    expect(out.weeks[0].placements[0].session.minutes).toBe(25);
  });

  it("does nothing when nothing has been logged", () => {
    const weeks = [week(1, [{ day: "Sun", session: session("long_run", 37) }])];
    const out = freezeLoggedWeeks(weeks, continuity([stored("s1", 1, "Sun", "long_run", 33)], []), new Date("2026-10-18"));
    expect(out.frozenWeeks).toEqual([]);
    expect(out.weeks).toBe(weeks);
  });

  it("reads the stored lift columns when present and infers them when not", () => {
    const exact = sessionFromStored(stored("s", 1, "Mon", "squat_heavy", 60, { lift: "squat", intensity: 0.9, isHeavyLower: true, isDeadlift: false, stress: 85 }));
    expect(exact).toMatchObject({ lift: "squat", intensity: 0.9, isHeavyLower: true, isDeadlift: false, stress: 85 });
    const inferred = sessionFromStored(stored("s", 1, "Mon", "deadlift_heavy", 60));
    expect(inferred).toMatchObject({ lift: "deadlift", isHeavyLower: true, isDeadlift: true });
    expect(inferred.stress).toBeGreaterThan(0);
  });
});

describe("weeksMatchStoredRows", () => {
  const weeks = [
    week(1, [{ day: "Mon", session: session("squat_volume", 66) }, { day: "Sun", session: session("long_run", 33, 5.55) }]),
  ];
  const rows = [
    { week: 1, day_of_week: "Sun", slot: "AM", kind: "long_run", minutes: "33.0", distance_km: "5.55", prescription: "long_run 33" },
    { week: 1, day_of_week: "Mon", slot: "AM", kind: "squat_volume", minutes: 66, distance_km: null, prescription: "squat_volume 66" },
  ];

  it("is true for the same rows in any order, with numeric columns as strings", () => {
    expect(weeksMatchStoredRows(weeks, rows)).toBe(true);
  });

  it("is false when a session moved, changed length, or is missing", () => {
    expect(weeksMatchStoredRows(weeks, [{ ...rows[0], minutes: 37 }, rows[1]])).toBe(false);
    expect(weeksMatchStoredRows(weeks, [{ ...rows[0], day_of_week: "Sat" }, rows[1]])).toBe(false);
    expect(weeksMatchStoredRows(weeks, [rows[0]])).toBe(false);
  });
});
