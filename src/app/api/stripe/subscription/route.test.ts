import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The web subscriber's "switch to free" — GET/POST /api/stripe/subscription.
 *
 * What is pinned:
 *
 *   1. It only ever changes the subscription Stripe is still billing — a
 *      customer with an old canceled subscription and a live one gets the
 *      live one changed, never the stale one.
 *   2. "Cancel" means cancel_at_period_end, not an immediate cancel. The
 *      athlete keeps the period they paid for, and a trial is never charged.
 *   3. It refuses what Stripe cannot act on — an App Store subscription, a
 *      lifetime purchase — with a sentence the page shows, and without
 *      calling Stripe at all.
 *   4. It never writes profiles.subscription_*; the webhook owns those.
 */

const USER_ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

interface FakeProfile {
  stripe_customer_id: string | null;
  subscription_source: "stripe" | "revenuecat" | null;
  subscription_sku: "monthly" | "annual" | "lifetime" | null;
}

let profile: FakeProfile | null;
let signedIn = true;
const profileWrites: unknown[] = [];

function fakeSupabase() {
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: profile, error: null }),
    update: (payload: unknown) => {
      profileWrites.push(payload);
      return chain;
    },
  };
  return {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: USER_ID } : null } }) },
    from: () => chain,
  };
}

interface FakeSub {
  id: string;
  status: string;
  cancel_at_period_end: boolean;
  cancel_at: number | null;
  items: { data: Array<{ current_period_end: number }> };
}

let subscriptions: FakeSub[] = [];
const listCalls: unknown[] = [];
const updateCalls: Array<[string, { cancel_at_period_end: boolean }]> = [];

const PERIOD_END = 1_800_000_000; // 2027-01-15T08:00:00Z

function sub(partial: Partial<FakeSub> & { id: string; status: string }): FakeSub {
  return {
    cancel_at_period_end: false,
    cancel_at: null,
    items: { data: [{ current_period_end: PERIOD_END }] },
    ...partial,
  };
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => fakeSupabase() }));
vi.mock("@/lib/stripe/config", () => ({
  getStripe: () => ({
    subscriptions: {
      list: async (params: unknown) => {
        listCalls.push(params);
        return { data: subscriptions };
      },
      update: async (id: string, params: { cancel_at_period_end: boolean }) => {
        updateCalls.push([id, params]);
        const target = subscriptions.find((s) => s.id === id)!;
        target.cancel_at_period_end = params.cancel_at_period_end;
        target.cancel_at = params.cancel_at_period_end ? PERIOD_END : null;
        return target;
      },
    },
  }),
}));

const { GET, POST } = await import("./route");

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("https://split-index.test/api/stripe/subscription", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  signedIn = true;
  profile = { stripe_customer_id: "cus_1", subscription_source: "stripe", subscription_sku: "monthly" };
  subscriptions = [sub({ id: "sub_live", status: "active" })];
  listCalls.length = 0;
  updateCalls.length = 0;
  profileWrites.length = 0;
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("who may call it", () => {
  it("requires a signed-in user", async () => {
    signedIn = false;
    expect((await GET()).status).toBe(401);
    expect((await post({ action: "cancel" })).status).toBe(401);
    expect(updateCalls).toHaveLength(0);
  });

  it("rejects an unknown action before touching anything", async () => {
    const res = await post({ action: "delete" });
    expect(res.status).toBe(400);
    expect(listCalls).toHaveLength(0);
  });

  it("answers 503 when Stripe is not configured", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect((await post({ action: "cancel" })).status).toBe(503);
  });
});

describe("cancel", () => {
  it("sets cancel_at_period_end on the live subscription, never the stale one", async () => {
    subscriptions = [
      sub({ id: "sub_old", status: "canceled" }),
      sub({ id: "sub_live", status: "trialing" }),
    ];
    const res = await post({ action: "cancel" });
    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([["sub_live", { cancel_at_period_end: true }]]);
    const body = await res.json();
    expect(body.subscription).toMatchObject({
      status: "trialing",
      cancelAtPeriodEnd: true,
      periodEnd: new Date(PERIOD_END * 1000).toISOString(),
    });
  });

  it("looks the customer up by the profile's stripe_customer_id", async () => {
    await post({ action: "cancel" });
    expect(listCalls[0]).toMatchObject({ customer: "cus_1" });
  });

  it("is idempotent — a second cancel does not call Stripe again", async () => {
    subscriptions = [sub({ id: "sub_live", status: "active", cancel_at_period_end: true, cancel_at: PERIOD_END })];
    const res = await post({ action: "cancel" });
    expect(res.status).toBe(200);
    expect(updateCalls).toHaveLength(0);
  });

  it("never writes the profile — entitlement belongs to the webhook", async () => {
    await post({ action: "cancel" });
    expect(profileWrites).toHaveLength(0);
  });

  it("answers 404 when nothing is live to cancel", async () => {
    subscriptions = [sub({ id: "sub_old", status: "canceled" })];
    expect((await post({ action: "cancel" })).status).toBe(404);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("resume", () => {
  it("clears a pending cancellation", async () => {
    subscriptions = [sub({ id: "sub_live", status: "active", cancel_at_period_end: true, cancel_at: PERIOD_END })];
    const res = await post({ action: "resume" });
    expect(res.status).toBe(200);
    expect(updateCalls).toEqual([["sub_live", { cancel_at_period_end: false }]]);
    expect((await res.json()).subscription.cancelAtPeriodEnd).toBe(false);
  });
});

describe("what Stripe cannot act on", () => {
  it("refuses an App Store subscription and points at the phone", async () => {
    profile = { stripe_customer_id: "cus_1", subscription_source: "revenuecat", subscription_sku: "monthly" };
    const res = await post({ action: "cancel" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/App Store/);
    expect(listCalls).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  it("refuses a lifetime purchase", async () => {
    profile = { stripe_customer_id: "cus_1", subscription_source: "stripe", subscription_sku: "lifetime" };
    const res = await post({ action: "cancel" });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/Lifetime/);
    expect(listCalls).toHaveLength(0);
  });

  it("refuses a profile with no Stripe customer", async () => {
    profile = { stripe_customer_id: null, subscription_source: "stripe", subscription_sku: "monthly" };
    expect((await post({ action: "cancel" })).status).toBe(409);
    expect(listCalls).toHaveLength(0);
  });
});

describe("GET", () => {
  it("describes the live Stripe subscription", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      source: "stripe",
      sku: "monthly",
      subscription: {
        status: "active",
        cancelAtPeriodEnd: false,
        periodEnd: new Date(PERIOD_END * 1000).toISOString(),
      },
    });
  });

  it("reports a native subscriber without asking Stripe", async () => {
    profile = { stripe_customer_id: null, subscription_source: "revenuecat", subscription_sku: "annual" };
    const res = await GET();
    expect(await res.json()).toEqual({ source: "revenuecat", sku: "annual", subscription: null });
    expect(listCalls).toHaveLength(0);
  });

  it("still finds a live Stripe subscription when the profile has no source", async () => {
    // Hand-granted premium rows carry no source; if Stripe is nevertheless
    // billing the customer, the person being charged must still see the button.
    profile = { stripe_customer_id: "cus_1", subscription_source: null, subscription_sku: null };
    const res = await GET();
    expect((await res.json()).subscription).toMatchObject({ status: "active", cancelAtPeriodEnd: false });
  });

  it("reports nothing live for a lapsed customer", async () => {
    subscriptions = [sub({ id: "sub_old", status: "canceled" })];
    const res = await GET();
    expect((await res.json()).subscription).toBeNull();
  });
});
