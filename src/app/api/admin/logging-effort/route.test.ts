import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate and the shape. A non-admin gets a 404 and a recorded denial; an
 * admin gets the three views and the plan's targets; a database behind on
 * migration 090 gets a 503 that names it rather than a page of zeros.
 */

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));

const resolveAdminRoleMock = vi.fn();
vi.mock("@/lib/auth/admin-role", () => ({ resolveAdminRole: (...a: unknown[]) => resolveAdminRoleMock(...a) }));

const recordAdminAccessMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/auth/admin-audit", () => ({ recordAdminAccess: (...a: unknown[]) => recordAdminAccessMock(...a) }));

const adminFromMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => adminFromMock(t) }) }));

function viewChain(result: { data: unknown; error: { message: string } | null }) {
  const chain: Record<string, unknown> = {
    then(resolve: (v: unknown) => unknown) {
      return Promise.resolve(resolve(result));
    },
  };
  for (const f of ["select", "gte", "order"]) chain[f] = () => chain;
  return chain;
}

async function get(query = "") {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  });
  const { GET } = await import("./route");
  const response = await GET(new Request(`http://localhost/api/admin/logging-effort${query}`));
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  recordAdminAccessMock.mockClear();
  adminFromMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/admin/logging-effort", () => {
  it("answers a non-admin with 404 and records the denial", async () => {
    resolveAdminRoleMock.mockResolvedValue(null);
    const { response } = await get();
    expect(response.status).toBe(404);
    expect(recordAdminAccessMock).toHaveBeenCalledWith(expect.objectContaining({ granted: false, route: "/api/admin/logging-effort" }));
    expect(adminFromMock).not.toHaveBeenCalled();
  });

  it("gives an admin the three views, the window and the targets", async () => {
    resolveAdminRoleMock.mockResolvedValue({ role: "viewer" });
    adminFromMock.mockImplementation((table: string) =>
      viewChain({
        data: [{ week_start: "2026-10-05", table }],
        error: null,
      })
    );
    const { response, body } = await get("?days=28");
    expect(response.status).toBe(200);
    expect(body.windowDays).toBe(28);
    expect(body.effort[0].table).toBe("logging_effort_weekly");
    expect(body.recovery[0].table).toBe("recovery_inputs_weekly");
    expect(body.loggers[0].table).toBe("active_loggers_weekly");
    expect(body.targets.gymFieldsTouched.target).toBe(10);
    expect(recordAdminAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ granted: true, detail: { windowDays: 28 } })
    );
  });

  it("says which migration is missing when a view is not there", async () => {
    resolveAdminRoleMock.mockResolvedValue({ role: "operator" });
    adminFromMock.mockImplementation(() =>
      viewChain({ data: null, error: { message: 'relation "logging_effort_weekly" does not exist' } })
    );
    const { response, body } = await get();
    expect(response.status).toBe(503);
    expect(body.error).toMatch(/migration 090/);
  });
});
