import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Write-path integrity for POST /api/races ("Upcoming races").
 *
 * The athlete reported that Save simply did not work. The cause was schema
 * drift, not bad input: migration 037 widened
 * planned_races.elevation_source to allow 'known' (elevation taken from the
 * curated known-race dropdown), and on a database that hadn't had 037
 * applied Postgres rejected the insert with a 23514 check violation. Every
 * race picked from that dropdown — the first and most prominent control in
 * the form — was lost, and the athlete was shown the raw Postgres sentence.
 *
 * These tests pin the contract that covers the gap: a race is never lost
 * over a provenance label, a failed save is never reported as a success,
 * and a failure is always explained in words an athlete can read without
 * throwing away the underlying reason a developer needs.
 */

const USER_ID = "user-1";

type QueryResult = { data: unknown; error: PostgrestLikeError | null };

interface PostgrestLikeError {
  code?: string;
  message: string;
  details?: string | null;
}

interface RecordedInsert {
  table: string;
  payload: Record<string, unknown>;
}

/**
 * Minimal stand-in for the Supabase query builder: modifiers return the same
 * chain and awaiting it resolves whatever `respond` returns for that write.
 * Enough to drive the real route handler end to end with no database, and it
 * records every insert payload so tests can assert what actually reached it.
 */
function createFakeSupabase(respond: (insert: RecordedInsert, attempt: number) => QueryResult) {
  const inserts: RecordedInsert[] = [];

  function chainFor(table: string) {
    let payload: Record<string, unknown> | null = null;

    const result = (): QueryResult => {
      if (payload === null) return { data: [], error: null };
      const record = { table, payload };
      inserts.push(record);
      return respond(record, inserts.length);
    };

    const chain: Record<string, unknown> = {
      then(resolve: (value: QueryResult) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(resolve(result()));
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
      insert: (values: Record<string, unknown>) => {
        payload = values;
        return chain;
      },
    };
    for (const modifier of ["select", "eq", "neq", "gte", "lte", "order", "limit", "single", "maybeSingle"]) {
      chain[modifier] = () => chain;
    }
    return chain;
  }

  const client = {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: (table: string) => chainFor(table),
  };

  return { client, inserts };
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));

const geocodeLocationMock = vi.fn();
vi.mock("@/lib/external/open-meteo", () => ({
  geocodeLocation: (query: string) => geocodeLocationMock(query),
  fetchDailyForecast: async () => null,
}));

function racePayload(overrides: Record<string, unknown> = {}) {
  return {
    eventName: "London Marathon",
    locationName: "London, UK",
    raceDate: "2026-04-26",
    distanceMeters: 42195,
    elevationGainMeters: "127",
    elevationSource: "known",
    ...overrides,
  };
}

