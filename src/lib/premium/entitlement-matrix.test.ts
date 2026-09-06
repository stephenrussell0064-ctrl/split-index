import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_TRIAL_DAYS } from "@/lib/stripe/config";

/**
 * WP6.5 — the entitlement matrix.
 *
 * "Test matrix: free, trialling, premium, expired-premium, admin — each against
 * every protected route." The matrix IS the deliverable; `features.ts` mostly
 * stood already.
 *
 * These drive the real route handlers with a fake Supabase, so what is asserted
 * is what the route returns — not what a helper would have said if the route
 * had called it. The distinction matters: the bug this catches is a route that
 * resolves entitlements correctly and then forgets to act on them.
 *
 * ONE ASSERTION THAT IS NOT ABOUT STATUS CODES
 * --------------------------------------------
 * "A test asserting a free user's analytics response contains no premium field,
 * not even nulled or blurred." A 403 with the value in the body would pass a
 * status-code matrix and fail the actual requirement, so the payloads are
 * inspected too.
 */

const USER_ID = "user-under-test";
const DAY = 86_400_000;

/** The five accounts in the matrix. */
type Role = "free" | "trialling" | "premium" | "expired" | "admin";

interface Account {
  tier: "free" | "premium";
  status: string | null;
  /** How long ago the account was created — drives the card-less soft trial. */
  ageDays: number;
  admin: { user_id: string; role: string } | null;
}

const ACCOUNTS: Record<Role, Account> = {
  /** Old enough that the card-less soft trial has lapsed. */
  free: { tier: "free", status: null, ageDays: FREE_TRIAL_DAYS + 10, admin: null },
  /** A real provider trial. Premium for entitlement purposes. */
  trialling: { tier: "premium", status: "trialing", ageDays: 3, admin: null },
  premium: { tier: "premium", status: "active", ageDays: 400, admin: null },
  /**
   * The one most likely to be got wrong. Cancelled subscriptions keep
   * `tier: premium` on the row until a webhook rewrites it, so anything reading
   * the tier alone treats a lapsed subscriber as paying.
   */
  expired: { tier: "premium", status: "canceled", ageDays: 400, admin: null },
  /**
   * An operator. Deliberately on a FREE plan — admin is not a premium bypass,
   * and the pair of assertions below is the only thing that keeps those two
   * questions separate.
   */
  admin: {
    tier: "free",
    status: null,
    ageDays: 400,
    admin: { user_id: USER_ID, role: "operator" },
  },
};

const { createClientMock, adminClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  adminClientMock: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createClientMock() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClientMock() }));

/**
 * A Supabase stand-in that answers from one account definition.
 *
 * `profiles` returns the subscription state, `admin_users` returns the admin
 * row or null, and everything else returns empty — enough to get a handler past
 * its data reads and to the decision under test.
 */
function clientFor(account: Account) {
  const createdAt = new Date(Date.now() - account.ageDays * DAY).toISOString();

  function chainFor(table: string) {
    const rows =
      table === "profiles"
        ? {
            user_id: USER_ID,
            subscription_tier: account.tier,
            subscription_status: account.status,
            created_at: createdAt,
            username: "athlete",
            country: "GB",
          }
        : table === "admin_users"
          ? account.admin
          : null;

    const chain: Record<string, unknown> = {
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    for (const m of [
      "select", "eq", "in", "gte", "lte", "lt", "gt", "order", "limit",
      "single", "maybeSingle", "not", "insert", "upsert", "update", "delete",
    ]) {
      chain[m] = () => chain;
    }
    return chain;
  }

  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
    from: (t: string) => chainFor(t),
  };
}

function req(url: string, method = "GET") {
  return new Request(`http://localhost${url}`, { method });
}

function setup(role: Role) {
  const client = clientFor(ACCOUNTS[role]);
  createClientMock.mockReturnValue(client);
  adminClientMock.mockReturnValue(client);
  return client;
}

beforeEach(() => {
  vi.resetModules();
  createClientMock.mockReset();
  adminClientMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});

  /*
   * resolveAdminRole returns null outright when SUPABASE_SERVICE_ROLE_KEY is
   * unset — "an unverifiable admin check must answer no". Vitest does not load
   * .env.local, so without this stub every admin case fails and the matrix
   * looks green for the wrong reason: nobody is an admin, so nothing admits
   * one. The fail-closed behaviour itself is asserted separately below.
   */
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/**
 * Which roles each protected route should ADMIT.
 *
 * Written as data so the matrix reads as a table and a gap is visible rather
 * than inferred from a missing test.
 */
