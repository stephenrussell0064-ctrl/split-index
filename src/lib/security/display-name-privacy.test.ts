import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { stripSqlComments } from "@/lib/testing/source-scan";

/**
 * N10 — `display_name` must never hold an athlete's email address.
 *
 * `display_name` is published to `anon` through `public_profiles` (migration
 * 056), so anything stored there is readable from the internet with the key
 * that ships in the client bundle by design. `handle_new_user()` wrote
 * `NEW.email` into it from migration 007 until 061.
 *
 * The application-layer fix that landed on `main` (`publicDisplayName`) guards
 * every render site and cannot guard the view, because PostgREST does not run
 * TypeScript. So the assertion that matters is about the SQL — and it is made
 * against the LAST definition in apply order rather than any single file. The
 * effective definition is whichever migration ran most recently, and a future
 * `0NN_fix_signup_again.sql` reinstating the fallback is exactly the regression
 * worth catching.
 *
 * This file lives under src/ rather than beside the migrations because vitest
 * only collects from src, scripts and tests. Written there first, it was never
 * run — which is the failure mode ci.yml calls a test that is really a comment.
 */

const MIGRATIONS = fileURLToPath(
  new URL("../../../supabase/migrations", import.meta.url)
);

const FIX = "081_display_name_never_an_email_at_source.sql";

/**
 * The raw address is `NEW.email`. The `\b` matters: 091 mirrors
 * `NEW.email_confirmed_at` (a timestamp) onto profiles, and a bare
 * `/NEW\.email/` matched the first nine characters of that identifier and
 * failed the suite against a trigger that writes no address at all. `_` is a
 * word character, so the boundary refuses `email_confirmed_at` and still
 * catches `NEW.email` followed by `)`, `,`, whitespace or a cast.
 */
const RAW_EMAIL_WRITE = /NEW\.email\b/i;

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort();
}

function sqlOf(file: string): string {
  return stripSqlComments(readFileSync(`${MIGRATIONS}/${file}`, "utf8"));
}

/**
 * Every `handle_new_user` body, in apply order, with SQL comments removed.
 *
 * Stripping is not optional: 064's header quotes the defective line verbatim in
 * order to explain it, and 006 and 007 discuss it too. A scanner that read
 * comments would report the bug as present in the migration that fixes it —
 * which has now happened six times in this repository, and is why
 * `stripSqlComments` exists.
 */
function handleNewUserBodies(): { file: string; body: string }[] {
  const found: { file: string; body: string }[] = [];
  for (const file of migrationFiles()) {
    const match = sqlOf(file).match(
      /CREATE (?:OR REPLACE )?FUNCTION\s+(?:public\.)?handle_new_user\s*\(\s*\)[\s\S]*?\$\$([\s\S]*?)\$\$/i
    );
    if (match) found.push({ file, body: match[1] });
  }
  return found;
}

