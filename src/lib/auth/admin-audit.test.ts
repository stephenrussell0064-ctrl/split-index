import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sanitiseDetail } from "./admin-audit";

/**
 * WP6.4 — "the monitoring route gets its elevated query behind an admin check,
 * in a server-only module, with an audit log entry per access."
 *
 * The first two were already true. The fleet route has been admin-gated since
 * migration 041 and its service-role query has always lived in a server module.
 * The audit entry is the part that did not exist: migration 041 records rollout
 * CHANGES — who moved the dial, from what, to what — which is the right record
 * for a write and the only record there was.
 *
 * Reads were unrecorded, and the fleet view is a read. It runs the one
 * service-role query in the app that crosses every athlete's row level
 * security, so "who looked, and when" is the first question an incident asks
 * and nothing could answer it.
 */

const USER_ID = "operator-1";

const { createClientMock, adminClientMock, insertSpy } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  insertSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createClientMock() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminClientMock() }));

/** Records every insert so the audit row can be inspected, not just counted. */
function client(adminRow: { user_id: string; role: string } | null) {
  function chainFor(table: string) {
    const chain: Record<string, unknown> = {
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        return Promise.resolve(
          resolve({ data: table === "admin_users" ? adminRow : null, error: null })
        );
      },
      insert: (values: Record<string, unknown>) => {
        insertSpy({ table, values });
        return chain;
      },
    };
    for (const m of [
      "select", "eq", "in", "gte", "lte", "order", "limit", "single",
      "maybeSingle", "not", "upsert", "update", "delete",
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

function fleetRequest(days = 30) {
  return new Request(`http://localhost/api/hpe/admin/fleet?days=${days}`);
}

function auditRows() {
  return insertSpy.mock.calls
    .map((c) => c[0] as { table: string; values: Record<string, unknown> })
    .filter((c) => c.table === "admin_access_log")
    .map((c) => c.values);
}

beforeEach(() => {
  vi.resetModules();
  insertSpy.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key");
});

afterEach(() => vi.unstubAllEnvs());

describe("every fleet access is recorded", () => {
  it("writes an audit row when an operator reads the fleet", async () => {
    const c = client({ user_id: USER_ID, role: "operator" });
    createClientMock.mockReturnValue(c);
    adminClientMock.mockReturnValue(c);

    const { GET } = await import("@/app/api/hpe/admin/fleet/route");
    await GET(fleetRequest(30));

    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      admin_user_id: USER_ID,
      admin_role: "operator",
      route: "/api/hpe/admin/fleet",
      action: "read",
      granted: true,
    });
    expect(rows[0].detail).toMatchObject({ windowDays: 30 });
  });

  /**
   * The denial is the row worth having.
   *
   * A non-admin reaching this route once is noise. The same account reaching it
   * repeatedly is somebody probing, and that is the alert path WP7 asks for — a
   * log of successes only cannot show an attempt that failed.
   */
  it("writes an audit row when a non-admin is refused", async () => {
    const c = client(null);
    createClientMock.mockReturnValue(c);
    adminClientMock.mockReturnValue(c);

    const { GET } = await import("@/app/api/hpe/admin/fleet/route");
    const res = await GET(fleetRequest());

    expect(res.status).toBe(404);
    const rows = auditRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      admin_user_id: USER_ID,
      admin_role: null,
      granted: false,
    });
  });

  /**
   * An audit write must never take down the thing it is auditing. The operator
   * staring at a broken fleet dashboard during an incident is the last person
   * who should be debugging the audit table.
   */
  it("does not fail the request when the audit write throws", async () => {
    const c = client({ user_id: USER_ID, role: "operator" });
    createClientMock.mockReturnValue(c);
    adminClientMock.mockImplementation(() => {
      throw new Error("audit table unreachable");
    });

    const { GET } = await import("@/app/api/hpe/admin/fleet/route");
    // resolveAdminRole also uses the admin client and fails closed, so this
    // returns 404 rather than 200 — the point is that it RETURNS rather than
    // throwing the audit error up through the handler.
    await expect(GET(fleetRequest())).resolves.toBeDefined();
  });
});

describe("the audit row cannot carry health data", () => {
  /**
   * `detail` is jsonb and would take anything, which is why there is a runtime
   * filter and not only a comment. "Just log the payload" is always the easier
   * change, and the payload is where the PAR-Q answers live.
   */
  it.each([
    "bodyweight_kg",
    "avg_heart_rate",
    "hrv_ms",
    "parq_positive",
    "injury_sites",
    "pregnant_or_postpartum_12wk",
    "lea_amenorrhoea",
    "email",
    "access_token",
    "stripe_secret_key",
  ])("strips %s", (field) => {
    expect(sanitiseDetail({ [field]: "something", windowDays: 30 })).toEqual({
      windowDays: 30,
    });
  });

  it("keeps ordinary request parameters", () => {
    expect(sanitiseDetail({ windowDays: 30, percentage: 25, paused: true })).toEqual({
      windowDays: 30,
      percentage: 25,
      paused: true,
    });
  });
});

describe("migration 059", () => {
  const SQL = readFileSync(
    fileURLToPath(new URL("../../../supabase/migrations/059_admin_access_log.sql", import.meta.url)),
    "utf8"
  );

  it("has RLS on and deliberately no policies", () => {
    // An admin who can read — and therefore eventually reason about editing —
    // the log of their own accesses defeats the point of keeping one. RLS
    // denies what no policy permits, so the absence is the mechanism.
    expect(SQL).toMatch(/ALTER TABLE admin_access_log ENABLE ROW LEVEL SECURITY/i);
    expect(SQL).not.toMatch(/CREATE POLICY[^;]+ON admin_access_log/i);
  });

  it("keeps the record when the account is deleted", () => {
    // SET NULL, not CASCADE: an account being erased must not erase the record
    // that it once read the fleet.
    expect(SQL).toMatch(/admin_user_id UUID REFERENCES auth\.users\(id\) ON DELETE SET NULL/i);
  });

  it("records whether the attempt was granted", () => {
    expect(SQL).toMatch(/granted BOOLEAN NOT NULL/i);
    // And indexes the denials, which is the query an alert would run.
    expect(SQL).toMatch(/WHERE granted = false/i);
  });
});
