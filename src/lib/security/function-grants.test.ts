import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/lib/testing/source-scan";

/**
 * Every SECURITY DEFINER function must be revoked from `anon`, not only PUBLIC.
 *
 * WHY THIS IS NOT THE OBVIOUS RULE
 * --------------------------------
 * `REVOKE ALL ON FUNCTION f() FROM PUBLIC` reads like it removes everyone. It
 * removes the implicit grant Postgres gives PUBLIC, and nothing else. A Supabase
 * project bootstraps with `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL
 * ON FUNCTIONS TO anon, authenticated, service_role`, so each new function is
 * ALSO granted to `anon` by name at creation — and a direct grant survives a
 * revoke aimed at PUBLIC.
 *
 * This was found twice from opposite directions on the same day. A peer's 065
 * wrote `GRANT ... TO authenticated, service_role` believing it restricted, and
 * it added. 060/061/063 wrote `REVOKE ... FROM PUBLIC` believing it removed, and
 * it removed half. Both are the same default, and neither was visible in review
 * because both lines look exactly like the correct thing.
 *
 * A grep is a poor substitute for asking the database. It is what is available
 * without one, it catches the shape of the mistake, and 067 carries the
 * `pg_proc.proacl` query for whoever does have a connection.
 */

const MIGRATIONS = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url)
);

interface Fn {
  file: string;
  name: string;
  definer: boolean;
}

/** Every function a migration defines, with whether it is SECURITY DEFINER. */
function definedFunctions(): Fn[] {
  const found: Fn[] = [];

  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    const sql = stripSqlComments(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));

    for (const m of sql.matchAll(
      /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi
    )) {
      // The body runs to the closing $$ of this definition.
      const rest = sql.slice(m.index!);
      const end = rest.indexOf("$$;");
      const body = end === -1 ? rest : rest.slice(0, end);
      found.push({
        file,
        name: m[1],
        definer: /SECURITY DEFINER/i.test(body),
      });
    }
  }

  return found;
}

/** All migration SQL concatenated in apply order, comments stripped. */
function allSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => stripSqlComments(readFileSync(`${MIGRATIONS}/${f}`, "utf8")))
    .join("\n");
}

/**
 * SECURITY DEFINER functions that are knowingly NOT revoked from `anon` yet,
 * each with the reason. An allowlist rather than a pattern, because adding to
 * it is a decision about who can execute privileged code and should read like
 * one.
 *
 * These three predate the audit and none was introduced by it. They are left
 * alone deliberately: 067 was written with an App Store submission pending, and
 * revoking a function used inside an RLS policy is the kind of change that
 * turns "returns no rows" into "the query errors" — which cannot be settled
 * without a database to try it against. Recorded as N11 rather than guessed at.
 */
const NOT_YET_REVOKED: Record<string, string> = {
  activity_is_visible_to:
    "referenced by the 'Friends view shared activities' SELECT policy on " +
    "activities (049:157). If any anonymous read path evaluates that policy, " +
    "revoking EXECUTE turns a no-rows result into an error. Needs a database " +
    "to settle, not a guess.",
  sync_profile_current_index:
    "RETURNS TRIGGER. Postgres refuses to invoke a trigger function directly " +
    "and PostgREST does not expose one, so no role can reach it over the API.",
  update_updated_at:
    "RETURNS TRIGGER, same reasoning as above: not invocable directly by any " +
    "role, and it only stamps updated_at on a row already being written.",
};

describe("SECURITY DEFINER functions are not reachable by anon", () => {
  it("finds functions to check", () => {
    // A rename or a parser change would make every assertion below vacuous.
    const fns = definedFunctions();
    expect(fns.length).toBeGreaterThan(3);
    expect(fns.some((f) => f.definer)).toBe(true);
  });

  /**
   * THE FAILING-BEFORE TEST. Against the parent commit, three functions —
   * withdraw_article9_health_data, caller_email_verified and
   * prune_security_events — are revoked from PUBLIC and from nothing else.
   */
  it("revokes EXECUTE from anon, not only from PUBLIC", () => {
    const sql = allSql();
    const missing = definedFunctions()
      .filter((f) => f.definer)
      .filter((f) => !(f.name in NOT_YET_REVOKED))
      .filter((f) => {
        // Any revoke naming this function and mentioning anon, in any migration.
        const pattern = new RegExp(
          `REVOKE[^;]*ON FUNCTION\\s+(?:public\\.)?${f.name}\\s*\\([^)]*\\)[^;]*\\banon\\b`,
          "i"
        );
        return !pattern.test(sql);
      })
      .map((f) => `${f.name} (defined in ${f.file})`);

    expect(
      Array.from(new Set(missing)),
      "these run as their definer and are still granted to anon by Supabase's " +
        "default privileges. REVOKE ... FROM PUBLIC does not remove a grant held " +
        "directly by a role — name anon explicitly:\n  " + missing.join("\n  ")
    ).toEqual([]);
  });

  /**
   * The one with no caller scoping, called out by name because its failure mode
   * differs in kind. withdraw_article9_health_data is saved by `auth.uid()`
   * being NULL for an anonymous caller; prune_security_events selects by date
   * and has no such accident protecting it.
   */
  it("keeps the audit-log prune away from every web role", () => {
    const sql = allSql();
    for (const role of ["anon", "authenticated"]) {
      expect(
        new RegExp(
          `REVOKE[^;]*ON FUNCTION\\s+(?:public\\.)?prune_security_events\\s*\\(\\)[^;]*\\b${role}\\b`,
          "i"
        ).test(sql),
        `prune_security_events is not revoked from ${role}`
      ).toBe(true);
    }
    // And never handed back.
    expect(
      /GRANT[^;]*ON FUNCTION\s+(?:public\.)?prune_security_events\s*\(\)[^;]*\b(anon|authenticated)\b/i.test(sql)
    ).toBe(false);
  });

  /**
   * The withdrawal path must stay open to signed-in athletes. Closing it would
   * swap a permissions defect for a compliance one: it is the mechanism by
   * which somebody withdraws Article 9 consent.
   */
  it("leaves Article 9 withdrawal available to authenticated users", () => {
    expect(
      /GRANT EXECUTE ON FUNCTION\s+(?:public\.)?withdraw_article9_health_data\s*\(\)\s+TO\s+authenticated/i.test(
        allSql()
      )
    ).toBe(true);
  });

  it("keeps every deliberate exclusion documented with a reason", () => {
    for (const [name, reason] of Object.entries(NOT_YET_REVOKED)) {
      expect(reason.length, `${name} has no reason recorded`).toBeGreaterThan(40);
    }
  });

  it("does not let the allowlist quietly cover a NEW function", () => {
    // The three known ones all predate the audit. A fourth appearing here means
    // somebody added a privileged function and excused it rather than revoking.
    expect(Object.keys(NOT_YET_REVOKED).sort()).toEqual([
      "activity_is_visible_to",
      "sync_profile_current_index",
      "update_updated_at",
    ]);
  });
});
