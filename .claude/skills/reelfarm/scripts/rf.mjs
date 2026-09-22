#!/usr/bin/env node
/**
 * ReelFarm API CLI — Split Index marketing.
 *
 * Thin wrapper over https://reel.farm/api/v1. No dependencies; Node 18+ (built-in fetch).
 *
 * Safety posture, deliberate:
 *  - the API key is read from the environment and never printed, logged or written to disk
 *  - generation defaults to draft_only, publishing defaults to MEDIA_UPLOAD (TikTok draft)
 *  - DIRECT_POST requires --confirm-live, because it puts content on a real account
 *  - requests are self-throttled to stay inside 20 req / 60s
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = resolve(HERE, "..");
const HOOKS_PATH = join(SKILL_DIR, "hooks", "split-index-hooks.json");

const BASE = process.env.REELFARM_API_BASE ?? "https://reel.farm/api/v1";
const KEY = process.env.REELFARM_API_KEY;

/** 20 req / 60s sliding window => ~3s. 3.2s leaves headroom for clock skew. */
const MIN_INTERVAL_MS = 3200;
let lastRequestAt = 0;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function die(message, code = 1) {
  console.error(message);
  process.exit(code);
}

function requireKey() {
  if (!KEY) {
    die(
      [
        "REELFARM_API_KEY is not set.",
        "",
        "Get a key: ReelFarm dashboard -> click your email (bottom of sidebar) -> Settings",
        "-> API Keys -> generate. Keys start with rf_. API access needs the Growth plan or above.",
        "",
        "Then, in your own shell (not through this tool):",
        "  export REELFARM_API_KEY=rf_...",
      ].join("\n"),
    );
  }
  if (!KEY.startsWith("rf_")) {
    die("REELFARM_API_KEY does not look like a ReelFarm key (expected an rf_ prefix).");
  }
}

async function throttle() {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function req(method, path, { query, body } = {}) {
  requireKey();
  await throttle();

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let parsed;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    // Never include the request headers in this message — they carry the key.
    const detail = typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
    if (res.status === 401 || res.status === 403) {
      die(`${method} ${path} -> ${res.status}. Key rejected, or your plan lacks API access (Growth+).\n${detail}`);
    }
    if (res.status === 429) {
      // ReelFarm returns 429 for two unrelated limits. Request rate clears on
      // its own in a minute; the concurrent-slideshow cap clears only when a
      // generation finishes, which can be many minutes and is not helped by
      // waiting a fixed 60s. Telling the caller to wait 60s for the second
      // kind sends them back into the same wall.
      const code = typeof parsed === "object" && parsed ? parsed.code : null;
      if (code === "CONCURRENT_LIMIT") {
        die(
          [
            `${method} ${path} -> 429 concurrent limit (not request rate).`,
            "Generations already in flight must finish first — waiting 60s will not clear it.",
            "",
            // `rf.mjs videos` cannot show these. A slideshow only becomes a
            // video record once rendering completes, so one still in
            // `generating` or `rendering` has no video row to list, and the API
            // has no list-slideshows endpoint at all — only
            // GET /slideshows/{id}/status, which needs an id you do not have
            // unless you started it yourself. The dashboard is the only place
            // the in-flight set is visible.
            "`rf.mjs videos` will show nothing: in-flight slideshows have no video",
            "record yet, and the API has no endpoint that lists them. Check the",
            "ReelFarm dashboard to see what is running.",
            detail,
          ].join("\n"),
        );
      }
      die(`${method} ${path} -> 429 rate limited. Wait 60s. Do not parallelise.\n${detail}`);
    }
    die(`${method} ${path} -> ${res.status}\n${detail}`);
  }
  return parsed;
}

const out = (v) => console.log(typeof v === "string" ? v : JSON.stringify(v, null, 2));

// ---------------------------------------------------------------- hook library

function loadHooks() {
  try {
    return JSON.parse(readFileSync(HOOKS_PATH, "utf8"));
  } catch (err) {
    die(`Could not read the hook library at ${HOOKS_PATH}: ${err.message}`);
  }
}

