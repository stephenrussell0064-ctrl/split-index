/**
 * ONE-OFF BACKFILL — apply the route privacy zone to routes ALREADY STORED.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * POST /api/activities has trimmed the first and last 200m off every GPS route
 * before writing it since applyRoutePrivacyZone shipped. Routes saved BEFORE
 * that are still sitting in activities.metadata->'route' with the athlete's
 * doorstep as their first and last coordinate, and row-level security hands an
 * accepted friend every column of a visible row — so a friend with the public
 * anon key can read those polylines directly, with no app screen involved.
 * Routes have been stored since 2026-08-09. This closes that back-catalogue.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS AND NOT THE .sql FILE NEXT TO IT
 * ---------------------------------------------------------------------------
 * supabase/backfills/2026-08-19_truncate_stored_route_privacy_zone.sql does the
 * same job as a plpgsql transliteration of applyRoutePrivacyZone — and says of
 * itself that it "has never been executed against a database". A hand-ported
 * copy of a geometry routine is exactly the kind of thing that is subtly wrong
 * in a way a row count will not show, and the cost of being wrong here is
 * unrecoverable: the trimmed ends are gone.
 *
 * This script calls the REAL function, the one covered by
 * src/lib/scoring/gps-track.test.ts and the one the API itself calls. There is
 * no second implementation to disagree with. Stored routes are already rounded
 * to ROUTE_CONFIG.COORDINATE_DECIMALS at write time and the trim rounds its
 * interpolated cuts the same way, so a row rewritten here is byte-for-byte what
 * the API would produce for the same track today.
 *
 * The .sql file is kept for the record. Do not run both.
 *
 * ---------------------------------------------------------------------------
 * IT IS ONE-WAY
 * ---------------------------------------------------------------------------
 * The trimmed-off ends are gone. Nothing is stashed anywhere on purpose: a
 * backup table of untruncated routes is the same home addresses in the same
 * database, which is the problem rather than a safety net. If you want
 * reversibility, take a Supabase PITR restore point BEFORE running with
 * --apply, and understand the snapshot then holds the coordinates.
 *
 * Afterwards athletes see the truncated route on their OWN runs too. That is
 * the intended, Strava-equivalent outcome: the data is gone, so there is no
 * owner-only view left to serve.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   npx tsx scripts/backfill-route-privacy-zone.ts            # dry run, default
 *   npx tsx scripts/backfill-route-privacy-zone.ts --apply    # actually rewrite
 *   npx tsx scripts/backfill-route-privacy-zone.ts --verbose  # per-row detail
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from .env.local.
 * The service-role key bypasses RLS — that is the only reason this can reach
 * other athletes' rows, and the reason it is a hand-run script and not a route.
 *
 * ---------------------------------------------------------------------------
 * SAFE TO RE-RUN
 * ---------------------------------------------------------------------------
 * Trimming is NOT idempotent — a second pass would shave another 200m off each
 * end of a route it already shortened. So every rewritten row is stamped with
 * `metadata.route_privacy_backfilled_at`, and stamped rows are skipped on any
 * later run. Nothing reads that key; nothing in the app enumerates metadata
 * keys, and the column is typed Record<string, unknown>. It exists so this
 * script can never eat a route twice.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT REWRITES
 * ---------------------------------------------------------------------------
 * activities.metadata, and within it only the 'route' key (plus the stamp).
 * bodyweight_kg, exercise_notes and exercise_weight_modes are carried through
 * by construction — the object is rebuilt from what was read, never replaced.
 *
 * NOT touched: distance_meters, elevation_meters, duration_seconds,
 * avg_pace_seconds_per_km, and every workout_scores / split_index_history row.
 * None is derived from the polyline — they were computed from the raw GPS track
 * at save time — so no athlete's distance, pace, elevation, score or Split
 * Index moves by a thousandth. This changes only what a map draws.
 */
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { applyRoutePrivacyZone, parseRoutePolyline } from "../src/lib/scoring/gps-track";

