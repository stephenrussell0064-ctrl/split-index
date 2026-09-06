import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The native entitlement webhook — the only thing standing between a
 * StoreKit/Play purchase and the `profiles.subscription_*` columns every
 * paid gate in this app reads.
 *
 * It had no tests, and it is the highest-consequence unguarded route in the
 * repo: a regression here either gives premium away to anyone who can POST,
 * or takes it away from someone who paid. Both are silent — nothing throws,
 * the athlete just finds a feature missing, or the leaderboard populated with
 * accounts that never paid.
 *
 * Four properties are pinned:
 *
 *   1. The shared secret is actually checked, and a MISSING secret denies
 *      rather than admits. A route that authenticates with `auth === secret`
 *      where both are undefined is a public entitlement grant.
 *   2. A purchase grants premium and records which store it came from.
 *   3. EXPIRATION revokes, but ONLY where subscription_source is
 *      'revenuecat'. A lapsed App Store subscription must not clear a
 *      separately-active Stripe web subscription for the same person.
 *   4. CANCELLATION is a no-op. Turning off auto-renew is not the end of the
 *      paid period, and treating it as one bills someone for time they are
 *      then locked out of.
 */

const SECRET = "rc-shared-secret";
const USER_ID = "user-1";

interface RecordedUpdate {
  table: string;
  payload: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

const updates: RecordedUpdate[] = [];

/**
 * Minimal Supabase stand-in. Records the update payload AND every `.eq()`
 * applied to it, because on the revoke path the second filter is the whole
 * safety property — asserting only the payload would pass a route that
 * downgraded every user in the table.
 */
function fakeAdminClient() {
  function chainFor(table: string) {
    const record: RecordedUpdate = { table, payload: {}, filters: [] };
    const chain: Record<string, unknown> = {
      update(payload: Record<string, unknown>) {
        record.payload = payload;
        updates.push(record);
        return chain;
      },
      eq(column: string, value: unknown) {
        record.filters.push([column, value]);
        return chain;
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: null, error: null }));
      },
    };
    return chain;
  }
  return { from: (table: string) => chainFor(table) };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdminClient() }));

const { POST } = await import("./route");

function post(body: unknown, authorization?: string): Promise<Response> {
  return POST(
    new Request("https://split-index.test/api/revenuecat/webhook", {
      method: "POST",
      headers: authorization ? { authorization } : {},
      body: JSON.stringify(body),
    })
  );
}

function event(type: string, extra: Record<string, unknown> = {}) {
  return { event: { type, app_user_id: USER_ID, ...extra } };
}

