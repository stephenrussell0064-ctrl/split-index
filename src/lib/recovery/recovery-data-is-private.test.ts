import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "@/lib/testing/source-scan";

/**
 * The alcohol log never leaves the athlete's own account.
 *
 * WHY THIS IS A TEST AND NOT A CONVENTION
 * ---------------------------------------
 * `drink_logs` is processed as ordinary personal data rather than as special
 * category health data, and that classification is argued in
 * lib/consent/article9.ts on four conditions. Two of them are about where the
 * data can appear, and both are the kind of thing broken by accident: somebody
 * adds a column to a friend-visible view, or joins the table into a share
 * card, and nothing fails. There is no runtime error for making health-adjacent
 * data visible to a stranger — it just works, which is the problem.
 *
 * So the boundary is asserted mechanically. If this test fails, the question
 * is not "how do I add this file to the allowlist" — it is whether the feature
 * being built has just moved this table into Article 9, in which case it needs
 * the consent gate the classification note describes.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..", "..");
const SRC = join(REPO, "src");
const MIGRATIONS = join(REPO, "supabase", "migrations");

/**
 * Every file allowed to name the table, and why.
 *
 * An explicit allowlist rather than a directory pattern, because "anything
 * under components/recovery" would happily cover a share-card component
 * somebody dropped in there next month.
 */
const ALLOWED: Record<string, string> = {
  "src/lib/recovery/data.ts": "the only read path, owner-scoped",
  "src/lib/recovery/recovery-data-is-private.test.ts": "this test",
  "src/app/api/recovery/drinks/route.ts": "log, list and erase, all owner-scoped",
  "src/app/api/recovery/drinks/[id]/route.ts": "delete one row, owner-scoped",
  "src/app/api/recovery/drinks/route.test.ts": "tests for the write path",
  "src/lib/consent/article9.ts": "names the table only to record why it is Tier 1",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js)$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * Files that reference the table IN CODE.
 *
 * Comments are stripped first, with the same helper premium-policy.test uses.
 * Without it this flags any file that merely explains the rule — the consent
 * route documenting what the leaderboard view reads, for instance — and a
 * guard that fires on prose about itself teaches people to add allowlist
 * entries, which is how it stops guarding anything.
 */
function filesNaming(table: string): string[] {
  return walk(SRC)
    .filter((file) => stripComments(readFileSync(file, "utf8")).includes(table))
    .map((file) => relative(REPO, file).replace(/\\/g, "/"));
}

/**
 * Every migration, with `--` comments stripped.
 *
 * The stripping is not tidiness. This repo's migrations explain themselves at
 * length, and 086's header discusses the `anon` grant it deliberately does not
 * write — so a naive search for a GRANT mentioning anon finds the prose
 * explaining its absence and fails on the file that is correct.
 */
function migrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(join(MIGRATIONS, f), "utf8"))
    .join("\n")
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

describe("the alcohol log is reachable only from the recovery feature", () => {
  it("is not queried from any file outside the allowlist", () => {
    const unexpected = filesNaming("drink_logs").filter((f) => !(f in ALLOWED));

    expect(
      unexpected,
      `These files reference drink_logs and are not on the allowlist in ${relative(REPO, join(HERE, "recovery-data-is-private.test.ts"))}. ` +
        "Sharing this data, or inferring health status from it, moves it into Article 9 and requires an explicit consent gate — see lib/consent/article9.ts."
    ).toEqual([]);
  });

  it("never appears in a social, leaderboard, export or share surface", () => {
    // Belt and braces over the allowlist: named directories that must never
    // touch it, checked by path rather than by trusting the list above to stay
    // complete.
    const forbidden = filesNaming("drink_logs").filter((f) =>
      /\/(social|leaderboard|export|share|marketing)\//.test(f)
    );
    expect(forbidden).toEqual([]);
  });
});

