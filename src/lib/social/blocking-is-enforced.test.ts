import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/lib/testing/source-scan";

/**
 * Blocking is a database rule, and these tests are what keeps it one.
 *
 * WHY THEY ASSERT AGAINST SQL. The enforcement is an RLS policy and a
 * SECURITY DEFINER function. There is no TypeScript to unit-test that would
 * fail if the policy were dropped, and a passing suite over the route handlers
 * is exactly what existed while the gap was open.
 *
 * THE GAP THESE PIN. `activity_is_visible_to` answers about an activity's
 * OWNER. On an activity belonging to a friend the two people have in common,
 * that is the wrong party — so a blocked athlete's comments reached the person
 * who blocked them, with username, display name and avatar attached, and
 * symmetrically in the other direction. Nothing filtered it: not the policy,
 * not the route, not the client.
 *
 * AND THE COMMENT THAT HID IT. Two source comments said the database enforced
 * blocking via `is_blocked_pair` in migration 062. That function was never in
 * this schema — it came from an unmerged branch — and 062 is
 * `admin_access_log`. Anyone auditing blocking read those lines and stopped.
 * The last test here fails if that name comes back without the function.
 */

const MIGRATIONS = fileURLToPath(new URL("../../../supabase/migrations", import.meta.url));
const SRC = fileURLToPath(new URL("../..", import.meta.url));

const BLOCKING_MIGRATION = "084_blocking_is_enforced_by_the_database.sql";

function migrationSql(name: string): string {
  return stripSqlComments(readFileSync(`${MIGRATIONS}/${name}`, "utf8"));
}

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

/** The body of one function definition, comments already stripped. */
function functionBody(sql: string, name: string): string {
  const after = sql.split(new RegExp(`CREATE (?:OR REPLACE )?FUNCTION\\s+${name}\\s*\\(`, "i"))[1];
  if (after === undefined) throw new Error(`${name} is not defined in that migration`);
  const end = after.indexOf("$$;");
  return end === -1 ? after : after.slice(0, end);
}

/** The USING clause of one named policy, comments already stripped. */
function policyUsing(sql: string, policyName: string, table: string): string {
  const after = sql.split(
    new RegExp(`CREATE POLICY "${policyName}" ON ${table} FOR SELECT`, "i")
  )[1];
  if (after === undefined) throw new Error(`no SELECT policy "${policyName}" on ${table}`);
  // Up to the statement terminator — policies here are one statement each.
  const end = after.indexOf(";");
  return end === -1 ? after : after.slice(0, end);
}

describe("viewer_is_blocked_with — the predicate blocking now rests on", () => {
  const sql = migrationSql(BLOCKING_MIGRATION);
  const body = functionBody(sql, "viewer_is_blocked_with");

  it("is SECURITY DEFINER, or it can only ever see half a block", () => {
    /*
      `blocked_users` carries RLS: "Users manage own blocks",
      USING (auth.uid() = blocker_id). Evaluated as the caller, this function
      would see the rows where the viewer BLOCKED someone and be blind to the
      rows where they WERE blocked — enforcing the one direction that does not
      matter and silently dropping the one that does.
    */
    expect(body).toMatch(/SECURITY DEFINER/i);
  });

  it("pins search_path, so the table it reads cannot be shadowed", () => {
    expect(body).toMatch(/SET search_path = public/i);
  });

  it("checks both directions of the block", () => {
    expect(body).toMatch(/b\.blocker_id = auth\.uid\(\)\s+AND\s+b\.blocked_id = other_id/i);
    expect(body).toMatch(/b\.blocker_id = other_id\s+AND\s+b\.blocked_id = auth\.uid\(\)/i);
  });

  it("cannot be asked about two other people", () => {
    /*
      The unmerged `is_blocked_pair(a, b)` took two arbitrary ids, so any caller
      could learn whether two named strangers had blocked each other — a fact
      about two people, answered to somebody who is neither. This takes one id
      and supplies the other from auth.uid(), so there is no argument that makes
      it answer a different question.
    */
    const signature = sql.split(/CREATE OR REPLACE FUNCTION viewer_is_blocked_with/i)[1]!;
    const args = signature.slice(signature.indexOf("("), signature.indexOf(")") + 1);
    expect(args.match(/UUID/gi) ?? []).toHaveLength(1);
    expect(body).toMatch(/auth\.uid\(\)/);
  });

  it("is revoked from PUBLIC and from anon by name", () => {
    // Supabase grants every new function to anon BY NAME at creation, and a
    // direct grant survives a revoke aimed only at PUBLIC.
    expect(sql).toMatch(
      /REVOKE ALL ON FUNCTION viewer_is_blocked_with\(UUID\) FROM PUBLIC, anon/i
    );
    expect(sql).toMatch(
      /GRANT EXECUTE ON FUNCTION viewer_is_blocked_with\(UUID\) TO authenticated/i
    );
  });
});

