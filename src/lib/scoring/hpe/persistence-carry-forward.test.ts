/**
 * A rebuilt plan keeps what the athlete already logged against the old one.
 *
 * Logging a session from the plan changes the diagnostic, which rebuilds the
 * block on the next visit with new session ids — so the run logged at 12:59
 * had vanished from the plan's view of the week by 13:01.
 */
import { describe, expect, it } from "vitest";
import { savePlan } from "./persistence";
import { HPE_CONSTANTS_VERSION } from "./constants";
import type { PlannedSession } from "./session-set";
import type { PlanWeek } from "./engine";
import type { FindingId } from "./types";

type Call = { table: string; op: string; args: unknown[]; filters: unknown[] };

function stub(opts: {
  current: Record<string, unknown> | null;
  oldSessions: { id: string; week: number; day_of_week: string; kind: string }[];
  linkedActivities: { id: string; hpe_session_id: string }[];
  feedback: Record<string, unknown>[];
}) {
  const calls: Call[] = [];
  let sessionInsertCount = 0;
  const from = (table: string) => {
    const call: Call = { table, op: "select", args: [], filters: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "insert", "update", "upsert"]) {
      chain[op] = (...args: unknown[]) => {
        if (op !== "select") call.op = op;
        call.args.push(...args);
        return chain;
      };
    }
    for (const f of ["eq", "is", "neq", "in", "order", "limit"]) {
      chain[f] = (...args: unknown[]) => {
        call.filters.push([f, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = async () => ({ data: table === "hpe_plans" ? opts.current : null, error: null });
    chain.single = async () => ({ data: { id: "plan-new" }, error: null });
    chain.then = (resolve: (v: unknown) => void) => {
      if (table === "hpe_sessions" && call.op === "insert") {
        const rows = call.args[0] as { week: number; day_of_week: string; kind: string }[];
        return resolve({
          data: rows.map((r) => ({ id: `new-${++sessionInsertCount}`, week: r.week, day_of_week: r.day_of_week, kind: r.kind })),
          error: null,
        });
      }
      if (table === "hpe_sessions" && call.op === "select") return resolve({ data: opts.oldSessions, error: null });
      if (table === "activities" && call.op === "select") return resolve({ data: opts.linkedActivities, error: null });
      if (table === "hpe_session_feedback" && call.op === "select") return resolve({ data: opts.feedback, error: null });
      return resolve({ data: null, error: null, count: 0 });
    };
    return chain;
  };
  return { supabase: { from } as never, calls };
}

function session(kind: PlannedSession["kind"], domain: PlannedSession["domain"]): PlannedSession {
  return {
    kind, domain, intensity: 0.7, isQuality: false, minutes: 40, isHeavyLower: false, isDeadlift: false,
    prescription: { text: kind, findingId: "hybrid-baseline", minutes: 40 },
    emphasisKey: "aerobic_base", findingId: "hybrid-baseline", stress: 40,
  };
}

function week(placements: { day: string; session: PlannedSession }[]): PlanWeek {
  return {
    week: 1, phase: "base", deload: false, enduranceMin: 60, phaseProgress: 0,
    sessions: placements.map((p) => p.session),
    placements: placements.map((p) => ({ session: p.session, day: p.day, slot: "AM" as const, hour: 7 })),
    allocation: {} as PlanWeek["allocation"], notes: [], penalty: 0, hardPenalty: 0, stress: 0, stressCapped: 0, acwr: 1, droppedSessions: [],
  } as unknown as PlanWeek;
}

const goal = { weeksOut: 5, priority: 0.5 } as unknown as Parameters<typeof savePlan>[2]["goal"];
const constraints = { daysAvailable: ["Mon", "Sun"] } as unknown as Parameters<typeof savePlan>[2]["constraints"];
const CURRENT = {
  id: "plan-old", profile_id: "profile-OLD", constants_version: HPE_CONSTANTS_VERSION,
  weeks_out: 5, event_date: null, goal, constraints,
};

function args(weeks: PlanWeek[]) {
  return {
    profileId: "profile-new",
    findingIds: new Map<FindingId, string>([["hybrid-baseline", "finding-1"]]),
    constantsVersion: HPE_CONSTANTS_VERSION,
    goal, constraints, weeks, eventDate: null,
  };
}

describe("savePlan carries a session's records across a rebuild", () => {
  it("moves the activity link and copies the feedback onto the matching new session", async () => {
    const { supabase, calls } = stub({
      current: CURRENT,
      oldSessions: [
        { id: "old-run", week: 1, day_of_week: "Sun", kind: "long_run" },
        { id: "old-lift", week: 1, day_of_week: "Mon", kind: "squat_volume" },
      ],
      linkedActivities: [{ id: "act-1", hpe_session_id: "old-run" }],
      feedback: [{ user_id: "u", session_id: "old-run", completed: true, met_prescription: true, logged_at: "2026-10-18T12:59:00Z" }],
    });
    const result = await savePlan(supabase, "u", args([
      week([{ day: "Mon", session: session("squat_volume", "strength") }, { day: "Sun", session: session("long_run", "endurance") }]),
    ]));
    expect(result?.planId).toBe("plan-new");

    const move = calls.find((c) => c.table === "activities" && c.op === "update");
    expect(move).toBeDefined();
    expect(move!.args[0]).toEqual({ hpe_session_id: "new-2" });
    expect(move!.filters).toContainEqual(["eq", "id", "act-1"]);

    const copy = calls.find((c) => c.table === "hpe_session_feedback" && c.op === "upsert");
    expect(copy).toBeDefined();
    expect(copy!.args[0]).toEqual([
      { user_id: "u", session_id: "new-2", completed: true, met_prescription: true, logged_at: "2026-10-18T12:59:00Z" },
    ]);
    expect(copy!.args[1]).toMatchObject({ onConflict: "session_id", ignoreDuplicates: true });
  });

  it("still matches a session the rebuild moved to another day, when it is the only one of its kind that week", async () => {
    const { supabase, calls } = stub({
      current: CURRENT,
      oldSessions: [{ id: "old-run", week: 1, day_of_week: "Sat", kind: "long_run" }],
      linkedActivities: [{ id: "act-1", hpe_session_id: "old-run" }],
      feedback: [],
    });
    await savePlan(supabase, "u", args([week([{ day: "Sun", session: session("long_run", "endurance") }])]));
    const move = calls.find((c) => c.table === "activities" && c.op === "update");
    expect(move!.args[0]).toEqual({ hpe_session_id: "new-1" });
  });

  it("does not guess between two sessions of the same kind on different days", async () => {
    const { supabase, calls } = stub({
      current: CURRENT,
      oldSessions: [{ id: "old-easy", week: 1, day_of_week: "Tue", kind: "easy_run" }],
      linkedActivities: [{ id: "act-1", hpe_session_id: "old-easy" }],
      feedback: [],
    });
    await savePlan(supabase, "u", args([
      week([{ day: "Mon", session: session("easy_run", "endurance") }, { day: "Wed", session: session("easy_run", "endurance") }]),
    ]));
    expect(calls.find((c) => c.table === "activities" && c.op === "update")).toBeUndefined();
  });

  it("touches nothing when there was no previous block", async () => {
    const { supabase, calls } = stub({ current: null, oldSessions: [], linkedActivities: [], feedback: [] });
    await savePlan(supabase, "u", args([week([{ day: "Sun", session: session("long_run", "endurance") }])]));
    expect(calls.filter((c) => c.table === "activities")).toHaveLength(0);
    expect(calls.filter((c) => c.table === "hpe_session_feedback")).toHaveLength(0);
  });
});