function postRequest(payload: unknown) {
  return new Request("http://localhost/api/races", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function postWith(
  respond: (insert: RecordedInsert, attempt: number) => QueryResult,
  payload: unknown = racePayload()
) {
  const { client, inserts } = createFakeSupabase(respond);
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(postRequest(payload));
  return { response, body: await response.json(), inserts };
}

/** What the live database did before migration 037 was applied. */
const ELEVATION_SOURCE_CHECK_VIOLATION: PostgrestLikeError = {
  code: "23514",
  message: 'new row for relation "planned_races" violates check constraint "planned_races_elevation_source_check"',
  details: "Failing row contains (…, known).",
};

const SAVED_RACE = { id: "race-1", user_id: USER_ID, event_name: "London Marathon" };

const alwaysSaves = (): QueryResult => ({ data: SAVED_RACE, error: null });

beforeEach(() => {
  geocodeLocationMock.mockResolvedValue({ latitude: 51.5, longitude: -0.12, resolvedName: "London, England, UK" });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/races", () => {
  it("saves a race picked from the known-race dropdown", async () => {
    const { response, body, inserts } = await postWith(alwaysSaves);

    expect(response.status).toBe(200);
    expect(body.race).toEqual(SAVED_RACE);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({
      user_id: USER_ID,
      event_name: "London Marathon",
      race_date: "2026-04-26",
      distance_meters: 42195,
      elevation_gain_meters: 127,
      elevation_source: "known",
    });
  });

  it("still saves the race when the database has not had migration 037 applied", async () => {
    const { response, body, inserts } = await postWith((_insert, attempt) =>
      attempt === 1
        ? { data: null, error: ELEVATION_SOURCE_CHECK_VIOLATION }
        : { data: SAVED_RACE, error: null }
    );

    expect(response.status).toBe(200);
    expect(body.race).toEqual(SAVED_RACE);
    // The elevation figure is real either way — only its provenance label is
    // downgraded, and the response says so rather than pretending otherwise.
    expect(body.elevationSourceDegraded).toBe(true);
    expect(inserts).toHaveLength(2);
    expect(inserts[1].payload.elevation_source).toBe("manual");
    expect(inserts[1].payload.elevation_gain_meters).toBe(127);
  });

  it("reports success normally when nothing had to be downgraded", async () => {
    const { body } = await postWith(alwaysSaves);
    expect(body.elevationSourceDegraded).toBe(false);
  });

  it("does not retry a check violation that is not about elevation_source", async () => {
    const { response, body, inserts } = await postWith(() => ({
      data: null,
      error: {
        code: "23514",
        message: 'new row for relation "planned_races" violates check constraint "planned_races_distance_meters_check"',
      },
    }));

    expect(inserts).toHaveLength(1);
    expect(response.status).toBe(500);
    expect(body.race).toBeUndefined();
  });

  it("never answers with a success payload when the insert fails", async () => {
    const { response, body } = await postWith(() => ({
      data: null,
      error: { code: "42501", message: "new row violates row-level security policy" },
    }));

    expect(response.status).toBe(500);
    expect(body.race).toBeUndefined();
    // Plain English for the athlete...
    expect(body.error).toMatch(/could not save this race/i);
    expect(body.error).not.toMatch(/row-level security/i);
    // ...and the real reason kept alongside it, so a silent failure is impossible.
    expect(body.detail).toMatch(/row-level security/i);
  });

  it("fails loudly rather than silently when the fallback insert also fails", async () => {
    const { response, body, inserts } = await postWith(() => ({
      data: null,
      error: ELEVATION_SOURCE_CHECK_VIOLATION,
    }));

    expect(inserts).toHaveLength(2);
    expect(response.status).toBe(500);
    expect(body.race).toBeUndefined();
    expect(body.error).toMatch(/could not save this race/i);
  });

  it("does not report success when the insert returns neither a row nor an error", async () => {
    const { response, body } = await postWith(() => ({ data: null, error: null }));

    expect(response.status).toBe(500);
    expect(body.race).toBeUndefined();
    expect(body.error).toMatch(/could not save this race/i);
  });

  it("saves the race even when the location cannot be geocoded", async () => {
    geocodeLocationMock.mockResolvedValue(null);
    const { response, body, inserts } = await postWith(alwaysSaves);

    expect(response.status).toBe(200);
    expect(body.geocodeFailed).toBe(true);
    expect(inserts[0].payload.latitude).toBeNull();
    expect(inserts[0].payload.location_name).toBe("London, UK");
  });

  it("stores a manually entered elevation as manual", async () => {
    const { inserts } = await postWith(
      alwaysSaves,
      racePayload({ elevationSource: "manual", elevationGainMeters: "310" })
    );

    expect(inserts[0].payload.elevation_source).toBe("manual");
    expect(inserts[0].payload.elevation_gain_meters).toBe(310);
  });

  it("leaves elevation_source null when no elevation was given", async () => {
    const { inserts } = await postWith(
      alwaysSaves,
      racePayload({ elevationGainMeters: null, elevationSource: null })
    );

    expect(inserts[0].payload.elevation_gain_meters).toBeNull();
    expect(inserts[0].payload.elevation_source).toBeNull();
  });

  it("rejects a race with no event name before touching the database", async () => {
    const { response, body, inserts } = await postWith(alwaysSaves, racePayload({ eventName: "  " }));

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/event name/i);
    expect(inserts).toHaveLength(0);
  });

  it("rejects an unparseable race date before touching the database", async () => {
    const { response, body, inserts } = await postWith(alwaysSaves, racePayload({ raceDate: "not-a-date" }));

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/race date/i);
    expect(inserts).toHaveLength(0);
  });

  it("accepts the YYYY-MM-DD string a date picker produces", async () => {
    const { response, inserts } = await postWith(alwaysSaves, racePayload({ raceDate: "2027-01-31" }));

    expect(response.status).toBe(200);
    // planned_races.race_date is a DATE column — it must reach it as the same
    // calendar day the athlete picked, never shifted through a timezone.
    expect(inserts[0].payload.race_date).toBe("2027-01-31");
  });

  it("rejects an implausible distance before touching the database", async () => {
    const { response, body, inserts } = await postWith(alwaysSaves, racePayload({ distanceMeters: 5 }));

    expect(response.status).toBe(400);
    expect(body.error).toMatch(/distance/i);
    expect(inserts).toHaveLength(0);
  });

  it("rejects an unauthenticated request", async () => {
    createClientMock.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
      from: () => {
        throw new Error("must not touch the database when unauthenticated");
      },
    });
    const { POST } = await import("./route");
    const response = await POST(postRequest(racePayload()));

    expect(response.status).toBe(401);
  });
});