function selectHooks(flags) {
  const { hooks } = loadHooks();
  let selected = hooks;
  if (flags.batch) selected = selected.filter((h) => h.batch === flags.batch);
  if (flags.cold) selected = selected.filter((h) => h.cold_reach === true);
  if (flags.asset) {
    const wanted = new Set(String(flags.asset).split(","));
    selected = selected.filter((h) => wanted.has(h.asset_status));
  }
  if (flags["hook-id"]) {
    const wanted = new Set(String(flags["hook-id"]).split(","));
    selected = selected.filter((h) => wanted.has(h.id));
  }
  if (selected.length === 0) die("No hooks matched that filter.");
  return selected;
}

/** The array shape ReelFarm wants for slideshow_hooks[]. */
const hookStrings = (selected, field) => selected.map((h) => h[field] ?? h.hook);

// ------------------------------------------------------------------- matching

const normalise = (s) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Best-effort join from a rendered video back to a library hook. A hook edited inside the
 * ReelFarm dashboard will not match — those come back as null and must be reported as
 * unmatched rather than dropped.
 */
function matchHook(haystackParts, hooks) {
  const hay = normalise(haystackParts.filter(Boolean).join(" "));
  if (!hay) return null;
  let best = null;
  for (const h of hooks) {
    for (const candidate of [h.short, h.hook]) {
      const needle = normalise(candidate);
      if (!needle) continue;
      // Compare on a distinctive leading fragment; full lines get truncated on-screen.
      const fragment = needle.split(" ").slice(0, 7).join(" ");
      if (fragment.length >= 12 && hay.includes(fragment)) {
        if (!best || fragment.length > best.length) best = { id: h.id, length: fragment.length };
      }
    }
  }
  return best?.id ?? null;
}

// Exported so the matching logic can be exercised without hitting the API.
export { matchHook, normalise, loadHooks };

// -------------------------------------------------------------------- commands

async function cmdAccount() {
  out(await req("GET", "/account"));
}

async function cmdAccounts() {
  out(await req("GET", "/tiktok/accounts"));
}

async function cmdCollections(id) {
  if (id) out(await req("GET", `/collections/${id}/images`, { query: { limit: 50 } }));
  else out(await req("GET", "/collections"));
}

async function cmdPinterest(q) {
  if (!q) die('Usage: rf.mjs pinterest "<query>"');
  out(await req("GET", "/pinterest/search", { query: { q } }));
}

function cmdHooks(flags) {
  const selected = selectHooks(flags);
  const field = flags.field ?? "hook";
  if (flags.json) return out(hookStrings(selected, field));
  // Paste-ready for the ReelFarm dashboard when the account has no API access.
  if (flags.plain) return console.log(hookStrings(selected, field).join("\n"));
  for (const h of selected) {
    console.log(`\n${h.id}  [${h.batch}${h.cold_reach ? "" : " · retarget only"}]`);
    console.log(`  ${h[field] ?? h.hook}`);
    console.log(`  frame : ${h.frame}`);
    console.log(`  shot  : [${h.asset_status}] ${h.asset ?? `stock — "${h.image_query}"`}`);
    if (h.asset_note) console.log(`  note  : ${h.asset_note}`);
    console.log(`  beat  : ${h.next_beat}`);
  }
  const byStatus = selected.reduce((acc, h) => {
    acc[h.asset_status] = (acc[h.asset_status] ?? 0) + 1;
    return acc;
  }, {});
  const tally = Object.entries(byStatus)
    .map(([k, v]) => `${v} ${k}`)
    .join(" · ");
  console.log(`\n${selected.length} hook(s) — ${tally}.`);
}

const CRON_DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Plain-English cron, for the live-post confirmation only. Handles the shape
 * these templates use (fixed minute, fixed hour, weekday) and falls back to
 * the raw expression rather than guessing at anything more elaborate — a
 * confirmation prompt that describes the schedule wrongly is worse than one
 * that shows the cron.
 */
function describeSchedule(schedule) {
  const crons = (schedule ?? []).map((s) => s?.cron).filter(Boolean);
  if (crons.length === 0) return "run (no schedule set — manual runs only)";
  return crons
    .map((cron) => {
      const [min, hour, dom, mon, dow] = String(cron).split(/\s+/);
      if (dom !== "*" || mon !== "*" || !/^\d+$/.test(dow ?? "") || !/^\d+$/.test(hour ?? "") || !/^\d+$/.test(min ?? "")) {
        return `run on cron "${cron}"`;
      }
      // ReelFarm's cron is Pacific; saying so avoids a schedule that looks
      // like a UK morning slot and is actually an evening one.
      return `${CRON_DAYS[Number(dow) % 7]} at ${hour.padStart(2, "0")}:${min.padStart(2, "0")} Pacific`;
    })
    .join(", and every ");
}

