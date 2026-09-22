import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyOnce, startOfToday } from "./notify";

/**
 * A PostgREST-shaped stub: every filter returns `this`, and the chain is
 * awaited for its result. Enough to assert what was asked for and what was
 * written, which is the whole surface of this module.
 */
function stub(existing: { id: string }[] = [], opts: { lookupError?: string; insertError?: string } = {}) {
  const filters: Record<string, unknown> = {};
  const inserted: Record<string, unknown>[] = [];

  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => ((filters[col] = val), chain),
    gte: (col: string, val: unknown) => ((filters[`${col}>=`] = val), chain),
    limit: () => chain,
    then: (resolve: (r: unknown) => void) =>
      resolve(
        opts.lookupError
          ? { data: null, error: { message: opts.lookupError } }
          : { data: existing, error: null }
      ),
    insert: (row: Record<string, unknown>) => {
      inserted.push(row);
      return Promise.resolve(
        opts.insertError ? { error: { message: opts.insertError } } : { error: null }
      );
    },
  };

  return {
    client: { from: vi.fn(() => chain) } as unknown as SupabaseClient,
    filters,
    inserted,
  };
}

describe("notifyOnce", () => {
  it("writes the row when nothing matches the window", async () => {
    const { client, inserted } = stub([]);

    await expect(
      notifyOnce(client, "u1", { type: "hybrid_report_ready", title: "T", body: "B" })
    ).resolves.toEqual({ inserted: true });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ user_id: "u1", type: "hybrid_report_ready", read: false });
  });

  it("writes nothing when a row of that type is already inside the window", async () => {
    // The cron case: the same schedule runs again against the same period.
    const { client, inserted } = stub([{ id: "existing" }]);

    await expect(
      notifyOnce(client, "u1", { type: "hybrid_report_ready", title: "T", body: "B" })
    ).resolves.toEqual({ inserted: false, reason: "duplicate" });
    expect(inserted).toHaveLength(0);
  });

  it("scopes the lookup to the window when one is given", async () => {
    const since = new Date(2026, 8, 22, 0, 0, 0);
    const { client, filters } = stub([]);

    await notifyOnce(client, "u1", { type: "streak", title: "T", body: "B", since });

    expect(filters["user_id"]).toBe("u1");
    expect(filters["type"]).toBe("streak");
    expect(filters["created_at>="]).toBe(since.toISOString());
  });

  it("asks about all time when no window is given", async () => {
    const { client, filters } = stub([]);
    await notifyOnce(client, "u1", { type: "welcome", title: "T", body: "B" });
    expect(filters["created_at>="]).toBeUndefined();
  });

  it("omits metadata entirely rather than writing null over the column default", async () => {
    const { client, inserted } = stub([]);
    await notifyOnce(client, "u1", { type: "t", title: "T", body: "B" });
    expect(inserted[0]).not.toHaveProperty("metadata");
  });

  it("returns the failure instead of throwing it at the caller", async () => {
    // A notification is a courtesy attached to real work — generating a
    // report, computing a board. It must never be able to fail that work.
    const { client } = stub([], { insertError: "permission denied" });

    await expect(
      notifyOnce(client, "u1", { type: "t", title: "T", body: "B" })
    ).resolves.toEqual({ inserted: false, reason: "error", message: "permission denied" });
  });

  it("does not treat a failed lookup as an absence", async () => {
    // Inserting because the check errored would turn a transient fault into a
    // duplicate notification every time the cron runs.
    const { client, inserted } = stub([], { lookupError: "timeout" });

    const result = await notifyOnce(client, "u1", { type: "t", title: "T", body: "B" });

    expect(result).toEqual({ inserted: false, reason: "error", message: "timeout" });
    expect(inserted).toHaveLength(0);
  });
});

describe("startOfToday", () => {
  it("is midnight of the given instant's own day", () => {
    expect(startOfToday(new Date(2026, 8, 22, 15, 47, 3))).toEqual(new Date(2026, 8, 22, 0, 0, 0, 0));
  });
});
