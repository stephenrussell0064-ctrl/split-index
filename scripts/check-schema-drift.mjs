#!/usr/bin/env node
/**
 * Compare what the migrations say the database should be against what it is.
 *
 * THE GAP THIS FILLS, STATED EXACTLY. Every other schema guard here reads the
 * migration files. That catches a migration that is WRONG. It cannot catch a
 * migration that is right and was never run, because the file it reads is
 * correct — and that is a different failure with the same symptoms.
 *
 * 056 is the case. Its policy drops never reached the database, so `profiles`
 * — every column, including date_of_birth, weight_kg, max_hr and
 * stripe_customer_id — stayed readable with the key that ships in the client
 * bundle. The VIEWS from that same migration were present, because 061 and 064
 * recreate them, so the app looked like it was reading through curated
 * projections the whole time. Half a migration applied is the shape that
 * hides: the visible half works.
 *
 * BE CLEAR ABOUT WHAT THIS WOULD NOT HAVE CAUGHT, because the temptation is to
 * claim all three of the week's defects and the claim would be false. 064
 * dropped public_profiles with CASCADE and left four views dead, and 064
 * recreated leaderboard_profiles restating only its GRANT so anon kept it.
 * Both were faithfully applied — the database matched the migrations exactly,
 * so there was no drift to see. cascade-drop.test.ts and view-grants.test.ts
 * catch those, by reading the SQL.
 *
 * The two halves are complementary and neither substitutes for the other: the
 * source guards ask "does the repository say the right thing", and this asks
 * "did the database hear it". What this DOES cover for all three is the fix
 * not landing — an unapplied 071, 072 or 073 shows up here immediately, which
 * is why it is worth running after applying anything.
 *
 * WHAT IT IS NOT
 * --------------
 * Not a SQL interpreter, and it must not be mistaken for one. It models four
 * things — which views exist, which policies exist, who may SELECT each
 * relation, who may EXECUTE each function — by replaying the migrations in
 * filename order. Anything outside that model is invisible to it: column
 * definitions, constraints, indexes, triggers, DO blocks, dynamic SQL, and
 * column-level grants. A clean run means those four things agree, not that the
 * schema is correct.
 *
 * It also assumes migrations were applied in filename order and none was
 * edited after the fact. That is the convention here and the numbering guard
 * enforces the first half of it.
 *
 * THE SUPABASE DEFAULT IS PART OF THE MODEL, not an afterthought. A project
 * bootstraps with ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
 * TABLES/FUNCTIONS TO anon, authenticated — so a newly created view is
 * readable by anon the moment it exists, before any GRANT is written. A model
 * that started every new object at "no access" would call the safe state a
 * drift and miss the dangerous one entirely.
 *
 * Usage:
 *   node scripts/check-schema-drift.mjs            # compare against the live database
 *   node scripts/check-schema-drift.mjs --expected # print the expected state and exit
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, and migration
 * 074 applied. Exits 0 when they agree, 1 on drift, 2 when it could not ask.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

/** Roles the model tracks. service_role is omitted: it bypasses everything. */
export const ROLES = ["anon", "authenticated"];

/**
 * Separator for the composite keys below, spelled out rather than inlined.
 *
 * NOT A SPACE, and the reason is easy to miss: policy names contain spaces —
 * "Public profiles readable" is one — so splitting a `table + name` key on a
 * space would cut the name in half and report a policy nobody wrote. A NUL is
 * the one character that cannot occur in a Postgres identifier or in any
 * policy name that reaches this far.
 */
const KEY_SEP = "\u0000";

/** Strip `--` line comments so prose cannot be read as a statement. */
export function stripSqlComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Split into statements on semicolons outside `$$ ... $$` bodies.
 *
 * Function bodies routinely contain semicolons, and a naive split turns one
 * CREATE FUNCTION into a dozen fragments — several of which look like
 * statements this model would then act on.
 */