async function cmdAutomationCreate(payloadPath, flags = {}) {
  if (!payloadPath) die("Usage: rf.mjs automation:create <payload.json> [--confirm-live]");
  let payload;
  try {
    payload = JSON.parse(readFileSync(resolve(payloadPath), "utf8"));
  } catch (err) {
    die(`Could not read payload: ${err.message}`);
  }
  // Every placeholder in the payload, not just the account id. The original
  // check knew about one field, so a template with real credentials and
  // `user_collection_<STOCK>` still standing passed it — the API accepts those
  // ids and the automation generates without the images it was designed
  // around. Same shape of failure as a wrong account id: accepted, silent,
  // and only visible in the output days later.
  const placeholders = [];
  (function scan(node, path) {
    if (typeof node === "string") {
      if (/<[A-Za-z_ .:-]+>/.test(node)) placeholders.push(`${path} = ${JSON.stringify(node)}`);
    } else if (Array.isArray(node)) {
      node.forEach((v, i) => scan(v, `${path}[${i}]`));
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) scan(v, path ? `${path}.${k}` : k);
    }
  })(payload, "");
  if (!payload.tiktok_account_id) die("payload.tiktok_account_id is missing.");
  if (placeholders.length > 0) {
    die(
      [
        "This payload still contains placeholders:",
        ...placeholders.map((p) => `  ${p}`),
        "",
        "Account id:  node .claude/skills/reelfarm/scripts/bind-account.mjs",
        "Collections: rf.mjs collections   (then paste the id into the template)",
      ].join("\n"),
    );
  }

  // DIRECT_POST puts a recurring public post on a real account with nobody in
  // the loop, so it needs the same explicit flag `publish` has always needed.
  // The header has documented --confirm-live for both since the file was
  // written; only `publish` ever implemented it, which left create with a
  // refusal and no way to honour the sign-off it asks for.
  const mode = payload.tiktok_post_settings?.post_mode;
  if (mode === "DIRECT_POST" && !flags["confirm-live"]) {
    die(
      [
        "This payload posts live (post_mode DIRECT_POST):",
        `  every ${describeSchedule(payload.schedule)}, published publicly, no review step.`,
        "",
        "Re-run with --confirm-live if that is intended, or set post_mode to",
        "MEDIA_UPLOAD to have each batch land as a TikTok draft instead.",
      ].join("\n"),
    );
  }
  out(await req("POST", "/automations", { body: payload }));
}

async function cmdAutomationList() {
  out(await req("GET", "/automations"));
}

async function cmdAutomationGet(id) {
  if (!id) die("Usage: rf.mjs automation:get <automation_id>");
  out(await req("GET", `/automations/${id}`));
}

/**
 * Delete automations, by explicit id only.
 *
 * There is no undo and no list-what-I-deleted afterwards, so this refuses two
 * things that a bulk cleanup gets wrong: it will not touch an automation whose
 * status is `active` without --include-active, and it will not accept a bare
 * "delete everything paused" — ids are always named on the command line. The
 * account reached 24 automations in an afternoon precisely because creating
 * them is cheap, and the cleanup that follows is where the live one gets
 * caught by accident.
 *
 * Each id is fetched before it is deleted so the title and status can be
 * printed. That read is the point: it is the last chance to notice that the id
 * in the list is not the automation you meant.
 */
async function cmdAutomationDelete(ids, flags) {
  if (!ids || ids.length === 0) {
    die("Usage: rf.mjs automation:delete <automation_id> [<id>...] [--include-active] [--dry-run]");
  }

  const targets = [];
  for (const id of ids) {
    const a = await req("GET", `/automations/${id}`);
    targets.push({ id, title: a?.title ?? "(no title)", status: a?.status ?? "unknown" });
  }

  const live = targets.filter((t) => t.status === "active");
  if (live.length > 0 && !flags["include-active"]) {
    die(
      [
        "Refusing — these are ACTIVE and would stop posting:",
        ...live.map((t) => `  ${t.id}  ${t.title}`),
        "",
        "Pause them first, or pass --include-active if that is genuinely intended.",
      ].join("\n"),
    );
  }

  for (const t of targets) {
    if (flags["dry-run"]) {
      console.log(`would delete  ${t.id}  [${t.status}]  ${t.title}`);
      continue;
    }
    await req("DELETE", `/automations/${t.id}`);
    console.log(`deleted  ${t.id}  [${t.status}]  ${t.title}`);
  }
  if (flags["dry-run"]) console.log(`\n${targets.length} would be deleted. Re-run without --dry-run.`);
}

