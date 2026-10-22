import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The gate and the shape. A non-admin gets a 404 and a recorded denial; an
 * admin gets the computed meters; a database behind on migration 092 gets a
 * 503 that names it rather than a card of zeros.
 */

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));

const resolveAdminRoleMock = vi.fn();
vi.mock("@/lib/auth/admin-role", () => ({ resolveAdminRole: (...a: unknown[]) => resolveAdminRoleMock(...a) }));

const recordAdminAccessMock = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
vi.mock("@/lib/auth/admin-audit", () => ({ recordAdminAccess: (...a: unknown[]) => recordAdminAccessMock(...a) }));

const rpcMock = vi.fn();
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: (fn: string) => rpcMock(fn) }) }));

async function get() {
  createClientMock.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
  });
  const { GET } = await import("./route");
  const response = await GET();
  return { response, body: await response.json() };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  recordAdminAccessMock.mockClear();
  rpcMock.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/admin/supabase-headroom", () => {
  it("answers a non-admin with 404 and records the denial", async () => {
    resolveAdminRoleMock.mockResolvedValue(null);
    const { response } = await get();
    expect(response.status).toBe(404);
    expect(recordAdminAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ granted: false, route: "/api/admin/supabase-headroom" })
    );
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gives an admin the meters, the pause check and the limits", async () => {
    resolveAdminRoleMock.mockResolvedValue({ role: "viewer" });
    rpcMock.mockResolvedValue({
      data: {
        database_bytes: 100 * 1024 * 1024,
        storage_bytes: 0,
        storage_objects: 0,
        users_total: 12,
        users_active_calendar_month: 5,
        users_active_30d: 7,
        users_onboarded: 10,
        activities_total: 300,
        last_activity_at: new Date().toISOString(),
        measured_at: new Date().toISOString(),
      },
      error: null,
    });
    const { response, body } = await get();
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("supabase_headroom");
    expect(body.meters).toHaveLength(3);
    expect(body.meters[0].used).toBe(5);
    expect(body.pause.level).toBe("ok");
    expect(body.limits.monthlyActiveUsers).toBe(50_000);
    expect(recordAdminAccessMock).toHaveBeenCalledWith(expect.objectContaining({ granted: true }));
  });

  it("names migration 092 when the function is missing", async () => {
    resolveAdminRoleMock.mockResolvedValue({ role: "viewer" });
    rpcMock.mockResolvedValue({ data: null, error: { message: "function public.supabase_headroom() does not exist" } });
    const { response, body } = await get();
    expect(response.status).toBe(503);
    expect(body.error).toMatch(/092/);
  });
});
