import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { gramsOfEthanol } from "@/lib/recovery/alcohol";

/**
 * Write-path integrity for POST /api/recovery/drinks.
 *
 * The one number worth forging in this feature is `grams_ethanol`. It is the
 * sole input to the dose model, it is what the recovery deduction and the
 * session forecast are both computed from, and it is stored rather than
 * derived — so a body that could set it directly would let anyone holding a
 * session token park their own recovery score wherever they liked, or hide a
 * heavy night behind a fabricated 0.1g. These tests pin that the server
 * computes it from the preset or the submitted volume/ABV and never reads it
 * off the request.
 */

const USER_ID = "user-1";

type QueryResult = { data: unknown; error: { code?: string; message: string } | null };

interface RecordedInsert {
  table: string;
  payload: Record<string, unknown>;
}

/** A delete the route issued, with the filters it was narrowed by. */
interface RecordedDelete {
  table: string;
  filters: Record<string, unknown>;
}

function createFakeSupabase(respond: () => QueryResult, user: { id: string } | null = { id: USER_ID }) {
  const inserts: RecordedInsert[] = [];
  const deletes: RecordedDelete[] = [];

  function chainFor(table: string) {
    let payload: Record<string, unknown> | null = null;
    let deleting = false;
    const filters: Record<string, unknown> = {};

    const result = (): QueryResult => {
      if (deleting) {
        deletes.push({ table, filters: { ...filters } });
        return respond();
      }
      if (payload === null) return { data: [], error: null };
      inserts.push({ table, payload });
      return respond();
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
      delete: () => {
        deleting = true;
        return chain;
      },
      // Recorded rather than ignored: for a bulk delete, WHICH rows it was
      // narrowed to is the entire assertion.
      eq: (column: string, value: unknown) => {
        filters[column] = value;
        return chain;
      },
    };
    for (const modifier of ["select", "gte", "order", "limit", "single", "maybeSingle"]) {
      chain[modifier] = () => chain;
    }
    return chain;
  }

  return {
    client: {
      auth: { getUser: async () => ({ data: { user }, error: null }) },
      from: (table: string) => chainFor(table),
    },
    inserts,
    deletes,
  };
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createClientMock() }));

const SAVED = { id: "drink-1", drank_at: "2026-09-23T21:00:00.000Z", grams_ethanol: 17.9 };
const saves = (): QueryResult => ({ data: SAVED, error: null });

/** Two hours ago, so it is always inside both the future and the age bound. */
function recentIso(): string {
  return new Date(Date.now() - 2 * 3_600_000).toISOString();
}

