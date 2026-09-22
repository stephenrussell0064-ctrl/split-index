import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCardioScoreTrend, fetchStrengthScoreTrend } from "./score-trend";

/**
 * The trend behind the "vs you" number.
 *
 * Four things can go wrong here and none of them look wrong on screen — a line
 * drawn backwards, a line drawn through sessions that never had a personal
 * score, a line that silently stops short of the limit, and a 500 on a database
 * that has not run migration 077. Each has a test.
 */

/** The smallest thing that answers the chain the query actually builds. */
function fakeSupabase(result: { data?: unknown; error?: { code?: string; message?: string } | null }) {
  const calls: { limit?: number; usedIlike?: boolean; filters: Record<string, unknown> } = {
    filters: {},
  };
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      calls.filters[col] = val;
      return builder;
    },
    ilike: (col: string, val: unknown) => {
      calls.filters[col] = val;
      calls.usedIlike = true;
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      calls.limit = n;
      return Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
    },
  };
  const client = { from: () => builder } as unknown as SupabaseClient;
  return { client, calls };
}

const row = (at: string, personal: number | null) => ({
  started_at: at,
  workout_scores: [{ personal_index: personal }],
});

describe("the personal score trend", () => {
  it("returns points oldest first, however the query had to be ordered", () => {
    // The query must be newest-first to take the most RECENT n rows; a chart is
    // read left to right. Getting this backwards draws a block of improvement
    // as a decline and nothing about the picture says so.
    const { client } = fakeSupabase({
      data: [row("2026-09-20T07:00:00Z", 620), row("2026-09-13T07:00:00Z", 480), row("2026-09-06T07:00:00Z", 500)],
    });
    return fetchCardioScoreTrend(client, "u1", "run", "personal").then(({ points }: { points: Array<{ at: string; score: number }> }) => {
      expect(points.map((p: { score: number }) => p.score)).toEqual([500, 480, 620]);
      expect(new Date(points[0].at) < new Date(points[2].at)).toBe(true);
    });
  });

  it("drops sessions that never got a personal score", async () => {
    // Null is a real and common state: fewer than three comparable sessions
    // behind it. Plotting those as zero would draw a cliff that never happened.
    const { client } = fakeSupabase({
      data: [row("2026-09-20T07:00:00Z", 620), row("2026-09-19T07:00:00Z", null), row("2026-09-18T07:00:00Z", 540)],
    });
    const { points } = await fetchCardioScoreTrend(client, "u1", "run", "personal");
    expect(points).toHaveLength(2);
    expect(points.map((p: { score: number }) => p.score)).toEqual([540, 620]);
  });

  it("over-fetches, so a log full of nulls still fills the chart", async () => {
    const { client, calls } = fakeSupabase({ data: [] });
    await fetchCardioScoreTrend(client, "u1", "run", "personal", 30);
    // Asking for exactly 30 rows would return fewer than 30 points whenever any
    // session lacks a score, which is most logs.
    expect(calls.limit).toBeGreaterThan(30);
  });

  it("stops at the limit even when more rows came back", async () => {
    const data = Array.from({ length: 20 }, (_, i) =>
      row(`2026-09-${String(i + 1).padStart(2, "0")}T07:00:00Z`, 500 + i)
    );
    const { client } = fetchPersonalTrendFixture(data);
    const { points } = await fetchCardioScoreTrend(client, "u1", "run", "personal", 5);
    expect(points).toHaveLength(5);
  });

  it("scopes to this athlete and this sport, and not only to RLS", async () => {
    const { client, calls } = fakeSupabase({ data: [] });
    await fetchCardioScoreTrend(client, "u1", "row", "personal");
    expect(calls.filters).toMatchObject({ user_id: "u1", sport: "row" });
  });

  it("answers a database without migration 077 with no chart, not an error", async () => {
    // A sheet that 500s because one additive column is missing is worse than a
    // sheet with no chart on it — the sentences above it explain the score
    // perfectly well on their own.
    const { client } = fakeSupabase({
      error: { code: "42703", message: 'column "personal_index" does not exist' },
    });
    const { points, error } = await fetchCardioScoreTrend(client, "u1", "run", "personal");
    expect(points).toEqual([]);
    expect(error).toBeNull();
  });

  it("still reports a real database failure, rather than drawing an empty chart", async () => {
    // An unreadable trend is not a flat trend. Swallowing this would tell the
    // athlete they have no history when the truth is nothing answered.
    const { client } = fakeSupabase({ error: { code: "57014", message: "statement timeout" } });
    const { points, error } = await fetchCardioScoreTrend(client, "u1", "run", "personal");
    expect(points).toEqual([]);
    expect(error).toBe("statement timeout");
  });

  it("reads an embedded score whether the client shapes it as an object or an array", async () => {
    // PostgREST embeds are typed as arrays even where a unique constraint makes
    // it one row, and the shape has differed between client versions.
    const { client } = fakeSupabase({
      data: [{ started_at: "2026-09-20T07:00:00Z", workout_scores: { personal_index: 610 } }],
    });
    const { points } = await fetchCardioScoreTrend(client, "u1", "run", "personal");
    expect(points).toEqual([{ at: "2026-09-20T07:00:00Z", score: 610 }]);
  });
});

function fetchPersonalTrendFixture(data: unknown[]) {
  return fakeSupabase({ data });
}

describe("the Lab trend, off strength_scores", () => {
  const lift = (at: string, index: number | null) => ({ recorded_at: at, strength_index: index });

  it("returns a lift's scores oldest first", async () => {
    const { client } = fakeSupabase({
      data: [lift("2026-09-20T07:00:00Z", 712), lift("2026-09-13T07:00:00Z", 690)],
    });
    const { points } = await fetchStrengthScoreTrend(client, "u1", "Bench Press", "population");
    expect(points.map((p) => p.score)).toEqual([690, 712]);
  });

  it("matches the lift case-insensitively", async () => {
    // The same lift reaches this table as "Bench Press" and "bench press"
    // depending on where it was logged. An `eq` here would silently draw half
    // an athlete's history and look exactly like a short training log.
    const { client, calls } = fakeSupabase({ data: [] });
    await fetchStrengthScoreTrend(client, "u1", "Bench Press", "population");
    expect(calls.usedIlike).toBe(true);
    expect(calls.filters).toMatchObject({ user_id: "u1", exercise_name: "Bench Press" });
  });

  it("reports a real failure rather than drawing an empty chart", async () => {
    const { client } = fakeSupabase({ error: { code: "57014", message: "statement timeout" } });
    const { points, error } = await fetchStrengthScoreTrend(client, "u1", "Squat", "population");
    expect(points).toEqual([]);
    expect(error).toBe("statement timeout");
  });

  it("does not swallow a missing column for a score that has always existed", async () => {
    // The degradable path is for `personal_index`, which arrived with 077.
    // `strength_index` has been there since 002, so its absence is a real fault
    // and hiding it would hide a broken schema.
    const { client } = fakeSupabase({
      error: { code: "42703", message: 'column "strength_index" does not exist' },
    });
    const { error } = await fetchStrengthScoreTrend(client, "u1", "Squat", "population");
    expect(error).not.toBeNull();
  });
});
