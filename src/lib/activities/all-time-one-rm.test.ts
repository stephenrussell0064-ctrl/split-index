import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllTimeLiftRows, bestOneRmByKey } from "./all-time-one-rm";

/**
 * The all-time 1RM source. Two tables carry a column called
 * `estimated_1rm_kg` and they do not hold the same number — see the file
 * header. These tests pin the two properties that matter: the read comes from
 * the engine's table, and the reduction is a plain max per key rather than
 * anything that could reach across rulers.
 */

function fakeSupabase(rows: unknown, capture?: (q: Record<string, unknown>) => void) {
  const q: Record<string, unknown> = {};
  const chain = {
    select(cols: string) {
      q.select = cols;
      return chain;
    },
    eq(col: string, val: unknown) {
      q[col] = val;
      return chain;
    },
    then(resolve: (v: { data: unknown }) => unknown) {
      capture?.(q);
      return Promise.resolve(resolve({ data: rows }));
    },
  };
  return {
    from(table: string) {
      q.table = table;
      return chain;
    },
  } as unknown as SupabaseClient;
}

describe("fetchAllTimeLiftRows", () => {
  it("reads strength_scores, not gym_exercises", async () => {
    // gym_exercises.estimated_1rm_kg is raw Epley over a flat best-set summary:
    // it cannot resolve a per-hand dumbbell, a single-arm cable or a weighted
    // pull-up, and on real logged sessions it disagreed with the engine by
    // -49% to +106% on exactly those movements.
    let seen: Record<string, unknown> = {};
    await fetchAllTimeLiftRows(
      fakeSupabase([], (q) => {
        seen = q;
      }),
      "user-1"
    );
    expect(seen.table).toBe("strength_scores");
    expect(seen.user_id).toBe("user-1");
  });

  it("returns the rows in the shape calculateOverallDotsGl already takes", async () => {
    const rows = await fetchAllTimeLiftRows(
      fakeSupabase([{ exercise_name: "Bench Press", estimated_1rm_kg: 123.5 }]),
      "user-1"
    );
    expect(rows).toEqual([{ exercise_name: "Bench Press", estimated_1rm_kg: 123.5 }]);
  });

  it("survives a query that returns nothing", async () => {
    expect(await fetchAllTimeLiftRows(fakeSupabase(null), "user-1")).toEqual([]);
  });
});

describe("bestOneRmByKey", () => {
  it("keeps the highest per key", () => {
    const best = bestOneRmByKey(
      [
        { exercise_name: "Bench Press", estimated_1rm_kg: 100 },
        { exercise_name: "Bench Press", estimated_1rm_kg: 123.5 },
        { exercise_name: "Bench Press", estimated_1rm_kg: 110 },
      ],
      (n) => n
    );
    expect(best.get("Bench Press")).toBe(123.5);
  });

  it("folds names together through the caller's key function", () => {
    // The same lift gets typed with different casing across sessions, and each
    // page folds names its own way — the Lab by anchor key, Analytics by
    // normalized name — so the key function is the caller's and the reduction
    // is not.
    const best = bestOneRmByKey(
      [
        { exercise_name: "Bench Press", estimated_1rm_kg: 100 },
        { exercise_name: "bench press", estimated_1rm_kg: 120 },
      ],
      (n) => n.toLowerCase()
    );
    expect(best.size).toBe(1);
    expect(best.get("bench press")).toBe(120);
  });

  it("ignores rows with no usable estimate", () => {
    const best = bestOneRmByKey(
      [
        { exercise_name: "Squat", estimated_1rm_kg: null },
        { exercise_name: "Squat", estimated_1rm_kg: 0 },
        { exercise_name: "Deadlift", estimated_1rm_kg: -5 },
      ],
      (n) => n
    );
    expect(best.size).toBe(0);
  });
});