function postRequest(payload: unknown) {
  return new Request("http://localhost/api/recovery/drinks", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function postWith(payload: unknown, user: { id: string } | null = { id: USER_ID }) {
  const { client, inserts } = createFakeSupabase(saves, user);
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const response = await POST(postRequest(payload));
  return { response, body: await response.json(), inserts };
}

async function deleteAllWith(user: { id: string } | null = { id: USER_ID }) {
  const { client, deletes } = createFakeSupabase(
    () => ({ data: [{ id: "drink-1" }, { id: "drink-2" }], error: null }),
    user
  );
  createClientMock.mockResolvedValue(client);
  const { DELETE } = await import("./route");
  const response = await DELETE();
  return { response, body: await response.json(), deletes };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/recovery/drinks", () => {
  it("computes grams from the preset rather than trusting the client", async () => {
    const { response, inserts } = await postWith({
      presetId: "pint_lager",
      quantity: 1,
      drankAt: recentIso(),
      // The forged value. It must not appear anywhere in what is stored.
      gramsEthanol: 0.1,
      grams_ethanol: 0.1,
    });

    expect(response.status).toBe(200);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload.grams_ethanol).toBeCloseTo(gramsOfEthanol(568, 4), 1);
  });

  it("multiplies by quantity, so four pints is one entry and four doses", async () => {
    const { inserts } = await postWith({
      presetId: "pint_lager",
      quantity: 4,
      drankAt: recentIso(),
    });

    expect(inserts[0].payload.grams_ethanol).toBeCloseTo(gramsOfEthanol(568, 4, 4), 1);
    expect(inserts[0].payload.quantity).toBe(4);
  });

  it("computes a custom drink from its own volume and ABV", async () => {
    const { inserts } = await postWith({
      presetId: "custom",
      label: "Negroni",
      volumeMl: 90,
      abvPercent: 24,
      quantity: 1,
      drankAt: recentIso(),
    });

    expect(inserts[0].payload.label).toBe("Negroni");
    expect(inserts[0].payload.grams_ethanol).toBeCloseTo(gramsOfEthanol(90, 24), 1);
  });

  it("takes user_id from the session and never from the body", async () => {
    const { inserts } = await postWith({
      presetId: "pint_lager",
      quantity: 1,
      drankAt: recentIso(),
      user_id: "somebody-else",
      userId: "somebody-else",
    });

    expect(inserts[0].payload.user_id).toBe(USER_ID);
  });

  it("rejects a drink we do not know", async () => {
    const { response, inserts } = await postWith({
      presetId: "pint_of_something_invented",
      quantity: 1,
      drankAt: recentIso(),
    });

    expect(response.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("rejects a drink dated in the future", async () => {
    // A drink dated next Tuesday would sit in the model as a permanent,
    // unexplained recovery penalty that never decays.
    const { response, body, inserts } = await postWith({
      presetId: "pint_lager",
      quantity: 1,
      drankAt: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("future");
    expect(inserts).toHaveLength(0);
  });

  it("explains a zero-alcohol drink instead of failing on a database constraint", async () => {
    const { response, body, inserts } = await postWith({
      presetId: "custom",
      label: "Alcohol-free lager",
      volumeMl: 330,
      abvPercent: 0,
      quantity: 1,
      drankAt: recentIso(),
    });

    expect(response.status).toBe(400);
    expect(body.error).toContain("no alcohol");
    expect(inserts).toHaveLength(0);
  });

  it("rejects an implausible volume rather than clamping it", async () => {
    // Reject, never clamp: a clamped dose is a fabricated data point sitting in
    // a history that later recovery scores are computed against.
    const { response, inserts } = await postWith({
      presetId: "custom",
      label: "Typo",
      volumeMl: 500_000,
      abvPercent: 5,
      quantity: 1,
      drankAt: recentIso(),
    });

    expect(response.status).toBe(400);
    expect(inserts).toHaveLength(0);
  });

  it("refuses an unauthenticated write", async () => {
    const { response, inserts } = await postWith(
      { presetId: "pint_lager", quantity: 1, drankAt: recentIso() },
      null
    );

    expect(response.status).toBe(401);
    expect(inserts).toHaveLength(0);
  });
});

/**
 * Erasing the lot.
 *
 * This is not a convenience endpoint. The alcohol log is held as ordinary
 * personal data rather than behind an Article 9 consent gate, and that
 * classification depends on the athlete being able to withdraw the whole thing
 * in one action — so this path failing quietly, or half-working, is a
 * compliance problem rather than a UX one.
 */
describe("DELETE /api/recovery/drinks", () => {
  it("erases the athlete's whole alcohol history", async () => {
    const { response, body, deletes } = await deleteAllWith();

    expect(response.status).toBe(200);
    expect(body.deleted).toBe(2);
    expect(deletes).toHaveLength(1);
    expect(deletes[0].table).toBe("drink_logs");
  });

  it("narrows the delete to the session's own user, never a supplied id", async () => {
    // A bulk delete that forgets its owner filter is the worst available bug in
    // this file. RLS would still hold the line, but the statement must not be
    // relying on it alone.
    const { deletes } = await deleteAllWith();
    expect(deletes[0].filters).toEqual({ user_id: USER_ID });
  });

  it("refuses an unauthenticated erase", async () => {
    const { response, deletes } = await deleteAllWith(null);
    expect(response.status).toBe(401);
    expect(deletes).toHaveLength(0);
  });
});
