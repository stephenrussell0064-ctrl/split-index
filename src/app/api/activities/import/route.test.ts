import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * POST /api/activities/import answers with a preview and writes nothing.
 * The fake Supabase here only has to answer the three reads the route makes.
 */

const USER_ID = "user-1";
type QueryResult = { data: unknown; error: null };

function createFakeSupabase(results: Record<string, QueryResult>) {
  const calls: { table: string; op: string }[] = [];
  function chainFor(table: string) {
    let op = "select";
    const chain: Record<string, unknown> = {
      then(resolve: (v: QueryResult) => unknown) {
        calls.push({ table, op });
        return Promise.resolve(resolve(results[`${table}:${op}`] ?? { data: null, error: null }));
      },
    };
    for (const write of ["insert", "upsert", "update", "delete"]) {
      chain[write] = () => {
        op = write;
        return chain;
      };
    }
    for (const f of ["select", "eq", "neq", "gte", "lte", "limit", "single", "maybeSingle"]) chain[f] = () => chain;
    return chain;
  }
  return {
    client: {
      auth: { getUser: async () => ({ data: { user: { id: USER_ID } }, error: null }) },
      from: (table: string) => chainFor(table),
    },
    calls,
  };
}

const createClientMock = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ createClient: () => createClientMock() }));

const PROFILE = { data: { subscription_tier: "free", subscription_status: null }, error: null as null };

function recentGpx(hoursAgo = 2): string {
  const t0 = Date.now() - hoursAgo * 3_600_000;
  const at = (s: number) => new Date(t0 + s * 1000).toISOString();
  return `<gpx creator="Test"><trk><type>running</type><trkseg>
    <trkpt lat="51.5000" lon="-0.1200"><ele>20</ele><time>${at(0)}</time></trkpt>
    <trkpt lat="51.5004" lon="-0.1194"><ele>22</ele><time>${at(10)}</time></trkpt>
    <trkpt lat="51.5008" lon="-0.1188"><ele>21</ele><time>${at(20)}</time></trkpt>
  </trkseg></trk></gpx>`;
}

async function post(file: { name: string; body: string | Uint8Array } | null, results: Record<string, QueryResult> = {}) {
  const { client, calls } = createFakeSupabase({ "profiles:select": PROFILE, ...results });
  createClientMock.mockResolvedValue(client);
  const { POST } = await import("./route");
  const form = new FormData();
  if (file) form.append("file", new Blob([file.body as BlobPart]), file.name);
  const response = await POST(new Request("http://localhost/api/activities/import", { method: "POST", body: form }));
  return { response, body: await response.json(), calls };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/activities/import", () => {
  it("answers a recent GPX with a preview, a file-derived request id, and no write", async () => {
    const { response, body, calls } = await post({ name: "run.gpx", body: recentGpx() });
    expect(response.status).toBe(200);
    expect(body.kind).toBe("gpx");
    expect(body.preview.fields.sport).toBe("running");
    expect(body.preview.fields.duration_seconds).toBe(20);
    expect(body.clientRequestId).toMatch(/^file-[0-9a-f]{48}$/);
    expect(body.alreadyImported).toBeNull();
    expect(body.duplicateOf).toBeNull();
    expect(calls.every((c) => c.op === "select")).toBe(true);
  });

  it("gives the same request id for the same bytes, so a re-upload is the same save", async () => {
    const gpx = recentGpx();
    const a = await post({ name: "a.gpx", body: gpx });
    const b = await post({ name: "b.gpx", body: gpx });
    expect(a.body.clientRequestId).toBe(b.body.clientRequestId);
  });

  it("says when this file is already in the log", async () => {
    const { body } = await post({ name: "run.gpx", body: recentGpx() }, { "activities:select": { data: { id: "act-1" }, error: null } });
    expect(body.alreadyImported).toEqual({ id: "act-1" });
  });

  it("refuses a session older than ninety days", async () => {
    const { response, body } = await post({ name: "old.gpx", body: recentGpx(24 * 120) });
    expect(response.status).toBe(422);
    expect(body.error).toMatch(/older than 90 days/);
  });

  it("refuses something that is not a workout file", async () => {
    const { response } = await post({ name: "notes.txt", body: "hello" });
    expect(response.status).toBe(422);
  });

  it("refuses a request with no file", async () => {
    const { response } = await post(null);
    expect(response.status).toBe(400);
  });
});