describe("activity_is_visible_to — the owner check", () => {
  const body = functionBody(migrationSql(BLOCKING_MIGRATION), "activity_is_visible_to");

  it("refuses a blocked pair in both directions", () => {
    /*
      Before this, the only thing closing a blocked pair's feeds was that
      POST /api/social/block deletes the friendship — an unchecked,
      fire-and-forget await, and one that POST /api/moderation/block does not
      perform at all. Visibility must not depend on a delete having succeeded.
    */
    expect(body).toMatch(/NOT EXISTS\s*\(\s*SELECT 1 FROM blocked_users/i);
    expect(body).toMatch(/b\.blocker_id = viewer_id\s+AND\s+b\.blocked_id = a\.user_id/i);
    expect(body).toMatch(/b\.blocker_id = a\.user_id\s+AND\s+b\.blocked_id = viewer_id/i);
  });

  it("keeps everything 049 established", () => {
    // Reproduced verbatim apart from the block clause. If a future edit drops
    // one of these while rewriting the function, the privacy model goes with it.
    expect(body).toMatch(/a\.is_draft = false/);
    expect(body).toMatch(/viewer_id = auth\.uid\(\)/);
    expect(body).toMatch(/p\.share_activities_with_friends = true/);
    expect(body).toMatch(/f\.status = 'accepted'/);
    expect(body).toMatch(/a\.user_id = viewer_id/);
  });

  it("is replaced in place, so no policy loses its reference mid-migration", () => {
    expect(migrationSql(BLOCKING_MIGRATION)).toMatch(
      /CREATE OR REPLACE FUNCTION activity_is_visible_to\(check_activity_id UUID, viewer_id UUID\)/i
    );
  });
});

describe("the author check on rows other people wrote", () => {
  const sql = migrationSql(BLOCKING_MIGRATION);

  it.each([
    ["View comments on visible activities", "activity_comments"],
    ["View reactions on visible activities", "activity_reactions"],
  ])("%s filters the author, not only the activity owner", (policy, table) => {
    const using = policyUsing(sql, policy, table);
    expect(using).toMatch(/activity_is_visible_to\(activity_id, auth\.uid\(\)\)/i);
    expect(using).toMatch(/AND NOT viewer_is_blocked_with\(user_id\)/i);
  });

  it.each(["activity_comments", "activity_reactions"])(
    "scopes the %s read policy TO authenticated",
    (table) => {
      /*
        Not cosmetic: it is what makes revoking viewer_is_blocked_with from anon
        safe. A policy with no TO clause applies to PUBLIC, anon evaluates it,
        and a revoked function inside it turns an empty result into a permission
        error — the trap function-grants.test.ts records for
        activity_is_visible_to. Nothing observable changes for anon, which was
        already denied by the NULL auth.uid().
      */
      const stmt = sql.split(new RegExp(`CREATE POLICY "View [a-z]+ on visible activities" ON ${table} FOR SELECT`, "i"))[1]!;
      expect(stmt.slice(0, stmt.indexOf("USING"))).toMatch(/TO authenticated/i);
    }
  );
});

describe("the comment that hid this for as long as it stood", () => {
  it("no migration defines is_blocked_pair", () => {
    const offenders = migrationFiles().filter((file) =>
      /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?is_blocked_pair\s*\(/i.test(
        migrationSql(file)
      )
    );
    expect(offenders).toEqual([]);
  });

  it("no source file claims is_blocked_pair enforces anything", () => {
    /*
      The failure this pins is not a broken build — it is a true-sounding
      sentence. Two comments said the database enforced blocking through a
      function that did not exist, and that is why the gap survived an audit.
      A file may NAME it while explaining the history; it may not present it as
      live enforcement, which is what a bare reference to it reads as.
    */
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !full.endsWith("blocking-is-enforced.test.ts")) {
          const text = readFileSync(full, "utf8");
          if (!text.includes("is_blocked_pair")) continue;
          // Collapse JSDoc wrapping first — the exempting sentence is prose and
          // will be line-broken across ` * ` continuations by any formatter.
          const prose = text.replace(/\n\s*\*\s?/g, " ").replace(/\s+/g, " ");
          // Allowed only alongside a plain statement that it never existed.
          if (!/never (?:in this schema|existed)|no such function|was not merged/i.test(prose)) {
            offenders.push(full.slice(SRC.length + 1));
          }
        }
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});
