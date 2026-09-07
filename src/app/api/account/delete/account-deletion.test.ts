import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stripSqlComments } from "@/lib/testing/source-scan";

/**
 * M5 / WP11.3 — erasure is complete, and stays complete.
 *
 * "An account deletion that removes or irreversibly anonymises rows across
 * every table including the leaderboard projection and any materialised or
 * cached copy. Test that a deleted user cannot be reconstructed."
 *
 * Without a live database the second half cannot be executed — there is no row
 * to delete and nothing to query afterwards. What CAN be proved, and is
 * stronger than a single end-to-end deletion would be, is the structural
 * guarantee: every table carrying a user column cascades from `auth.users`, so
 * one statement erases all of them and a table added later is covered the day
 * it is created.
 *
 * That is the property the route now depends on, so it is the property under
 * test.
 */

/*
 * At module scope, not inside the describe below. vi.hoisted and vi.mock are
 * lifted above everything regardless of where they are written, so nesting them
 * makes the file read in an order it does not execute in — and vitest now warns
 * that it will stop accepting it.
 */
const { createClientMock, adminClientMock, deleteUserMock, tableOps } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  adminClientMock: vi.fn(),
  deleteUserMock: vi.fn(),
  tableOps: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => createClientMock() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: (source: string, context?: unknown) => adminClientMock(source, context),
}));

const ROOT = fileURLToPath(new URL("../../../../..", import.meta.url));
const MIGRATIONS = `${ROOT}/supabase/migrations`;

/** Every migration concatenated in apply order, SQL comments removed. */
function allSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => stripSqlComments(readFileSync(`${MIGRATIONS}/${f}`, "utf8")))
    .join("\n");
}

/** Column names that identify a person, in the tables that hold their data. */
const USER_COLUMNS = [
  "user_id",
  "friend_id",
  "challenger_id",
  "opponent_id",
  "created_by",
  "admin_user_id",
];

interface UserColumn {
  table: string;
  column: string;
  rule: "CASCADE" | "SET NULL" | "NONE";
}

function userColumns(): UserColumn[] {
  const sql = allSql();
  const found: UserColumn[] = [];

  const dropped = new Set(
    [...sql.matchAll(/DROP TABLE(?:\s+IF EXISTS)?\s+(?:public\.)?([a-z_0-9]+)/gi)].map(
      (m) => m[1]
    )
  );

  for (const match of sql.matchAll(
    /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi
  )) {
    const table = match[1];
    if (dropped.has(table)) continue;

    // Walk to the matching close paren so only this table's columns are read.
    let depth = 0;
    let i = match.index! + match[0].length - 1;
    const start = i;
    for (; i < sql.length; i++) {
      if (sql[i] === "(") depth++;
      else if (sql[i] === ")") {
        depth--;
        if (depth === 0) break;
      }
    }

    for (const line of sql.slice(start + 1, i).split("\n")) {
      const column = USER_COLUMNS.find((c) =>
        new RegExp(`^\\s*${c}\\s`).test(line)
      );
      if (!column) continue;
      if (!/REFERENCES\s+auth\.users/i.test(line)) {
        found.push({ table, column, rule: "NONE" });
      } else if (/ON DELETE CASCADE/i.test(line)) {
        found.push({ table, column, rule: "CASCADE" });
      } else if (/ON DELETE SET NULL/i.test(line)) {
        found.push({ table, column, rule: "SET NULL" });
      } else {
        found.push({ table, column, rule: "NONE" });
      }
    }
  }

  return found;
}

/**
 * The three columns that deliberately survive an erasure, each with the reason.
 *
 * Adding to this list is a decision about somebody's right to erasure, so it is
 * an explicit allowlist rather than a pattern. Anything not here must cascade.
 */
const SURVIVES_ERASURE: Record<string, string> = {
  "admin_access_log.admin_user_id":
    "an erased account must not erase the record that it once read the fleet",
  "security_events.user_id":
    "an erased account must not erase the record that it was denied repeatedly",
  "challenges.created_by":
    "a challenge other athletes joined outlives the person who created it",
};