describe("the alcohol log is private at the database", () => {
  const sql = migrationSql();

  /**
   * ONE view may read this table, and only on terms.
   *
   * Projection views here run `security_invoker = off` and read straight past
   * RLS — that is how a leaderboard sees anybody but you, and it is why this
   * used to assert that NO view touched drink_logs at all.
   *
   * 087 is the deliberate exception: the opt-in alcohol-free streak board.
   * The exception is narrow and the assertions below are what keep it narrow —
   * it must be gated on explicit consent, it must publish no drink detail, and
   * it must stay unreadable by `anon`. A second view, or this one losing its
   * consent predicate, fails here.
   */
  const ALLOWED_VIEW = "public_alcohol_free_streaks";

  function viewsTouchingDrinkLogs(): string[] {
    const views = sql.match(/CREATE\s+(?:OR REPLACE\s+)?VIEW[\s\S]*?;/gi) ?? [];
    return views.filter((v) => /drink_logs/i.test(v));
  }

  it("is projected into exactly one view, and that view is the streak board", () => {
    const touching = viewsTouchingDrinkLogs();
    expect(touching).toHaveLength(1);
    expect(touching[0]).toMatch(new RegExp(ALLOWED_VIEW, "i"));
  });

  it("gates that view on explicit consent, so nobody appears without opting in", () => {
    const view = viewsTouchingDrinkLogs()[0] ?? "";
    // The consent key, and a predicate requiring the newest event to be a grant.
    expect(view).toMatch(/alcohol_free_streak_leaderboard/);
    expect(view).toMatch(/article9_consent_events/);
    expect(view).toMatch(/action\s*=\s*'granted'/i);
  });

  it("publishes a streak and nothing about any individual drink", () => {
    // The column list IS the security boundary — whatever the SELECT below it
    // grows later, only what is named here can ever leave.
    const columnList = (viewsTouchingDrinkLogs()[0] ?? "").split(") AS")[0] ?? "";
    for (const forbidden of ["grams_ethanol", "volume_ml", "abv_percent", "drank_at", "label", "preset_id", "note"]) {
      expect(columnList.toLowerCase()).not.toContain(forbidden);
    }
    expect(columnList).toMatch(/streak_days/);
  });

  it("keeps that view away from anon", () => {
    const grants = sql.match(new RegExp(`GRANT[^;]*${ALLOWED_VIEW}[^;]*;`, "gi")) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    expect(grants.some((g) => /\banon\b/i.test(g))).toBe(false);
    expect(sql).toMatch(new RegExp(`REVOKE ALL ON ${ALLOWED_VIEW} FROM PUBLIC, anon`, "i"));
  });

  it("is never granted to anon", () => {
    const grants = sql.match(/GRANT[^;]*drink_logs[^;]*;/gi) ?? [];
    expect(grants.some((g) => /\banon\b/i.test(g))).toBe(false);
  });

  it("has row level security enabled and an owner-scoped policy", () => {
    expect(sql).toMatch(/ALTER TABLE drink_logs ENABLE ROW LEVEL SECURITY/i);
    /*
     * `[^;]*` rather than a lazy `[\s\S]*?`: without the statement boundary,
     * the match runs from the first CREATE POLICY anywhere in the migration
     * set to the first "ON drink_logs", which is the CREATE INDEX line — and
     * the assertion then reads an index definition looking for a policy.
     */
    const policy = sql.match(/CREATE POLICY[^;]*ON drink_logs[^;]*;/i)?.[0] ?? "";
    expect(policy).toMatch(/USING \(auth\.uid\(\) = user_id\)/i);
    // WITH CHECK as well, so a row cannot be written carrying someone else's id.
    expect(policy).toMatch(/WITH CHECK \(auth\.uid\(\) = user_id\)/i);
  });

  it("is erased with the account", () => {
    // The classification depends on the athlete keeping control of this data,
    // and erasure is the end of that. The cascade is what delivers it.
    const create = sql.split(/CREATE TABLE IF NOT EXISTS drink_logs/i)[1]?.split(");")[0] ?? "";
    expect(create).toMatch(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/i);
  });
});
