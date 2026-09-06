import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * WP11 — the Article 9 gate on the write path.
 *
 * This is the test the hardening brief names: "Tier 2 data absent when Article
 * 9 consent refused." It drives the real PATCH handler with no database, and
 * asserts on what actually reached the upsert rather than on what the handler
 * returned — a 403 with the row written anyway would pass a status-code test
 * and fail the only thing that matters.
 *
 * The questions under test are the ones the intake genuinely asks: PAR-Q,
 * chest pain on exertion, recent surgery, pregnancy and postpartum status,
 * medication affecting heart rate, and the low-energy-availability screen
 * including amenorrhoea. They exist to determine health status, which is what
 * puts them in Article 9 and what makes storing them without explicit consent
 * a processing failure rather than a product bug.
 */

const USER_ID = "user-1";

interface Upsert {
  table: string;
  payload: Record<string, unknown>;
}

/**
 * Fake Supabase with just enough shape to run the handler: it answers the
 * consent lookup from `consentAction`, and records every upsert so a test can
 * inspect the payload that would have hit the table.
 */
function createFakeSupabase(consentAction: "granted" | "withdrawn" | null) {
  const upserts: Upsert[] = [];

  function chainFor(table: string) {
    const chain: Record<string, unknown> = {
      then(resolve: (value: { data: unknown; error: null }) => unknown) {
        if (table === "article9_consent_events") {
          return Promise.resolve(
            resolve({
              data: consentAction
                ? {
                    action: consentAction,
                    wording_version: "2026-09-06.1",
                    created_at: "2026-09-01T00:00:00.000Z",
                  }
                : null,
              error: null,
            })
          );
        }
        // hpe_intake reads: no existing row.
        return Promise.resolve(resolve({ data: null, error: null }));
      },
      upsert: (values: Record<string, unknown>) => {
        upserts.push({ table, payload: values });
        return chain;
      },
    };
    for (const m of ["select", "eq", "order", "limit", "single", "maybeSingle", "insert"]) {
      chain[m] = () => chain;
    }
    return chain;
  }

  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => chainFor(table),
    },
    upserts,
  };
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));
vi.mock("@/lib/scoring/hpe/load-intake", () => ({
  loadPrefilledIntake: async () => ({}),
}));

function patch(body: unknown): Request {
  return new Request("http://localhost/api/hpe/intake", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Every Article 9 answer the health screen collects. */
const HEALTH_ANSWERS = {
  parq_positive: true,
  chest_pain_on_exertion: true,
  current_injury_limiting: true,
  injury_last_12_weeks: true,
  injury_sites: ["knee"],
  surgery_last_6_months: true,
  pregnant_or_postpartum_12wk: true,
  medication_affecting_hr: true,
};

const FUELLING_ANSWERS = {
  lea_restricted_food: true,
  lea_trains_fasted: true,
  lea_unintended_weight_loss: true,
  lea_bone_stress_injury: true,
  lea_amenorrhoea: true,
};

beforeEach(() => {
  createClientMock.mockReset();
});

describe("PATCH /api/hpe/intake — Article 9 consent gate", () => {
  it("refuses the health screen and writes nothing when consent was never given", async () => {
    const { client, upserts } = createFakeSupabase(null);
    createClientMock.mockResolvedValue(client);
    const { PATCH } = await import("./route");

    const res = await PATCH(patch({ section: "health", values: HEALTH_ANSWERS }));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ consentRequired: true });
    // The part that matters: no row reached the table.
    expect(upserts).toEqual([]);
  });

  it("refuses the fuelling screen too — the LEA questions are health data", async () => {
    const { client, upserts } = createFakeSupabase(null);
    createClientMock.mockResolvedValue(client);
    const { PATCH } = await import("./route");

    const res = await PATCH(patch({ section: "fuelling", values: FUELLING_ANSWERS }));

    expect(res.status).toBe(403);
    expect(upserts).toEqual([]);
  });

  it("refuses after consent is withdrawn, not just before it is given", async () => {
    // The newest event decides. An athlete who consented in March and withdrew
    // in September is refused in September.
    const { client, upserts } = createFakeSupabase("withdrawn");
    createClientMock.mockResolvedValue(client);
    const { PATCH } = await import("./route");

    const res = await PATCH(patch({ section: "health", values: HEALTH_ANSWERS }));

    expect(res.status).toBe(403);
    expect(upserts).toEqual([]);
  });

  it("accepts the health screen once consent is on record", async () => {
    const { client, upserts } = createFakeSupabase("granted");
    createClientMock.mockResolvedValue(client);
    const { PATCH } = await import("./route");

    const res = await PATCH(patch({ section: "health", values: HEALTH_ANSWERS }));

    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toMatchObject({
      parq_positive: true,
      pregnant_or_postpartum_12wk: true,
    });
  });

  /**
   * The brief's hard requirement: refusal disables the Hybrid Plan Engine and
   * the injury Risk Index, "and nothing else". A consent that costs an athlete
   * the rest of the product they are paying for is not freely given, and would
   * not be valid consent.
   */
  it("leaves the Tier 1 intake sections working without consent", async () => {
    const { client, upserts } = createFakeSupabase(null);
    createClientMock.mockResolvedValue(client);
    const { PATCH } = await import("./route");

    const res = await PATCH(
      patch({
        section: "availability",
        values: { max_sessions_per_week: 5, preferred_long_day: "sunday" },
      })
    );

    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(upserts[0].payload).toMatchObject({ max_sessions_per_week: 5 });
  });

  /**
   * Defence in depth. The per-section allowlist would already drop a health
   * field sent under `availability`, because the two field lists do not
   * currently overlap — but that is a fact about today's layout, not a
   * guarantee. Moving one question between sections would silently open the
   * door. stripTier2Fields closes it by name.
   */
  it("strips health fields smuggled into an ungated section", async () => {
    const { client, upserts } = createFakeSupabase(null);
    createClientMock.mockResolvedValue(client);
    const { PATCH } = await import("./route");

    const res = await PATCH(
      patch({
        section: "availability",
        values: { max_sessions_per_week: 4, ...HEALTH_ANSWERS },
      })
    );

    expect(res.status).toBe(200);
    const payload = upserts[0].payload;
    expect(payload).toMatchObject({ max_sessions_per_week: 4 });
    for (const field of Object.keys(HEALTH_ANSWERS)) {
      expect(payload, `${field} must not reach the table`).not.toHaveProperty(field);
    }
  });
});
