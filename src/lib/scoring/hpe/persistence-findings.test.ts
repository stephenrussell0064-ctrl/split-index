/**
 * A stored plan keeps every session the engine built.
 *
 * `savePlan` resolved each session's finding against the rows of the LAST
 * STORED diagnostic, and the plan was generated from the CURRENT one. When the
 * two disagreed about which findings exist, every session citing the newer
 * finding failed the lookup and was dropped — observed live as a plan with four
 * lifting sessions a week stored with none. The row the foreign key wants is
 * written from the finding the plan was built with instead.
 */
import { describe, expect, it } from "vitest";
import { savePlan } from "./persistence";
import { HPE_CONSTANTS_VERSION } from "./constants";
import { HYBRID_BASELINE_FINDING, type PlannedSession } from "./session-set";
import type { Finding, FindingId } from "./types";
import type { PlanWeek } from "./engine";

type Call = { table: string; op: string; args: unknown[] };

function recordingSupabase() {
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
    for (const f of ["eq", "is", "neq", "order", "limit"]) {
      chain[f] = () => chain;
    }
    chain.maybeSingle = async () => ({ data: null, error: null });
    chain.single = async () => ({ data: { id: "plan-new" }, error: null });
    chain.then = (resolve: (v: unknown) => void) => {
      if (table === "hpe_findings" && call.op === "upsert") {
        const rows = call.args[0] as { finding_key: string }[];
        return resolve({ data: rows.map((r) => ({ id: `finding-${r.finding_key}`, finding_key: r.finding_key })), error: null });
      }
      return resolve({ data: null, error: null, count: 0 });
    };
    return chain;
  };
  return { supabase: { from } as never, calls };
}

function session(findingId: FindingId, kind: PlannedSession["kind"], domain: PlannedSession["domain"]): PlannedSession {
  return {
    kind, domain, intensity: 0.8, isQuality: false, minutes: 60, isHeavyLower: false, isDeadlift: false,
    prescription: { text: kind, findingId, minutes: 60 }, emphasisKey: "maximal_strength", findingId, stress: 50,
  };
}

function week(sessions: PlannedSession[]): PlanWeek {
  return {
    week: 1, phase: "base", deload: false, enduranceMin: 60, phaseProgress: 0,
    sessions, placements: sessions.map((s, i) => ({ session: s, day: ["Mon", "Wed", "Fri"][i % 3], slot: "AM" as const, hour: 7 })),
    allocation: {} as PlanWeek["allocation"], notes: [], penalty: 0, hardPenalty: 0, stress: 0, stressCapped: 0, acwr: 1, droppedSessions: [],
  } as unknown as PlanWeek;
}

const findings: Finding[] = [{ id: "under-built", text: "Your rep profile says volume, not intensity, is what is missing." }];

const base = {
  profileId: "profile-1",
  constantsVersion: HPE_CONSTANTS_VERSION,
  goal: { weeksOut: 8, priority: 0.5 } as unknown as Parameters<typeof savePlan>[2]["goal"],
  constraints: { daysAvailable: ["Mon", "Wed", "Fri"] } as unknown as Parameters<typeof savePlan>[2]["constraints"],
  eventDate: null,
};

describe("savePlan and findings the stored diagnostic never emitted", () => {
  it("writes the missing finding and stores the session rather than dropping it", async () => {
    const { supabase, calls } = recordingSupabase();
    const sessions = [session("under-built", "bench_volume", "strength"), session("low-volume", "easy_run", "endurance")];
    const result = await savePlan(supabase, "user-1", {
      ...base,
      findingIds: new Map<FindingId, string>([["low-volume", "finding-existing"]]),
      weeks: [week(sessions)],
      findings,
    });

    const upsert = calls.find((c) => c.table === "hpe_findings" && c.op === "upsert");
    expect(upsert).toBeDefined();
    const rows = upsert!.args[0] as { profile_id: string; finding_key: string; body: string }[];
    expect(rows).toEqual([{ profile_id: "profile-1", finding_key: "under-built", body: findings[0].text, ordinal: 1 }]);

    const insert = calls.find((c) => c.table === "hpe_sessions" && c.op === "insert");
    const stored = insert!.args[0] as { finding_id: string; kind: string }[];
    expect(stored.map((r) => r.kind).sort()).toEqual(["bench_volume", "easy_run"]);
    expect(stored.find((r) => r.kind === "bench_volume")!.finding_id).toBe("finding-under-built");
    expect(result?.droppedSessions).toBe(0);
  });

  it("knows the baseline rationale without being told", async () => {
    const { supabase, calls } = recordingSupabase();
    await savePlan(supabase, "user-1", {
      ...base,
      findingIds: new Map(),
      weeks: [week([session("hybrid-baseline", "strength_maintenance", "strength")])],
    });
    const upsert = calls.find((c) => c.table === "hpe_findings" && c.op === "upsert");
    const rows = upsert!.args[0] as { finding_key: string; body: string }[];
    expect(rows[0]).toMatchObject({ finding_key: HYBRID_BASELINE_FINDING.id, body: HYBRID_BASELINE_FINDING.text });
  });

  it("still drops a session citing a finding the plan cannot name", async () => {
    const { supabase, calls } = recordingSupabase();
    const result = await savePlan(supabase, "user-1", {
      ...base,
      findingIds: new Map(),
      weeks: [week([session("stalled-lift", "squat_heavy", "strength")])],
      findings: [],
    });
    expect(calls.some((c) => c.table === "hpe_findings" && c.op === "upsert")).toBe(false);
    expect(result?.droppedSessions).toBe(1);
  });
});