async function cmdAutomationHooks(id, flags) {
  if (!id) die("Usage: rf.mjs automation:hooks <automation_id> [--batch gym] [--cold] [--field short]");
  const selected = selectHooks(flags);
  const slideshow_hooks = hookStrings(selected, flags.field ?? "hook");
  console.error(`Pushing ${slideshow_hooks.length} hook(s): ${selected.map((h) => h.id).join(", ")}`);
  out(await req("PATCH", `/automations/${id}`, { body: { slideshow_hooks } }));
}

async function cmdAutomationRun(id, flags) {
  if (!id) die("Usage: rf.mjs automation:run <automation_id> [--hook-id gym-15 | --hook \"...\"] [--mode export]");
  const body = {};
  if (flags["hook-id"]) {
    const [h] = selectHooks({ "hook-id": flags["hook-id"] });
    body.hook = flags.field === "short" ? h.short : h.hook;
  } else if (flags.hook) {
    body.hook = flags.hook;
  }
  body.mode = flags.mode ?? "draft_only";
  if (body.mode !== "draft_only" && body.mode !== "export") {
    die('--mode must be "draft_only" or "export".');
  }
  out(await req("POST", `/automations/${id}/run`, { body }));
}

async function cmdVideos(flags) {
  out(
    await req("GET", "/videos", {
      query: {
        automation_id: flags["automation-id"],
        video_type: flags.type,
        status: flags.status,
        created_after: flags["created-after"],
        limit: flags.limit ?? 20,
        offset: flags.offset,
      },
    }),
  );
}

async function cmdVideo(id) {
  if (!id) die("Usage: rf.mjs video <video_id>");
  out(await req("GET", `/videos/${id}`));
}

async function cmdAnalytics(id) {
  if (!id) die("Usage: rf.mjs analytics <video_id>");
  out(await req("GET", `/videos/${id}/analytics`));
}

async function cmdReport(flags) {
  const { hooks } = loadHooks();
  const limit = Number(flags.limit ?? 30);
  const list = await req("GET", "/videos", {
    query: { status: "completed", limit, automation_id: flags["automation-id"] },
  });
  const videos = list?.videos ?? [];
  if (videos.length === 0) return out("No completed videos returned.");

  console.error(`Fetching analytics for ${videos.length} video(s) — throttled, ~${Math.ceil((videos.length * MIN_INTERVAL_MS) / 1000)}s.`);

  const rows = [];
  for (const v of videos) {
    const id = v.id ?? v.video_id;
    let stats = null;
    if (id !== undefined) {
      try {
        stats = await req("GET", `/videos/${id}/analytics`);
      } catch {
        stats = null; // not published yet, or no post — reported as such below
      }
    }
    const hookId = matchHook([v.prompt, stats?.title, stats?.caption], hooks);
    const views = stats?.view_count ?? 0;
    const engagements =
      (stats?.like_count ?? 0) +
      (stats?.comment_count ?? 0) +
      (stats?.share_count ?? 0) +
      (stats?.bookmark_count ?? 0);
    rows.push({
      video_id: id ?? null,
      hook_id: hookId ?? "unmatched",
      published: Boolean(stats?.published_at),
      views,
      engagements,
      engagement_rate: views > 0 ? Number(((engagements / views) * 100).toFixed(2)) : null,
      published_at: stats?.published_at ?? null,
    });
  }

  const ranked = rows
    .filter((r) => r.published)
    .sort((a, b) => (b.engagement_rate ?? -1) - (a.engagement_rate ?? -1));
  const pending = rows.filter((r) => !r.published);
  const unmatched = rows.filter((r) => r.hook_id === "unmatched").length;

  console.log("\nhook_id        views    engs   eng%   video");
  console.log("-".repeat(52));
  for (const r of ranked) {
    console.log(
      `${String(r.hook_id).padEnd(14)}${String(r.views).padStart(6)}${String(r.engagements).padStart(8)}${String(r.engagement_rate ?? "-").padStart(7)}   ${r.video_id}`,
    );
  }
  console.log(
    `\n${ranked.length} published · ${pending.length} not yet published · ${unmatched} could not be matched to a library hook.`,
  );
  console.log(
    "Ranked by engagement rate, not views. This data shows reach and engagement only —\nthe API exposes no watch-time or completion, so it cannot tell you what retained.",
  );
}