/** Read .env.local directly rather than adding dotenv for a one-off script. */
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(".env.local", "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const VERBOSE = args.includes("--verbose");

const STAMP_KEY = "route_privacy_backfilled_at";

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

/**
 * Great-circle distance between two stored route vertices, for reporting only.
 * Deliberately local: the trim itself uses gps-track's own haversine, and this
 * must not become a second opinion the rewrite depends on.
 */
function metersBetween(a: readonly [number, number], b: readonly [number, number]): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b[0] - a[0]) / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(rad(b[1] - a[1]) / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

type ActivityRow = {
  id: string;
  user_id: string;
  sport: string;
  started_at: string;
  metadata: Record<string, unknown> | null;
};

async function main() {
  const { data, error } = await supabase
    .from("activities")
    .select("id, user_id, sport, started_at, metadata")
    .not("metadata->route", "is", null)
    .order("started_at", { ascending: true });

  if (error) {
    console.error("Could not read activities:", error.message);
    process.exit(1);
  }

  const rows = (data ?? []) as ActivityRow[];
  if (rows.length === 0) {
    console.log("No stored routes found. Nothing to do.");
    return;
  }

  const alreadyDone = rows.filter((r) => r.metadata?.[STAMP_KEY] != null);
  const todo = rows.filter((r) => r.metadata?.[STAMP_KEY] == null);

  let willTrim = 0;
  let willLose = 0;
  let unparseable = 0;
  const plans: { row: ActivityRow; next: Record<string, unknown>; note: string }[] = [];

  for (const row of todo) {
    const metadata = row.metadata ?? {};
    const parsed = parseRoutePolyline(metadata.route);

    // parseRoutePolyline returning null means the stored value was never a
    // usable polyline in the first place. Dropping the key is the honest
    // outcome — it can only be junk or a single pin, and a pin on a route leaks
    // more than no map at all.
    if (!parsed) {
      unparseable++;
      const next: Record<string, unknown> = {
        ...metadata,
        [STAMP_KEY]: new Date().toISOString(),
      };
      delete next.route;
      plans.push({ row, next, note: "unparseable route -> removed" });
      continue;
    }

    const trimmed = applyRoutePrivacyZone(parsed);
    const next: Record<string, unknown> = {
      ...metadata,
      [STAMP_KEY]: new Date().toISOString(),
    };

    if (trimmed === null) {
      willLose++;
      delete next.route;
      plans.push({
        row,
        next,
        note: `${parsed.length}pt run is inside its own 200m zone -> no map`,
      });
    } else {
      willTrim++;
      next.route = trimmed;
      // How far the drawn start and finish actually move. This is the number
      // worth reading before --apply: point counts prove the array changed,
      // displacement proves the doorstep is no longer on the map. Expect ~200m
      // at each end, less only where a route was already short of a full zone.
      const head = metersBetween(parsed[0], trimmed[0]);
      const tail = metersBetween(parsed[parsed.length - 1], trimmed[trimmed.length - 1]);
      plans.push({
        row,
        next,
        note:
          `${parsed.length}pt -> ${trimmed.length}pt, ` +
          `start +${head.toFixed(0)}m, finish +${tail.toFixed(0)}m`,
      });
    }
  }

  const owners = new Set(todo.map((r) => r.user_id));
  console.log(
    `${APPLY ? "APPLYING" : "DRY RUN"} — ${rows.length} stored route(s), ` +
      `${alreadyDone.length} already backfilled, ${todo.length} to process ` +
      `across ${owners.size} athlete(s).`
  );
  console.log(`  ${willTrim} keep a shorter line`);
  console.log(`  ${willLose} lose the map entirely (run shorter than its own 400m zone)`);
  if (unparseable > 0) console.log(`  ${unparseable} had an unusable stored route -> key removed`);
  if (todo.length > 0) {
    console.log(`  oldest ${todo[0].started_at}, newest ${todo[todo.length - 1].started_at}`);
  }

  if (VERBOSE) {
    console.log("");
    for (const p of plans) {
      console.log(`  ${p.row.started_at.slice(0, 10)} ${p.row.sport.padEnd(8)} ${p.row.id}  ${p.note}`);
    }
  }

  if (!APPLY) {
    console.log(
      "\nNothing has been written. This would rewrite activities.metadata->'route'\n" +
        "in place, irreversibly. Distances, paces, elevations and every score are\n" +
        "untouched — only the drawn line changes.\n\n" +
        "Take a Supabase PITR restore point first if you want any way back, then\n" +
        "re-run with --apply."
    );
    return;
  }

  let ok = 0;
  const failures: { id: string; message: string }[] = [];
  for (const p of plans) {
    // Written one row at a time, with the whole metadata object sent back. The
    // object was rebuilt from the row that was read, so every other key
    // survives; the cost is that a concurrent edit to the SAME activity's
    // metadata between the read above and this write would be lost. Routes are
    // written once at save time and this runs in seconds, so that window is
    // theoretical — but do not run this during a deploy or a bulk import.
    const { error: updateError } = await supabase
      .from("activities")
      .update({ metadata: p.next })
      .eq("id", p.row.id);

    if (updateError) failures.push({ id: p.row.id, message: updateError.message });
    else ok++;
  }

  console.log(`\nDone. ${ok} rewritten, ${failures.length} failed.`);
  for (const f of failures) console.error(`  ${f.id}: ${f.message}`);
  if (failures.length > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
