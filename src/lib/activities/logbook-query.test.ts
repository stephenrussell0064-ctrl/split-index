import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchLogbookPage, parseSort, parseZone, zoneOf } from "./logbook-query";

/**
 * The logbook read path had no tests at all, and one specific gap in it turned
 * a request with an honest empty answer into an unhandled 500.
 *
 * PostgREST answers `.range(offset, …)` with PGRST103 once `offset` exceeds the
 * row count. `fetchLogbookPage` rethrew that as an Error and the route had no
 * handler, so asking for one row past the end crashed — while asking for the
 * row exactly AT the end returned an empty page quite happily. Two sides of the
 * same boundary behaving completely differently.
 */

interface FakeOptions {
  /** Rows the range query returns. */
  rows?: Record<string, unknown>[];
  /** Total the count reports. */
  count?: number | null;
  /** Error the range query fails with. */
  rangeError?: { code?: string; message: string } | null;
  /** Error the head-only count fails with. */
  countError?: { message: string } | null;
}

/**
 * Minimal PostgREST-shaped stub. `head: true` marks the count-only query that
 * the out-of-range branch issues to recover the true total, so the two calls
 * can be answered differently.
 */
function fakeSupabase(opts: FakeOptions) {
  const calls: { head: boolean }[] = [];

  function chain(head: boolean) {
    const c: Record<string, unknown> = {
      then(resolve: (v: unknown) => unknown) {
        calls.push({ head });
        if (head) {
          return Promise.resolve(
            resolve(
              opts.countError
                ? { count: null, error: opts.countError }
                : { count: opts.count ?? 0, error: null }
            )
          );
        }
        return Promise.resolve(
          resolve(
            opts.rangeError
              ? { data: null, count: null, error: opts.rangeError }
              : { data: opts.rows ?? [], count: opts.count ?? 0, error: null }
          )
        );
      },
    };
    for (const m of ["eq", "neq", "order", "range", "in"]) c[m] = () => c;
    return c;
  }

  return {
    client: {
      from: () => ({
        select: (_cols: string, o?: { head?: boolean }) => chain(Boolean(o?.head)),
      }),
    } as unknown as SupabaseClient,
    calls,
  };
}

describe("fetchLogbookPage — an offset past the end", () => {
  it("returns an empty page instead of throwing", async () => {
    const { client } = fakeSupabase({
      rangeError: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: 38,
    });

    const page = await fetchLogbookPage(client, "u1", { offset: 9999, limit: 12 });

    expect(page.entries).toEqual([]);
    expect(page.hasMore).toBe(false);
  });

  it("still reports the TRUE total, not zero", async () => {
    // `count` comes back null on the failed range query, so the total has to be
    // recovered separately. An empty page claiming the athlete has no history
    // would be a worse answer than the crash it replaced.
    const { client, calls } = fakeSupabase({
      rangeError: { code: "PGRST103", message: "Requested range not satisfiable" },
      count: 38,
    });

    const page = await fetchLogbookPage(client, "u1", { offset: 9999, limit: 12 });

    expect(page.total).toBe(38);
    expect(page.nextOffset).toBe(38);
    // One head-only count was issued to get it.
    expect(calls.filter((c) => c.head)).toHaveLength(1);
  });

  it("does not turn an empty page back into a crash when the count also fails", async () => {
    const { client } = fakeSupabase({
      rangeError: { code: "PGRST103", message: "Requested range not satisfiable" },
      countError: { message: "connection reset" },
    });

    const page = await fetchLogbookPage(client, "u1", { offset: 9999 });

    expect(page.entries).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("still throws on a GENUINE failure, which is not the same thing", async () => {
    // A refused policy or a dropped connection is a real error and must not be
    // laundered into "you have no sessions". The route turns this into a 500
    // with a readable sentence.
    const { client } = fakeSupabase({
      rangeError: { code: "42501", message: "permission denied for table activities" },
    });

    await expect(fetchLogbookPage(client, "u1", { offset: 0 })).rejects.toThrow(
      /permission denied/
    );
  });
});

describe("logbook helpers", () => {
  it("splits sports into the two zones the app is built around", () => {
    expect(zoneOf("gym")).toBe("gym");
    expect(zoneOf("running")).toBe("cardio");
    expect(zoneOf("rowing")).toBe("cardio");
  });

  it("falls back rather than trusting a query string", () => {
    expect(parseZone("gym")).toBe("gym");
    expect(parseZone("cardio")).toBe("cardio");
    expect(parseZone("../etc/passwd")).toBe("all");
    expect(parseZone(null)).toBe("all");
    expect(parseSort("oldest")).toBe("oldest");
    expect(parseSort("nonsense")).toBe("recent");
    expect(parseSort(null)).toBe("recent");
  });
});