async function cmdPublish(videoId, accountId, flags) {
  if (!videoId || !accountId) {
    die('Usage: rf.mjs publish <video_id> <tiktok_account_id> [--caption "..."] [--confirm-live]');
  }
  const live = Boolean(flags["confirm-live"]);
  const post_mode = live ? "DIRECT_POST" : "MEDIA_UPLOAD";
  if (flags.caption && flags.caption.length > 89) {
    die(`Caption is ${flags.caption.length} chars; slideshow captions cap at 89.`);
  }
  if (live) {
    console.error("!! DIRECT_POST — this publishes to the live TikTok account now.");
    console.error("!! Only proceed if the user approved this specific batch.");
  } else {
    console.error("Publishing as MEDIA_UPLOAD (lands as a TikTok draft for review).");
  }
  out(
    await req("POST", "/tiktok/publish", {
      body: {
        video_id: videoId,
        tiktok_account_id: accountId,
        upload_type: flags["upload-type"] ?? "slides",
        post_mode,
        ...(flags.caption ? { caption: flags.caption } : {}),
        ...(flags.description ? { description: flags.description } : {}),
      },
    }),
  );
}

// ----------------------------------------------------------------------- args

function parse(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else positional.push(arg);
  }
  return { positional, flags };
}

const USAGE = `ReelFarm CLI — Split Index

  account                                  tier + credits (run this first)
  accounts                                 connected TikTok accounts
  collections [id]                         image collections, or images within one
  pinterest "<query>"                      stock image URLs

  hooks [--batch gym|hybrid] [--cold]      print the local hook library (no API key needed)
        [--field short] [--json|--plain]   --json = slideshow_hooks[]; --plain = paste into dashboard
        [--asset confirmed|needs_capture]  filter by shot status — needs_capture is your shot list
        [--asset blocked|stock]

  automation:create <payload.json> [--confirm-live]
                                           --confirm-live is required when the
                                           payload's post_mode is DIRECT_POST
  automation:list
  automation:get <id>
  automation:delete <id> [<id>...] [--dry-run] [--include-active]
  automation:hooks <id> [--batch gym]      PATCH slideshow_hooks from the library
  automation:run <id> [--hook-id gym-15]   one-off generation (--mode draft_only default)

  videos [--status completed] [--limit 20] [--automation-id <id>]
  video <video_id>
  analytics <video_id>
  report [--limit 30] [--automation-id <id>]

  publish <video_id> <tiktok_account_id> [--caption "..."] [--confirm-live]

Draft-first by default. --confirm-live posts to a real account and needs the user's
explicit approval for that specific batch.`;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parse(rest);

  switch (command) {
    case "account": return cmdAccount();
    case "accounts": return cmdAccounts();
    case "collections": return cmdCollections(positional[0]);
    case "pinterest": return cmdPinterest(positional[0]);
    case "hooks": return cmdHooks(flags);
    case "automation:create": return cmdAutomationCreate(positional[0], flags);
    case "automation:list": return cmdAutomationList();
    case "automation:get": return cmdAutomationGet(positional[0]);
    case "automation:delete": return cmdAutomationDelete(positional, flags);
    case "automation:hooks": return cmdAutomationHooks(positional[0], flags);
    case "automation:run": return cmdAutomationRun(positional[0], flags);
    case "videos": return cmdVideos(flags);
    case "video": return cmdVideo(positional[0]);
    case "analytics": return cmdAnalytics(positional[0]);
    case "report": return cmdReport(flags);
    case "publish": return cmdPublish(positional[0], positional[1], flags);
    case undefined:
    case "help":
    case "--help":
      return out(USAGE);
    default:
      die(`Unknown command: ${command}\n\n${USAGE}`);
  }
}

// Only run the CLI when executed directly — importing this file (e.g. to test the
// matching logic) must not fire a command.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => die(err?.stack ?? String(err)));
}
