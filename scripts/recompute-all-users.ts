/**
 * ONE-OFF BULK RECOMPUTE — re-score every athlete with the current engine.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Scores are computed once at log time and persisted, so a calibration change
 * never reaches historical rows on its own. `POST /api/activities/recompute`
 * fixes that for ONE athlete — the signed-in one — and there is no shape of
 * request that recomputes anybody else, which is correct for a route.
 *
 * But some changes are not per-athlete. The exercise leaderboard and the
 * global rank percentile compare athletes to each other, so while some are on
 * the old rules and some on the new, EVERY athlete's standing is wrong,
 * including the ones already rebuilt. That is what this script is for.
 *
 * It calls `recomputeUser` — the exact function the route calls. There is no
 * second implementation to drift.
 *
 * ---------------------------------------------------------------------------
 * BEFORE YOU RUN IT
 * ---------------------------------------------------------------------------
 * 1. Apply any pending migrations.
 * 2. Run supabase/backfills/2026-09-05_clear_stale_exercise_weight_modes.sql.
 *    ORDER MATTERS: recompute reads `weightModes[name] ?? default`, so a stale
 *    stored mode still WINS. Recomputing first rebuilds the wrong number and
 *    you have to run the whole thing twice.
 * 3. Read the DRY RUN below before doing anything irreversible.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   npx tsx scripts/recompute-all-users.ts                 # dry run, default
 *   npx tsx scripts/recompute-all-users.ts --apply         # actually write
 *   npx tsx scripts/recompute-all-users.ts --apply --user <uuid>   # just one
 *   npx tsx scripts/recompute-all-users.ts --apply --limit 10      # first N
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, read from
 * .env.local. The service-role key bypasses row-level security — that is the
 * whole reason this can touch other people's rows, and the reason it is a
 * hand-run script and not an endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REWRITES, PER ATHLETE
 * ---------------------------------------------------------------------------
 * workout_scores, split_index_history, strength_scores, predicted_benchmarks
 * and personal_records. Personal records are DELETED and re-inserted, not
 * upserted — they are high-water marks, so an inflated old PR would never be
 * beaten by a correctly-scored session and would survive forever otherwise.
 *
 * It does NOT touch the activities themselves. Distances, durations, routes
 * and set data are the athlete's record of what they did; only what the engine
 * derived from them is rebuilt.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { recomputeUser, RecomputeError } from "../src/lib/activities/recompute-user";

/**
 * Read .env.local directly rather than pulling in dotenv. This is a one-off
 * script and the file is two keys deep; a dependency added for it would
 * outlive the reason for it.
 */
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return; // fall through to whatever is already in process.env
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) {
      process.env[k] = v.replace(/^["']|["']$/g, "");
    }
  }
}

loadEnvLocal();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const ONE_USER = args[args.indexOf("--user") + 1];
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : undefined;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Both live in .env.local. The service-role key is the one that bypasses RLS —\n" +
      "if you are about to paste it somewhere, do not."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function fmt(ms: number): string {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

async function main() {
  const started = Date.now();

  let q = supabase
    .from("profiles")
    .select("user_id, username")
    .order("created_at", { ascending: true });
  if (ONE_USER && !ONE_USER.startsWith("--")) q = q.eq("user_id", ONE_USER);
  if (LIMIT) q = q.limit(LIMIT);

  const { data: profiles, error } = await q;
  if (error) {
    console.error("Could not read profiles:", error.message);
    process.exit(1);
  }
  if (!profiles?.length) {
    console.log("No profiles matched. Nothing to do.");
    return;
  }

  // Count the work before doing any of it, so the dry run is informative
  // rather than just a promise that something will happen.
  const { count: activityCount } = await supabase
    .from("activities")
    .select("id", { count: "exact", head: true })
    .eq("is_draft", false)
    .in(
      "user_id",
      profiles.map((p) => p.user_id)
    );

  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} — ${profiles.length} athlete(s), ` +
      `${activityCount ?? "?"} non-draft activities.`
  );

  if (!APPLY) {
    console.log(
      "\nNothing has been written. This would delete and rebuild workout_scores,\n" +
        "split_index_history, strength_scores, predicted_benchmarks and\n" +
        "personal_records for every athlete listed above.\n\n" +
        "Re-run with --apply once you have run the exercise_weight_modes backfill.\n" +
        "Try --limit 1 first and check that athlete in the app before doing the rest."
    );
    return;
  }

  let ok = 0;
  const failed: Array<{ user: string; reason: string }> = [];

  for (const [i, p] of profiles.entries()) {
    const label = p.username || p.user_id.slice(0, 8);
    process.stdout.write(`[${i + 1}/${profiles.length}] ${label} ... `);
    try {
      const r = await recomputeUser(supabase, p.user_id);
      ok++;
      console.log(
        `${r.recomputed}/${r.total} rebuilt` +
          (r.failed ? `, ${r.failed} activity failure(s)` : "") +
          // Printed alongside the tally rather than folded into it, because
          // `recomputed` can read total-of-total while the athlete's whole PR
          // list failed to come back — the count is per activity, this is not.
          (r.rebuildFailures.length ? `, ${r.rebuildFailures.length} rebuild failure(s)` : "")
      );
      // Per-activity failures are reported but do not stop the run: one
      // athlete with one unscoreable session should not leave everyone after
      // them on the old ruler, which is the state this script exists to end.
      if (r.failed) console.log(`    ${JSON.stringify(r.failures).slice(0, 300)}`);
      for (const f of r.rebuildFailures) console.log(`    ${f}`);
    } catch (err) {
      const reason = err instanceof RecomputeError ? err.message : String(err);
      failed.push({ user: label, reason });
      console.log(`FAILED — ${reason}`);
    }
  }

  console.log(
    `\nDone in ${fmt(Date.now() - started)}. ${ok} rebuilt, ${failed.length} failed.`
  );
  if (failed.length) {
    console.log("Failures:");
    for (const f of failed) console.log(`  ${f.user}: ${f.reason}`);
    console.log(
      "\nRe-run just those with --user <uuid>. Their OLD scores are gone either\n" +
        "way — recompute deletes before it rebuilds — so a failure leaves that\n" +
        "athlete with missing scores, not stale ones."
    );
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