export function statements(sql) {
  const out = [];
  let current = "";
  let inBody = false;
  for (let i = 0; i < sql.length; i++) {
    if (sql.startsWith("$$", i)) {
      inBody = !inBody;
      current += "$$";
      i++;
      continue;
    }
    const ch = sql[i];
    if (ch === ";" && !inBody) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

/**
 * Replay every migration and return the state they describe.
 *
 * Shape: { views:Set, policies:Set<"table<SEP>name">, tableGrants:Map<"obj<SEP>role",bool>,
 *          functionGrants:Map<"fn<SEP>role",bool> }
 */
export function expectedState(files) {
  const views = new Set();
  const tables = new Set();
  /**
   * Policies a migration explicitly dropped and nothing recreated.
   *
   * The difference between the two reasons a live policy can be unexpected,
   * and it is the whole severity: one of them means a security fix did not
   * land, and the other means somebody made a table in the dashboard.
   * Collapsing them downgraded the 056 finding — the most serious of the week
   * — to a shrug.
   */
  const dropped = new Set();
  const policies = new Set();
  const tableGrants = new Map();
  const functionGrants = new Map();
  /** View bodies, so a CASCADE can work out what else goes. */
  const viewBodies = new Map();

  const grantKey = (a, b) => `${a}${KEY_SEP}${b}`;

  /**
   * The table name if this policy targets the public schema, else null.
   *
   * 010 creates four avatar policies ON storage.objects. Those live in the
   * `storage` schema, which schema_snapshot() does not read and should not —
   * it is Supabase's, not ours. The first version of this recorded the target
   * as "storage" and then reported all four as missing from the database,
   * which is the kind of noise that gets a check like this switched off.
   */
  const publicTable = (target) => {
    const parts = target.toLowerCase().split(".");
    if (parts.length === 1) return parts[0];
    return parts[0] === "public" ? parts[1] : null;
  };

  /** Supabase grants every new table, view and function to these at creation. */
  const applyCreationDefaults = (name, kind) => {
    for (const role of ROLES) {
      (kind === "function" ? functionGrants : tableGrants).set(grantKey(name, role), true);
    }
  };

  for (const { name: file, sql: raw } of files) {
    void file;
    for (const statement of statements(stripSqlComments(raw))) {
      const s = statement.replace(/\s+/g, " ").trim();

      let m;

      if ((m = /^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(s))) {
        const view = m[1].toLowerCase();
        views.add(view);
        viewBodies.set(view, s);
        applyCreationDefaults(view, "table");
        continue;
      }

      if ((m = /^DROP\s+VIEW\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)(.*)$/i.exec(s))) {
        const view = m[1].toLowerCase();
        const cascade = /\bCASCADE\b/i.test(m[2] ?? "");
        views.delete(view);
        viewBodies.delete(view);
        if (cascade) {
          // Everything whose definition names it goes too, transitively.
          let changed = true;
          const gone = new Set([view]);
          while (changed) {
            changed = false;
            for (const [other, body] of [...viewBodies]) {
              if (gone.has(other)) continue;
              if ([...gone].some((t) => new RegExp(`\\b${t}\\b`, "i").test(body))) {
                gone.add(other);
                views.delete(other);
                viewBodies.delete(other);
                changed = true;
              }
            }
          }
        }
        continue;
      }

      if ((m = /^CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)/i.exec(s))) {
        const target = publicTable(m[2]);
        if (target) {
          policies.add(grantKey(target, m[1]));
          dropped.delete(grantKey(target, m[1]));
        }
        continue;
      }

      if (
        (m = /^DROP\s+POLICY\s+(?:IF\s+EXISTS\s+)?"([^"]+)"\s+ON\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)/i.exec(s))
      ) {
        const target = publicTable(m[2]);
        if (target) {
          policies.delete(grantKey(target, m[1]));
          dropped.add(grantKey(target, m[1]));
        }
        continue;
      }

      if ((m = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(s))) {
        applyCreationDefaults(m[1].toLowerCase(), "function");
        continue;
      }

      // Tables get the same creation default as views and functions. Modelled
      // so an unexpected grant on a base table is visible; what actually keeps
      // athletes' rows private on these is RLS, which the policy check covers.
      if ((m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(s))) {
        tables.add(m[1].toLowerCase());
        applyCreationDefaults(m[1].toLowerCase(), "table");
        continue;
      }

      if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(s))) {
        const table = m[1].toLowerCase();
        tables.delete(table);
        /*
          A dropped table takes its policies and grants with it, and the model
          has to as well. 055 removes training_goals and training_goal_progress
          on purpose; without this the policies 033 and 038 created stayed in
          the expected state forever, and the checker reported them missing
          from a database that is correct — two false alarms on its first real
          run, pointing at the one thing that had been deliberately cleaned up.
        */
        for (const key of [...policies]) {
          if (key.startsWith(`${table}${KEY_SEP}`)) policies.delete(key);
        }
        for (const key of [...tableGrants.keys()]) {
          if (key.startsWith(`${table}${KEY_SEP}`)) tableGrants.delete(key);
        }
        continue;
      }

      // GRANT/REVOKE ... ON [FUNCTION] name ... TO/FROM role, role
      if ((m = /^(GRANT|REVOKE)\s+(.+?)\s+ON\s+(FUNCTION\s+)?(?:public\.)?([a-z_][a-z0-9_]*)/i.exec(s))) {
        const granting = m[1].toUpperCase() === "GRANT";
        const privileges = m[2].toUpperCase();
        const isFunction = !!m[3];
        const object = m[4].toLowerCase();
        const rolesPart = s.slice(s.search(granting ? /\bTO\b/i : /\bFROM\b/i));
        const target = isFunction ? functionGrants : tableGrants;
        const relevant = isFunction
          ? /\bEXECUTE\b|\bALL\b/.test(privileges)
          : /\bSELECT\b|\bALL\b/.test(privileges);
        if (!relevant) continue;
        for (const role of ROLES) {
          if (new RegExp(`\\b${role}\\b`, "i").test(rolesPart)) {
            target.set(grantKey(object, role), granting);
          }
        }
        // A revoke naming PUBLIC does NOT remove the by-name grant to anon —
        // the defect found three times here. So PUBLIC is deliberately not
        // treated as covering the named roles.
        continue;
      }
    }
  }

  return { views, tables, policies, dropped, tableGrants, functionGrants };
}

