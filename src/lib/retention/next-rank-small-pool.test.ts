import { describe, expect, it } from "vitest";
import { getNextRankTarget } from "./rank";

/**
 * The hollow crown.
 *
 * `getNextRankTarget` returning null means one thing to the card that reads
 * it: "genuinely #1", answered with a crown and "Nobody's ahead of you
 * globally right now". That claim needs two facts to hold — nobody above, AND
 * a population big enough for the placing to mean something — and only the
 * first was being checked on every path.
 *
 * The standards fallback was meant to catch the small-pool case, and does,
 * right up until the athlete passes the top published tier. Above that it
 * returns null too, and the athlete fell through to the crown. Measured on
 * production, 21 September 2026: ten scored profiles, so no crown on that
 * board could be earned, and the top athlete was one tier away from being
 * told they had won a field of ten.
 *
 * These tests drive the real function against a stubbed PostgREST chain, so
 * they pin the branch rather than the wiring.
 */

type Row = { current_split_index: number };

/**
 * Minimal stand-in for the query builder `getNextRankTarget` uses: one
 * `.gt().order().limit().maybeSingle()` for the athlete above, and one
 * `.select(count, head)` for the pool size.
 */
function fakeSupabase(indexes: number[]) {
  return {
    from() {
      let gtThreshold: number | null = null;
      let counting = false;
      const chain: Record<string, unknown> = {
        select(_cols: string, opts?: { count?: string; head?: boolean }) {
          counting = Boolean(opts?.head);
          return chain;
        },
        gt(_col: string, value: number) {
          gtThreshold = value;
          return chain;
        },
        not() {
          return chain;
        },
        order() {
          return chain;
        },
        limit() {
          return chain;
        },
        maybeSingle() {
          const above = indexes
            .filter((v) => gtThreshold !== null && v > gtThreshold)
            .sort((a, b) => a - b);
          return Promise.resolve({
            data: above.length > 0 ? ({ current_split_index: above[0] } as Row) : null,
          });
        },
        then(resolve: (value: { count: number | null }) => unknown) {
          // The head/count query is awaited directly rather than via maybeSingle.
          return Promise.resolve(resolve({ count: counting ? indexes.length : null }));
        },
      };
      return chain;
    },
  } as never;
}

describe("the next-rank target never awards a crown it has not earned", () => {
  it("does not claim #1 for the top of a ten-athlete board with no tier left", async () => {
    // 960 is past the top published tier, so the standards fallback has
    // nothing to offer — the exact path that used to reach the crown.
    const target = await getNextRankTarget(fakeSupabase([960, 700, 650, 600]), 960);

    expect(target).not.toBeNull();
    expect(target?.type).toBe("unranked_pool");
    if (target?.type === "unranked_pool") {
      expect(target.poolSize).toBe(4);
    }
  });

  it("still offers a tier to climb when there is one", async () => {
    const target = await getNextRankTarget(fakeSupabase([854, 700, 650]), 854);
    expect(target?.type).toBe("standard");
  });

  it("names a real peer whenever somebody is actually ahead", async () => {
    const target = await getNextRankTarget(fakeSupabase([900, 854, 700]), 854);
    expect(target?.type).toBe("peer");
    if (target?.type === "peer") {
      expect(target.nextIndex).toBe(900);
      expect(target.pointsToClose).toBe(46);
    }
  });
});