describe("every table holding user data cascades from auth.users", () => {
  it("finds no user column outside the cascade graph", () => {
    const orphans = userColumns()
      .filter((c) => c.rule !== "CASCADE")
      .filter((c) => !(`${c.table}.${c.column}` in SURVIVES_ERASURE))
      .map((c) => `${c.table}.${c.column} (${c.rule})`);

    expect(
      orphans,
      "these hold user data and would SURVIVE an account deletion. Either add " +
        "ON DELETE CASCADE, or add them to SURVIVES_ERASURE with the reason — " +
        "which is a decision about somebody's right to erasure, not a test fix:\n  " +
        orphans.join("\n  ")
    ).toEqual([]);
  });

  it("covers the tables that hold health data", () => {
    // Named explicitly. These are the Article 9 tables, and "was it deleted"
    // is the question that matters most about them.
    const cascading = new Set(
      userColumns().filter((c) => c.rule === "CASCADE").map((c) => c.table)
    );
    for (const table of [
      "hpe_intake",
      "hpe_injury_reports",
      "hpe_athlete_profile",
      "hpe_session_feedback",
      "hpe_generation_events",
      "article9_consent_events",
      "recovery_snapshots",
      "sleep_logs",
      "body_metrics",
    ]) {
      expect(cascading.has(table), `${table} does not cascade`).toBe(true);
    }
  });

  it("covers the leaderboard projection, which is a cached copy", () => {
    // WP11.3 names it specifically: a deleted athlete must not be
    // reconstructable from the precomputed board.
    const cascading = new Set(
      userColumns().filter((c) => c.rule === "CASCADE").map((c) => c.table)
    );
    expect(cascading.has("leaderboard_entries")).toBe(true);
  });

  it("keeps every survivor documented with a reason", () => {
    for (const [key, reason] of Object.entries(SURVIVES_ERASURE)) {
      expect(reason.length, `${key} has no reason recorded`).toBeGreaterThan(20);
    }
  });
});

describe("the route deletes in one statement", () => {
  function client() {
    function chainFor(table: string) {
      const chain: Record<string, unknown> = {
        then: (r: (v: { data: unknown; error: null }) => unknown) =>
          Promise.resolve(r({ data: null, error: null })),
      };
      for (const op of ["delete", "insert", "update", "upsert"]) {
        chain[op] = () => {
          tableOps(`${table}.${op}`);
          return chain;
        };
      }
      for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle"]) {
        chain[m] = () => chain;
      }
      return chain;
    }
    return {
      auth: {
        getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
        admin: { deleteUser: deleteUserMock },
      },
      from: (t: string) => chainFor(t),
    };
  }

  beforeEach(() => {
    vi.resetModules();
    tableOps.mockReset();
    deleteUserMock.mockReset().mockResolvedValue({ error: null });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const c = client();
    createClientMock.mockReturnValue(c);
    adminClientMock.mockReturnValue(c);
  });

  afterEach(() => vi.restoreAllMocks());

  it("deletes the auth user and nothing table by table", async () => {
    const { DELETE } = await import("./route");
    const res = await DELETE();

    expect(res.status).toBe(200);
    expect(deleteUserMock).toHaveBeenCalledWith("user-1");

    // The whole point of the rewrite. Any per-table delete means the route is
    // back to being non-atomic, and the cascade is doing the work twice.
    const deletes = tableOps.mock.calls.map((c) => c[0]).filter((op: string) => op.endsWith(".delete"));
    expect(deletes, `route issued table deletes: ${deletes.join(", ")}`).toEqual([]);
  });

  /**
   * The failure that used to be unrecoverable: a 500 partway through, with rows
   * already gone and the login still working. One statement makes that state
   * unreachable — either the cascade ran or it did not.
   */
  it("leaves the account untouched when the delete fails", async () => {
    deleteUserMock.mockResolvedValue({ error: { message: "auth service down" } });
    const { DELETE } = await import("./route");
    const res = await DELETE();

    expect(res.status).toBe(500);
    const deletes = tableOps.mock.calls.map((c) => c[0]).filter((op: string) => op.endsWith(".delete"));
    expect(deletes).toEqual([]);
  });

  it("does not leak the auth provider's error text", async () => {
    deleteUserMock.mockResolvedValue({
      error: { message: 'relation "auth.users" does not exist' },
    });
    const { DELETE } = await import("./route");
    const body = await (await DELETE()).text();
    expect(body).not.toContain("auth.users");
    expect(body).toContain("ref ");
  });

  /**
   * The record moved, and the test moved with it.
   *
   * It used to read the console for an `elevated_query` line. N9 made `source` a
   * required argument of `createAdminClient` and put the record inside it, so
   * that line is now emitted by the real client — which this file mocks. Reading
   * stdout would prove nothing here.
   *
   * Asserting the ARGUMENTS is stronger anyway: it pins the source, the user id
   * and the reason, and it pins the ordering that matters, because obtaining the
   * client is what happens before the delete. After it there is no user id left
   * to record, and an erasure with no record that it was requested is
   * indistinguishable from data loss.
   */
  it("records the erasure before the id stops referring to anybody", async () => {
    const { DELETE } = await import("./route");
    await DELETE();

    expect(adminClientMock).toHaveBeenCalledWith("/api/account/delete", {
      userId: "user-1",
      detail: { action: "account_erasure_requested" },
    });

    // And it is obtained before the delete is attempted, not after.
    expect(adminClientMock.mock.invocationCallOrder[0]).toBeLessThan(
      deleteUserMock.mock.invocationCallOrder[0]
    );
  });
});