export function readMigrations(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
}

/** Turn the live snapshot's JSON into the same shape as expectedState. */
export function liveState(snapshot) {
  const key = (a, b) => `${a}${KEY_SEP}${b}`;
  return {
    views: new Set((snapshot.views ?? []).map((v) => v.toLowerCase())),
    // The RLS list enumerates every base table in the public schema, which is
    // also the answer to "does this table exist".
    tables: new Set((snapshot.rls ?? []).map((r) => r.table.toLowerCase())),
    policies: new Set((snapshot.policies ?? []).map((p) => key(p.table.toLowerCase(), p.name))),
    tableGrants: new Map(
      (snapshot.table_grants ?? []).map((g) => [key(g.object.toLowerCase(), g.role), g.can_select])
    ),
    functionGrants: new Map(
      (snapshot.function_grants ?? []).map((g) => [
        key(g.function.toLowerCase(), g.role),
        g.can_execute,
      ])
    ),
  };
}

/**
 * The differences that matter, most dangerous first.
 *
 * Only objects the migrations know about are compared. A view or function that
 * exists in the database and in no migration is reported separately rather
 * than as drift — it is usually a Supabase-managed object, and treating every
 * one as a failure is how a check like this gets switched off.
 */
export function compare(expected, live) {
  const findings = [];
  const split = (k) => k.split(KEY_SEP);

  for (const [k, canSelect] of expected.tableGrants) {
    const [object, role] = split(k);
    // Only objects the database also has. A relation the migrations create and
    // the database lacks is reported once, as a missing view, rather than
    // again for each role.
    if (!live.tableGrants.has(k)) continue;
    if (live.tableGrants.get(k) === canSelect) continue;
    findings.push({
      severity: live.tableGrants.get(k) ? "exposed" : "broken",
      what: live.tableGrants.get(k)
        ? `${role} can SELECT ${object} and should not`
        : `${role} cannot SELECT ${object} and should be able to`,
    });
  }

  for (const [k, canExecute] of expected.functionGrants) {
    const [fn, role] = split(k);
    if (!live.functionGrants.has(k)) continue;
    if (live.functionGrants.get(k) === canExecute) continue;
    findings.push({
      severity: live.functionGrants.get(k) ? "exposed" : "broken",
      what: live.functionGrants.get(k)
        ? `${role} can EXECUTE ${fn}() and should not`
        : `${role} cannot EXECUTE ${fn}() and should be able to`,
    });
  }

  /*
    Tables before policies, and policies on a missing table are not reported.

    The first real run said five policies were missing and left it to a person
    to notice that all five sat on tables that do not exist — five symptoms of
    one cause, with the cause itself absent from the list. Naming the table
    once is the finding; repeating it per policy is noise that buries the
    other rows.
  */
  const missingTables = new Set();
  for (const table of expected.tables ?? []) {
    if (live.tables && !live.tables.has(table)) {
      missingTables.add(table);
      findings.push({ severity: "broken", what: `table ${table} is missing` });
    }
  }

  for (const k of expected.policies) {
    const [table, name] = split(k);
    if (missingTables.has(table)) continue;
    if (!live.policies.has(k)) {
      findings.push({ severity: "broken", what: `policy "${name}" on ${table} is missing` });
    }
  }
  for (const k of live.policies) {
    const [table, name] = split(k);
    if (!expected.policies.has(k)) {
      /*
        TWO REASONS, AND THEY ARE NOT THE SAME PROBLEM.

        A migration explicitly DROPPED it and it is still there: that is a fix
        that did not land, and it is exactly 056 — the policy letting anyone
        read every column of profiles, removed in the repository and never in
        the database. Exposed.

        No migration mentions it at all: on the first real run these were
        "Users can view their own race predictions" and friends, owner-scoped
        policies on tables made through the dashboard. Calling those an
        exposure is a false alarm, and a checker that cries wolf on its first
        run does not get run twice. Still reported, because a policy nobody can
        review is how a permissive one arrives unnoticed — but with a different
        word, sorted last.
      */
      const wasDropped = expected.dropped?.has(k);
      findings.push({
        severity: wasDropped ? "exposed" : "unmanaged",
        what: wasDropped
          ? `policy "${name}" on ${table} was dropped by a migration and is still live`
          : `policy "${name}" on ${table} exists and no migration creates it`,
      });
    }
  }

  for (const view of expected.views) {
    if (!live.views.has(view)) {
      findings.push({ severity: "broken", what: `view ${view} is missing` });
    }
  }

  const order = { exposed: 0, broken: 1, unmanaged: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity] || a.what.localeCompare(b.what));
}

