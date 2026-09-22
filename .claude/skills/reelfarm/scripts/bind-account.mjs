#!/usr/bin/env node
/**
 * Write the connected TikTok account id into the automation templates.
 *
 * Why this exists rather than "paste the id in": the id is a 36-character
 * opaque string with a leading hyphen, runs of zeros, and both `O` and `0`
 * in it (`-0009TcGXxVCm3Y_...`). Read off a screen and retyped it is a
 * coin-flip, and a wrong id does not fail loudly — `automation:create`
 * accepts it and the automation posts to nothing. So the id is never
 * handled by a human or by an agent reading a screenshot: it comes from
 * GET /accounts and goes straight into the file.
 *
 * Edits are a single-line substitution, not a JSON round-trip, so comments,
 * key order and whitespace in the templates survive untouched — these files
 * are hand-maintained and other sessions edit them concurrently.
 *
 * Usage, from the repo root:
 *   node .claude/skills/reelfarm/scripts/bind-account.mjs            # all templates
 *   node .claude/skills/reelfarm/scripts/bind-account.mjs --check    # report only
 *   node .claude/skills/reelfarm/scripts/bind-account.mjs --username split.index
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = resolve(HERE, "..", "templates");

const BASE = process.env.REELFARM_API_BASE ?? "https://reel.farm/api/v1";
const KEY = process.env.REELFARM_API_KEY;

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const wantUsername = (() => {
  const i = args.indexOf("--username");
  return i >= 0 ? args[i + 1] : null;
})();

function die(message) {
  console.error(message);
  process.exit(1);
}

/** The id sits on its own line in every template; match the value, keep the rest. */
const ID_LINE = /("tiktok_account_id"\s*:\s*)"([^"]*)"/;

async function fetchAccounts() {
  if (!KEY) {
    die(
      [
        "REELFARM_API_KEY is not set.",
        "",
        "In your own shell (not through Claude):",
        "  export REELFARM_API_KEY=rf_...",
      ].join("\n"),
    );
  }
  if (!KEY.startsWith("rf_")) die("REELFARM_API_KEY does not look like a ReelFarm key (expected rf_).");

  // /tiktok/accounts, not /accounts — the latter is not an API route at all,
  // so reel.farm serves its marketing site's 404 as HTML and the failure looks
  // like a bad key rather than a bad path. Keep this in step with rf.mjs.
  const res = await fetch(`${BASE}/tiktok/accounts`, { headers: { Authorization: `Bearer ${KEY}` } });
  const text = await res.text();
  if (!res.ok) {
    // Never echo request headers here — they carry the key.
    const body = text.trimStart().startsWith("<")
      ? "(HTML page, not an API response — check the path and REELFARM_API_BASE)"
      : text.slice(0, 500);
    die(`GET /tiktok/accounts failed (${res.status}).\n${body}`);
  }
  if (text.trimStart().startsWith("<")) {
    die("GET /tiktok/accounts returned HTML rather than JSON — check REELFARM_API_BASE.");
  }
  const accounts = JSON.parse(text).accounts ?? [];
  if (accounts.length === 0) die("No TikTok account is connected to this ReelFarm workspace.");
  return accounts;
}

function pickAccount(accounts) {
  if (wantUsername) {
    const hit = accounts.find((a) => a.account_username === wantUsername);
    if (!hit) {
      die(
        `No connected account with username "${wantUsername}". Connected: ` +
          accounts.map((a) => a.account_username).join(", "),
      );
    }
    return hit;
  }
  if (accounts.length > 1) {
    die(
      "More than one account is connected — say which with --username:\n" +
        accounts.map((a) => `  ${a.account_username}  (${a.account_name})`).join("\n"),
    );
  }
  return accounts[0];
}

const accounts = await fetchAccounts();
const account = pickAccount(accounts);

// The id itself is the thing being written, so printing it is the point —
// but it is an account handle, not a credential, unlike the key above.
console.log(`Account: ${account.account_username} (${account.account_name})`);

const templates = readdirSync(TEMPLATE_DIR)
  .filter((f) => f.startsWith("automation-") && f.endsWith(".json"))
  .sort();

let changed = 0;
for (const file of templates) {
  const path = join(TEMPLATE_DIR, file);
  const before = readFileSync(path, "utf8");
  const match = before.match(ID_LINE);

  if (!match) {
    console.log(`  ${file}: no tiktok_account_id field — skipped`);
    continue;
  }
  if (match[2] === account.tiktok_account_id) {
    console.log(`  ${file}: already bound`);
    continue;
  }
  if (checkOnly) {
    console.log(`  ${file}: would set (currently ${JSON.stringify(match[2])})`);
    continue;
  }

  // Replacer function, not a "$1" string: the id can contain `$`, which a
  // string replacement would read as a capture-group reference.
  writeFileSync(path, before.replace(ID_LINE, (_m, prefix) => `${prefix}"${account.tiktok_account_id}"`));
  console.log(`  ${file}: set`);
  changed += 1;
}

if (!checkOnly) console.log(`\n${changed} template${changed === 1 ? "" : "s"} updated.`);