describe("the signup trigger", () => {
  it("is defined by at least one migration, so this test has something to read", () => {
    // A rename would make every assertion below vacuously true.
    expect(handleNewUserBodies().length).toBeGreaterThan(0);
  });

  /**
   * THE FAILING-BEFORE TEST. Against the parent commit the effective definition
   * is 007's:
   *
   *   COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
   */
  it("never writes the athlete's email address into a profile", () => {
    const bodies = handleNewUserBodies();
    const effective = bodies[bodies.length - 1];

    expect(
      effective.body,
      `${effective.file} is the last definition of handle_new_user and it puts ` +
        "NEW.email into profiles. That column is published to anon through " +
        "public_profiles, so this writes an email address somewhere strangers " +
        "can read it. See N10 in AUDIT-split-index.md."
    ).not.toMatch(RAW_EMAIL_WRITE);
  });

  /**
   * Guards the regex itself, in both directions. Loosening it back to
   * `/NEW\.email/` fails the first case; a well-meant tightening to something
   * like `/NEW\.email\)/` would pass 091 and miss `NEW.email,` or `NEW.email `,
   * which fails the second.
   */
  it("the email check distinguishes the address from its confirmation timestamp", () => {
    expect("VALUES (NEW.id, provided_name, NEW.email_confirmed_at)").not.toMatch(
      RAW_EMAIL_WRITE
    );
    for (const regression of [
      "COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)",
      "VALUES (NEW.id, NEW.email, NEW.email_confirmed_at)",
      "VALUES (NEW.id, NEW.email::text)",
      "VALUES (NEW.id, new.Email )",
    ]) {
      expect(regression).toMatch(RAW_EMAIL_WRITE);
    }
  });

  it("still writes the row it exists to write", () => {
    // The trigger is there so a profile always accompanies an auth user. A fix
    // that stopped inserting would be a worse bug than the one it replaced.
    const effective = handleNewUserBodies().slice(-1)[0];
    expect(effective.body).toMatch(/INSERT INTO\s+public\.profiles/i);
    expect(effective.body).toMatch(/ON CONFLICT\s*\(\s*user_id\s*\)\s*DO NOTHING/i);
  });

  it("keeps the properties that make it safe to run as a trigger", () => {
    const last = migrationFiles()
      .filter((f) =>
        /CREATE (OR REPLACE )?FUNCTION\s+(public\.)?handle_new_user/i.test(sqlOf(f))
      )
      .slice(-1)[0];

    // An unpinned search_path in a SECURITY DEFINER function is a privilege
    // escalation, and this one runs as the definer on every signup.
    expect(sqlOf(last)).toMatch(/SECURITY DEFINER/i);
    expect(sqlOf(last)).toMatch(/SET search_path = public/i);
  });

  it("discards a provider-supplied name that is itself an address", () => {
    // Some OAuth providers return the email in the name field, which walks
    // straight back into the bug through the branch that looks safe.
    expect(handleNewUserBodies().slice(-1)[0].body).toMatch(/LIKE '%@%'/);
  });
});

describe("the scrub in 081", () => {
  const sql = sqlOf(FIX);

  it("nulls the rows whose stored name is the athlete's own address", () => {
    expect(sql).toMatch(/UPDATE\s+public\.profiles/i);
    expect(sql).toMatch(/lower\(p\.display_name\)\s*=\s*lower\(u\.email\)/i);
  });

  /**
   * The decision this test exists to protect.
   *
   * Widening the predicate to `display_name LIKE '%@%'` would read as a
   * tightening and would destroy data: "@rachelruns" is a plausible chosen
   * name, a hand-typed display_name has no copy anywhere to restore from, and
   * deleting somebody's chosen name to fix a bug we caused would be a second
   * wrong. The exact-match bucket is also the only recoverable one — every row
   * it nulls equalled `auth.users.email`, and that row still exists.
   */
  it("does not scrub every name containing an @", () => {
    const update = sql.slice(sql.search(/UPDATE\s+public\.profiles/i));
    expect(
      update,
      "the scrub was widened to any name containing '@'. That irreversibly " +
        "deletes names athletes chose for themselves. See the reasoning in 081."
    ).not.toMatch(/display_name\s+LIKE\s+'%@%'/i);
  });

  it("applies the trigger fix and the scrub as one transaction", () => {
    // Half-applied leaves either the old trigger refilling a scrubbed column,
    // or a fixed trigger with every stored address still sitting there.
    expect(sql).toMatch(/^\s*BEGIN;/m);
    expect(sql).toMatch(/^\s*COMMIT;/m);
    expect(sql.indexOf("BEGIN;")).toBeLessThan(sql.search(/UPDATE\s+public\.profiles/i));
  });

  it("carries an impact query to run before it is applied", () => {
    // Same rule as 058: a destructive UPDATE against real rows is not applied
    // without the operator knowing the counts first. The query lives in
    // comments, so this assertion reads the raw file rather than the stripped one.
    const raw = readFileSync(`${MIGRATIONS}/${FIX}`, "utf8");
    expect(raw).toContain("RUN THIS BEFORE APPLYING");
    expect(raw).toMatch(/exposed_via_view/);
  });
});