async function fetchSnapshot() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (they are in .env.local)."
    );
  }
  const res = await fetch(`${url}/rest/v1/rpc/schema_snapshot`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      res.status === 404
        ? "schema_snapshot() is not in the database — apply migration 074 first."
        : `schema_snapshot() failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return res.json();
}

/**
 * Load .env.local without a dependency, so the script runs from a clean
 * checkout.
 *
 * Walks up rather than looking only at the project root, because this
 * repository is worked in git worktrees under .claude/worktrees/, and a
 * worktree has no .env.local of its own — the secrets live once, in the main
 * checkout, which is where they should stay.
 */
function findEnvLocal() {
  let dir = ROOT;
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, ".env.local");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function loadEnvLocal() {
  const file = findEnvLocal();
  if (!file) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
}

async function main() {
  const expected = expectedState(readMigrations());

  if (process.argv.includes("--expected")) {
    console.log(
      JSON.stringify(
        {
          views: [...expected.views].sort(),
          policies: [...expected.policies].map((k) => k.split(KEY_SEP)).sort(),
        },
        null,
        2
      )
    );
    return 0;
  }

  loadEnvLocal();
  const snapshot = await fetchSnapshot();
  const findings = compare(expected, liveState(snapshot));

  if (findings.length === 0) {
    console.log("Schema matches the migrations: views, policies and anon/authenticated grants.");
    console.log("(Column definitions, constraints, indexes and triggers are not modelled.)");
    return 0;
  }

  console.error(`\n${findings.length} difference(s) between the migrations and the database:\n`);
  for (const f of findings) {
    console.error(`  [${f.severity}] ${f.what}`);
  }
  console.error(
    "\n'exposed'   the database is more permissive than the migrations say.\n" +
      "'broken'    something the application expects is not there.\n" +
      "'unmanaged' exists in the database and in no migration — not necessarily\n" +
      "            wrong, but not reproducible from this repository either.\n"
  );
  return 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error(`Could not check: ${err.message}`);
      process.exit(2);
    });
}
