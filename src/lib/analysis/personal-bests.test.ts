import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPersonalBestEfforts } from "./records";

/** Minimal stand-in: only `rpc` is ever reached by the function under test. */
function fakeSupabase(result: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn().mockResolvedValue(result);
  return { client: { rpc } as unknown as SupabaseClient, rpc };
}

const ROW = {
  sport: "running",
  distance_meters: 5000,
  elapsed_seconds: "1234.5",
  activity_id: "act-1",
  achieved_at: "2026-09-01T07:00:00.000Z",
  attempts: 4,
};

describe("fetchPersonalBestEfforts", () => {
  it("reads the SQL function, not the table", async () => {
    // The whole reason migration 079 exists: PostgREST cannot express "one row
    // per distance", and a row-limited select silently loses whole distances.
    const { client, rpc } = fakeSupabase({ data: [ROW], error: null });
    await fetchPersonalBestEfforts(client);
    expect(rpc).toHaveBeenCalledWith("personal_best_efforts");
  });

  it("names each distance and derives its pace", async () => {
    const { client } = fakeSupabase({ data: [ROW], error: null });
    const [best] = await fetchPersonalBestEfforts(client);

    expect(best.label).toBe("5K");
    expect(best.elapsedSeconds).toBeCloseTo(1234.5, 1);
    // 1234.5s over 5km is 246.9 s/km.
    expect(best.paceSecondsPerKm).toBeCloseTo(246.9, 1);
    expect(best.activityId).toBe("act-1");
    expect(best.attempts).toBe(4);
  });

  it("labels a ride's distances with cycling's own names", async () => {
    const { client } = fakeSupabase({
      data: [{ ...ROW, sport: "outdoor_cycling", distance_meters: 40_000 }],
      error: null,
    });
    const [best] = await fetchPersonalBestEfforts(client);
    expect(best.sport).toBe("outdoor_cycling");
    expect(best.label).toBe("40K");
  });

  it("copes with numerics arriving as strings", async () => {
    // Postgres NUMERIC comes back as a string through PostgREST, and an
    // unconverted string would render as "NaN" rather than a time.
    const { client } = fakeSupabase({
      data: [{ ...ROW, elapsed_seconds: "900", distance_meters: 1609, attempts: "2" }],
      error: null,
    });
    const [best] = await fetchPersonalBestEfforts(client);
    expect(best.elapsedSeconds).toBe(900);
    expect(best.attempts).toBe(2);
    expect(best.label).toBe("1 mile");
  });

  it("returns nothing rather than throwing when the migration is not applied", async () => {
    // A database behind on 079 costs the athlete a panel, never the page.
    const { client } = fakeSupabase({
      data: null,
      error: { message: 'Could not find the function public.personal_best_efforts' },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(fetchPersonalBestEfforts(client)).resolves.toEqual([]);
    vi.restoreAllMocks();
  });

  it("drops a row that could not describe a real effort", async () => {
    const { client } = fakeSupabase({
      data: [ROW, { ...ROW, distance_meters: 0 }, { ...ROW, elapsed_seconds: 0 }],
      error: null,
    });
    expect(await fetchPersonalBestEfforts(client)).toHaveLength(1);
  });
});