const MATRIX: {
  route: string;
  load: () => Promise<{ GET: (r: Request) => Promise<Response> }>;
  url: string;
  admits: Role[];
}[] = [
  {
    route: "GET /api/export/activities",
    load: () => import("@/app/api/export/activities/route"),
    url: "/api/export/activities?format=json",
    admits: ["trialling", "premium"],
  },
  {
    route: "GET /api/social/leaderboard/detail",
    load: () => import("@/app/api/social/leaderboard/detail/route"),
    url: "/api/social/leaderboard/detail?userId=someone",
    admits: ["trialling", "premium"],
  },
  {
    route: "GET /api/hpe/admin/fleet",
    load: () => import("@/app/api/hpe/admin/fleet/route"),
    url: "/api/hpe/admin/fleet?days=30",
    admits: ["admin"],
  },
];

describe("the entitlement matrix", () => {
  for (const { route, load, url, admits } of MATRIX) {
    describe(route, () => {
      for (const role of Object.keys(ACCOUNTS) as Role[]) {
        const shouldAdmit = admits.includes(role);

        it(`${shouldAdmit ? "admits" : "refuses"} a ${role} account`, async () => {
          setup(role);
          const mod = await load();
          const res = await mod.GET(req(url));

          if (shouldAdmit) {
            expect(res.status, `${role} was refused with ${res.status}`).toBeLessThan(400);
          } else {
            // 403 or 404 — the fleet route answers 404 on purpose, so that a
            // non-administrator is not told an administrator view exists.
            expect([403, 404], `${role} got ${res.status}`).toContain(res.status);
          }
        });
      }
    });
  }
});

describe("the two cases most likely to be got wrong", () => {
  /**
   * A cancelled subscription keeps `tier: "premium"` on the profile row until a
   * webhook rewrites it. Anything reading the tier alone — `tier === "premium"`
   * — treats a lapsed subscriber as paying, indefinitely.
   */
  it("refuses an expired-premium account despite its tier still saying premium", async () => {
    expect(ACCOUNTS.expired.tier).toBe("premium");

    setup("expired");
    const { GET } = await import("@/app/api/export/activities/route");
    expect((await GET(req("/api/export/activities?format=json"))).status).toBe(403);
  });

  /**
   * Admin is not a premium bypass. An operator looking at a fleet dashboard has
   * no business silently holding a paid subscription's features on their own
   * account, and conflating the two makes the matrix above meaningless.
   */
  it("gives an admin the fleet view and NOT the paid features", async () => {
    setup("admin");
    const fleet = await import("@/app/api/hpe/admin/fleet/route");
    expect((await fleet.GET(req("/api/hpe/admin/fleet?days=30"))).status).toBeLessThan(400);

    setup("admin");
    const exportRoute = await import("@/app/api/export/activities/route");
    expect((await exportRoute.GET(req("/api/export/activities?format=json"))).status).toBe(403);
  });
});

describe("the admin check fails closed", () => {
  /**
   * Found by writing the matrix: every admin case failed until the service-role
   * key was stubbed, because resolveAdminRole refuses to answer without it.
   *
   * That is the intended behaviour — "failing open here would make every
   * operations endpoint public the moment an env var went missing" — and it had
   * no test. It does now, because the failure mode it prevents is silent and
   * total.
   */
  it("refuses an admin when the service-role key is missing", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    setup("admin");
    const { GET } = await import("@/app/api/hpe/admin/fleet/route");
    expect((await GET(req("/api/hpe/admin/fleet?days=30"))).status).toBe(404);
  });
});

describe("a refused response carries no premium value", () => {
  /**
   * The acceptance criterion that is not about status codes: "a free user's
   * analytics response contains no premium field, not even nulled or blurred".
   *
   * A 403 with the value in the body passes a status-code matrix and fails the
   * actual requirement, so the body is read.
   */
  it.each([
    ["/api/export/activities?format=json", () => import("@/app/api/export/activities/route")],
    [
      "/api/social/leaderboard/detail?userId=someone",
      () => import("@/app/api/social/leaderboard/detail/route"),
    ],
  ])("%s returns no data to a free account", async (url, load) => {
    setup("free");
    const mod = (await load()) as { GET: (r: Request) => Promise<Response> };
    const res = await mod.GET(req(url));

    expect(res.status).toBe(403);

    const text = await res.text();
    // Not "the field is null" — the field is absent. A nulled key still tells
    // the caller the shape of what they are missing, and a blurred one hands
    // them the value outright.
    for (const leaked of ["activities", "topLifts", "racePredictions", "estimated1RmKg"]) {
      expect(text, `refusal body mentions ${leaked}`).not.toContain(leaked);
    }
  });

  it("says the same thing to every refused account", async () => {
    // A refusal that varies by role tells an unauthenticated prober which kind
    // of account they hold.
    const bodies: string[] = [];
    for (const role of ["free", "expired", "admin"] as Role[]) {
      setup(role);
      const { GET } = await import("@/app/api/export/activities/route");
      bodies.push(await (await GET(req("/api/export/activities?format=json"))).text());
    }
    expect(new Set(bodies).size).toBe(1);
  });
});
