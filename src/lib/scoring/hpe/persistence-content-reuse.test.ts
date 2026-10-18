/**
 * The same rows are the same block, whatever the diagnostic's row id says.
 *
 * Two plans with identical sessions were written sixteen seconds apart on a
 * live account because the diagnostic had been re-stored in between.
 */
import { describe, expect, it } from "vitest";
import { savePlan } from "./persistence";
import { HPE_CONSTANTS_VERSION } from "./constants";
import type { PlannedSession } from "./session-set";
import type { PlanWeek } from "./engine";
import type { FindingId } from "./types";

type Call = { table: string; op: string; args: unknown[] };

function stub(current: Record<string, unknown> | null, storedRows: Record<string, unknown>[]) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, op: "select", args: [] };
    calls.push(call);
    const chain: Record<string, unknown> = {};
    for (const op of ["select", "insert", "update", "upsert"]) {
      chain[op] = (...args: unknown[]) => {
        if (op !== "select") call.op = op;
        call.args.push(...args);
        return chain;
      };
    }
    for (const f of ["eq", "is", "neq", "in", "order", "limit"]) chain[f] = () => chain;
    chain.maybeSingle = async () => ({ data: table === "hpe_plans" ? current : null, error: null });
    chain.single = async () => ({ data: { id: "plan-new" }, error: null });
    chain.then = (resolve: (v: unknown) => void) => {
      if (table === "hpe_sessions" && call.op === "select") return resolve({ data: storedRows, error: null });
      if (table === "hpe_sessions" && call.op === "insert") {
        return resolve({ data: (call.args[0] as unknown[]).map((_, i) => ({ id: `new-${i}` })), error: null });
      }
      return resolve({ data: null, error: null, count: storedRows.length });
    };
    return chain;
  };
  return { supabase: { from } as never, calls };
}

function session(kind: PlannedSession["kind"], minutes: number, distanceKm?: number): PlannedSession {
  const domain = kind.endsWith("_run") ? "endurance" : "strength";
  return {
    kind, domain, intensity: 0.7, isQuality: false, minutes, isHeavyLower: false, isDeadlift: false,
    prescription: { text: `${kind} ${minutes}`, findingId: "hybrid-baseline", minutes, ...(distanceKm != null ? { distanceKm } : {}) },
    emphasisKey: "aerobic_base", findingId: "hybrid-baseline", stress: 40,
  };
}

const weeks: PlanWeek[] = [
  {
    week: 1, phase: "base", deload: false, enduranceMin: 33, phaseProgress: 0,
    sessions: [session("long_run", 33, 5.55)],
    placements: [{ session: session("long_run", 33, 5.55), day: "Sun", slot: "PM", hour: 18 }],
    allocation: {} as PlanWeek["allocation"], notes: [], penalty: 0, hardPenalty: 0, stress: 40, stressCapped: 40, acwr: 1, droppedSessions: [],
  } as unknown as PlanWeek,
];

const NOW = new Date("2026-10-18T13:01:44Z");
const goal = { weeksOut: 5, priority: 0.5 } as unknown as Parameters<typeof savePlan>[2]["goal"];
const constraints = { daysAvailable: ["Sun"] } as unknown as Parameters<typeof savePlan>[2]["constraints"];
const current = {
  id: "plan-old", profile_id: "profile-OLD", generated_at: "2026-10-18T13:01:28Z",
  constants_version: HPE_CONSTANTS_VERSION, weeks_out: 5, event_date: null, goal, constraints,
};
const matchingRow = { week: 1, day_of_week: "Sun", slot: "PM", kind: "long_run", minutes: "33.0", distance_km: "5.55", prescription: "long_run 33" };

function args() {
  return {
    profileId: "profile-NEW",
    findingIds: new Map<FindingId, string>([["hybrid-baseline", "f1"]]),
    constantsVersion: HPE_CONSTANTS_VERSION, goal, constraints, weeks, eventDate: null, now: NOW,
  };
}

describe("savePlan reuses a block whose rows did not change", () => {
  it("matches a goal the database handed back with its keys reordered and its undefined members gone", async () => {
    const reordered = { ...current, profile_id: "profile-NEW", goal: { priority: 0.5, weeksOut: 5 } };
    const { supabase, calls } = stub(reordered, []);
    const result = await savePlan(supabase, "u", {
      ...args(),
      goal: { weeksOut: 5, priority: 0.5, targetSquatKg: undefined } as unknown as ReturnType<typeof args>["goal"],
    });
    expect(result).toMatchObject({ planId: "plan-old", reused: true });
    expect(calls.some((c) => c.table === "hpe_plans" && c.op === "insert")).toBe(false);
  });

  it("reuses on identical rows even when the goal text differs", async () => {
    const { supabase, calls } = stub({ ...current, goal: { ...goal, priority: 0.6 } }, [matchingRow]);
    const result = await savePlan(supabase, "u", args());
    expect(result).toMatchObject({ planId: "plan-old", reused: true });
    expect(calls.some((c) => c.table === "hpe_plans" && c.op === "insert")).toBe(false);
  });

  it("returns the stored block when the diagnostic was re-stored but every session is the same", async () => {
    const { supabase, calls } = stub(current, [matchingRow]);
    const result = await savePlan(supabase, "u", args());
    expect(result).toMatchObject({ planId: "plan-old", reused: true });
    expect(calls.some((c) => c.table === "hpe_plans" && c.op === "insert")).toBe(false);
  });

  it("writes a new block when a session changed", async () => {
    const { supabase, calls } = stub(current, [{ ...matchingRow, minutes: 37, distance_km: 6.22 }]);
    const result = await savePlan(supabase, "u", args());
    expect(result?.planId).toBe("plan-new");
    expect(calls.some((c) => c.table === "hpe_plans" && c.op === "insert")).toBe(true);
  });

  it("writes a new block when the stored one anchors to an earlier calendar week, even with the same rows", async () => {
    const { supabase, calls } = stub({ ...current, generated_at: "2026-10-05T09:00:00Z" }, [matchingRow]);
    const result = await savePlan(supabase, "u", args());
    expect(result?.planId).toBe("plan-new");
    expect(calls.some((c) => c.table === "hpe_plans" && c.op === "insert")).toBe(true);
  });

  it("stores the lift columns a frozen week is rebuilt from", async () => {
    const { supabase, calls } = stub(null, []);
    await savePlan(supabase, "u", args());
    const insert = calls.find((c) => c.table === "hpe_sessions" && c.op === "insert")!;
    expect((insert.args[0] as Record<string, unknown>[])[0]).toMatchObject({
      intensity: 0.7, is_heavy_lower: false, is_deadlift: false, stress: 40, label: null, lift: null,
    });
  });
});