beforeEach(() => {
  updates.length = 0;
  vi.stubEnv("REVENUECAT_WEBHOOK_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authentication", () => {
  it("rejects a request with no Authorization header", async () => {
    const res = await post(event("INITIAL_PURCHASE"));
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("rejects a wrong secret", async () => {
    const res = await post(event("INITIAL_PURCHASE"), "Bearer not-the-secret");
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("denies everything when the secret is not configured at all", async () => {
    // Failing open here would hand a premium grant to anyone who can find the
    // URL — including on a preview deployment where the env var was never set.
    vi.stubEnv("REVENUECAT_WEBHOOK_SECRET", "");
    const res = await post(event("INITIAL_PURCHASE"), "Bearer ");
    expect(res.status).toBe(401);
    expect(updates).toHaveLength(0);
  });

  it("accepts the configured secret as a Bearer token", async () => {
    const res = await post(event("TEST"), `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
  });
});

describe("granting an entitlement", () => {
  it("marks the athlete premium and records the store that granted it", async () => {
    const res = await post(
      event("INITIAL_PURCHASE", { product_id: "co.uk.splitindex.app.annual" }),
      `Bearer ${SECRET}`
    );

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0].table).toBe("profiles");
    expect(updates[0].payload).toEqual({
      subscription_tier: "premium",
      subscription_status: "active",
      subscription_sku: "annual",
      subscription_source: "revenuecat",
    });
    expect(updates[0].filters).toEqual([["user_id", USER_ID]]);
  });

  it("grants on a renewal as well as a first purchase, so premium does not lapse monthly", async () => {
    await post(event("RENEWAL", { product_id: "co.uk.splitindex.app.monthly" }), `Bearer ${SECRET}`);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload.subscription_tier).toBe("premium");
    expect(updates[0].payload.subscription_sku).toBe("monthly");
  });

  it("still grants when the product id is one we do not recognise", async () => {
    // A new SKU configured in the RevenueCat dashboard before it is added
    // here must not cost a paying customer their access. The sku column goes
    // null; the entitlement does not.
    await post(event("INITIAL_PURCHASE", { product_id: "co.uk.splitindex.app.quarterly" }), `Bearer ${SECRET}`);
    expect(updates[0].payload.subscription_tier).toBe("premium");
    expect(updates[0].payload.subscription_sku).toBeNull();
  });

  it("grants when the event names the split_index_pro entitlement", async () => {
    await post(
      event("INITIAL_PURCHASE", {
        product_id: "co.uk.splitindex.app.annual",
        entitlement_ids: ["split_index_pro"],
      }),
      `Bearer ${SECRET}`
    );
    expect(updates[0].payload.subscription_tier).toBe("premium");
  });

  it("ignores a purchase that unlocks some other entitlement entirely", async () => {
    // The route grants premium for any purchase event that reaches it, which
    // is fine only while premium is the sole thing sold. The day a second
    // product exists, buying it must not hand over AI Coach as well.
    const res = await post(
      event("INITIAL_PURCHASE", {
        product_id: "co.uk.splitindex.app.coaching-callout",
        entitlement_ids: ["one_off_callout"],
      }),
      `Bearer ${SECRET}`
    );

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it("still grants when the event carries no entitlement_ids at all", async () => {
    // Withholding premium from someone who paid, because a field was absent,
    // is the worse of the two failure directions.
    await post(event("INITIAL_PURCHASE", { entitlement_ids: null }), `Bearer ${SECRET}`);
    expect(updates[0].payload.subscription_tier).toBe("premium");
  });

  it("does not let an unrelated entitlement's expiry revoke premium", async () => {
    const res = await post(
      event("EXPIRATION", { entitlement_ids: ["one_off_callout"] }),
      `Bearer ${SECRET}`
    );
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it("acknowledges the dashboard's TEST event without touching any profile", async () => {
    const res = await post(event("TEST"), `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });
});

describe("revoking an entitlement", () => {
  it("downgrades on EXPIRATION", async () => {
    await post(event("EXPIRATION"), `Bearer ${SECRET}`);
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({
      subscription_tier: "free",
      subscription_status: "canceled",
      subscription_sku: null,
      subscription_source: null,
    });
  });

  it("only downgrades a profile RevenueCat itself granted", async () => {
    // Without the second filter, an athlete who bought on the App Store, let
    // it lapse, and later subscribed on the web would be downgraded by the
    // old native expiration — losing access they are currently paying for.
    await post(event("EXPIRATION"), `Bearer ${SECRET}`);
    expect(updates[0].filters).toEqual([
      ["user_id", USER_ID],
      ["subscription_source", "revenuecat"],
    ]);
  });

  it("treats CANCELLATION as a no-op — auto-renew off is not access ended", async () => {
    // The paid period still has time left on it. Revoking here bills someone
    // for days they cannot use.
    const res = await post(event("CANCELLATION"), `Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(updates).toHaveLength(0);
  });

  it("treats a billing issue as a no-op, leaving the store's grace period to resolve it", async () => {
    await post(event("BILLING_ISSUE"), `Bearer ${SECRET}`);
    expect(updates).toHaveLength(0);
  });
});

describe("malformed input", () => {
  it("rejects an event with no type or no user, rather than updating an undefined profile", async () => {
    expect((await post({ event: { app_user_id: USER_ID } }, `Bearer ${SECRET}`)).status).toBe(400);
    expect((await post({ event: { type: "RENEWAL" } }, `Bearer ${SECRET}`)).status).toBe(400);
    expect((await post({}, `Bearer ${SECRET}`)).status).toBe(400);
    expect(updates).toHaveLength(0);
  });
});
