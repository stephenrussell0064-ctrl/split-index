/**
 * SEED A DEMO ATHLETE — for screenshots and marketing capture, not for tests.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 * Several product surfaces can only be photographed when the athlete is in a
 * particular state, and the founder's own account is not in any of them —
 * correctly, because they are all states you would rather not be in:
 *
 *   - Injury Risk / ACWR in the caution band. The live account reads 0.92,
 *     "Optimal". You cannot screenshot a warning you are not receiving, and
 *     faking one on a real account would put a false claim on camera.
 *   - A weak lift. The live diagnostic reads "none — your lifts are in
 *     proportion", so the panel that names a limiting lift has nothing to name.
 *   - A measurable interference finding. The radar needs MIN_PAIRED_SESSIONS
 *     (3) paired sessions plus rested baselines before it will say anything,
 *     and the live account has 2, so it correctly reports "no measurable
 *     interference".
 *
 * This seeds ONE clearly-labelled demo account that is in all three states at
 * once, so those screens can be captured honestly — a real athlete's real
 * data, just a fictional athlete's.
 *
 * The demo athlete is 45, which also makes the age-graded readout render
 * (ageFactor() is exactly 1.0 through 23-35 and the engine writes nothing at
 * all in that band, so the founder's own account may show no age line no
 * matter what).
 *
 * ---------------------------------------------------------------------------
 * BEFORE YOU RUN IT
 * ---------------------------------------------------------------------------
 * 1. This writes to whatever Supabase project .env.local points at. That is
 *    very likely PRODUCTION. The dry run prints the host — read it.
 * 2. It creates an auth user. Set DEMO_ACCOUNT_PASSWORD yourself; this script
 *    never generates, prints or logs a password.
 * 3. Everything it creates is namespaced by DEMO_EMAIL / DEMO_USERNAME below,
 *    so `--delete` can remove all of it again. Nothing else is touched.
 * 4. The demo account is a real row on your leaderboard. Either leave
 *    `leaderboard-visible` off (default: the profile is created private) or
 *    delete the account when the shoot is done.
 *
 * ---------------------------------------------------------------------------
 * USAGE
 * ---------------------------------------------------------------------------
 *   npx tsx scripts/seed-demo-athlete.ts              # dry run, default
 *   npx tsx scripts/seed-demo-athlete.ts --apply      # create and seed
 *   npx tsx scripts/seed-demo-athlete.ts --delete --apply   # remove it again
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and
 * DEMO_ACCOUNT_PASSWORD. The service-role key bypasses RLS — that is why this
 * is a hand-run script and not an endpoint.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT BUILDS, AND WHY EACH NUMBER IS WHAT IT IS
 * ---------------------------------------------------------------------------
 * 9 weeks ending today. Weeks 1-8 are a steady block; week 9 is a deliberate
 * spike, because ACWR compares the last 7 days against the rolling 4-week
 * average and only a spike puts it in the caution band.
 *
 * Weekly shape, chosen so the interference engine has something to measure:
 *   Mon  gym          (strength)
 *   Tue  run          paired: 1 day after strength
 *   Wed  rest
 *   Thu  rest
 *   Fri  run          rested baseline: 2 clear rest days before it
 *   Sat  gym
 *   Sun  rest
 *
 * The Tuesday runs carry the same pace at a higher heart rate than the Friday
 * runs. That is the interference signal, and it is put in deliberately: the
 * engine compares efficiency after strength against a rested baseline, so a
 * seed with identical runs on both days would (correctly) produce "no
 * measurable interference" and this script would have achieved nothing.
 *
 * Lift ratios are set so bench is the limiting lift: squat ~160kg, bench
 * ~95kg (0.59x squat against a typical 0.72x), deadlift ~200kg (1.25x, normal).
 * Bench also flatlines across the block so the stalled-lift finding fires.
 *
 * Scores are NOT written by hand. The script inserts activities and sets, then
 * calls `recomputeUser` — the same function the app and the bulk recompute
 * script call — so every index, 1RM, ACWR and finding is the real engine's
 * output on this data. If the engine disagrees with the intent described
 * above, the engine is right and these inputs need adjusting.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { recomputeUser, RecomputeError } from "../src/lib/activities/recompute-user";

/**
 * Repo root resolved from this file, not from process.cwd(). Reading
 * ".env.local" relative to the working directory means the script only works
 * when invoked from the repo root, and fails with a confusing "missing
 * SUPABASE_SERVICE_ROLE_KEY" from anywhere else — which is not the actual
 * problem and sends you looking in the wrong place.
 */
const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const DEMO_EMAIL = "demo.athlete+splitindex@example.com";
const DEMO_USERNAME = "demo_masters_hybrid";
const DEMO_DISPLAY_NAME = "Demo Athlete";

/** Read .env.local directly — same approach as scripts/recompute-all-users.ts. */
function loadEnvLocal(): void {
  let raw: string;
  try {
    raw = readFileSync(join(REPO_ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split("\n")) {
    if (line.trim().startsWith("#")) continue;
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    const [, k, v] = m;
    if (process.env[k] === undefined) process.env[k] = v.replace(/^["']|["']$/g, "");
  }
}

loadEnvLocal();

const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const DELETE = args.includes("--delete");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const demoPassword = process.env.DEMO_ACCOUNT_PASSWORD;

if (!url || !serviceKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Both live in .env.local. The service-role key bypasses RLS — if you are\n" +
      "about to paste it somewhere, do not."
  );
  process.exit(1);
}

if (APPLY && !DELETE && !demoPassword) {
  console.error(
    "Missing DEMO_ACCOUNT_PASSWORD.\n" +
      "Set it yourself, in your own shell or .env.local — this script deliberately\n" +
      "does not invent one, so no password is ever generated, printed or logged here:\n" +
      "  export DEMO_ACCOUNT_PASSWORD='...'"
  );
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ─── Athlete constants ───────────────────────────────────────────────────────

const BODYWEIGHT_KG = 80;
/** 45 puts the athlete on the Masters side of the age curve, where ageFactor() != 1. */
const AGE = 45;
const MAX_HR = 178;
const RESTING_HR = 52;

const WEEKS = 9;
/** Weeks 1-8 are steady; week 9 spikes so ACWR leaves the optimal band. */
const SPIKE_WEEK = 9;

interface SeedActivity {
  sport: "running" | "gym";
  title: string;
  started_at: string;
  duration_seconds: number;
  distance_meters?: number;
  avg_heart_rate?: number;
  elevation_meters?: number;
  session_type?: string;
  exercises?: Array<{
    exercise_name: string;
    muscle_group: string;
    weight_kg: number;
    sets: number;
    reps: number;
  }>;
}

function dayOffset(daysAgo: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}

/**
 * Bench is held flat across the whole block on purpose (stalled-lift finding
 * needs a progression rate below 0.15kg/week); squat and deadlift creep up so
 * the athlete does not read as globally detrained, which would muddy the
 * "bench is your limiter" story.
 */
function liftsForWeek(week: number): SeedActivity["exercises"] {
  const creep = week * 1.5;
  return [
    { exercise_name: "Squat", muscle_group: "legs", weight_kg: 132 + creep, sets: 4, reps: 5 },
    { exercise_name: "Bench Press", muscle_group: "chest", weight_kg: 80, sets: 4, reps: 5 },
    { exercise_name: "Deadlift", muscle_group: "back", weight_kg: 165 + creep, sets: 3, reps: 5 },
  ];
}

function buildActivities(): SeedActivity[] {
  const out: SeedActivity[] = [];

  for (let week = 1; week <= WEEKS; week++) {
    // Week 1 is the oldest. daysAgo counts back from today.
    const weeksAgo = WEEKS - week;
    const monday = weeksAgo * 7 + 6;
    const isSpike = week === SPIKE_WEEK;

    // The spike is volume, not intensity — a longer run and an extra session,
    // which is how a real overreach usually looks and what ACWR is built to
    // catch.
    const runMinutes = isSpike ? 78 : 42;
    const runMeters = isSpike ? 14500 : 8000;

    out.push({
      sport: "gym",
      title: "Lower + press",
      started_at: dayOffset(monday, 18),
      duration_seconds: (isSpike ? 75 : 60) * 60,
      exercises: liftsForWeek(week),
    });

    // Tuesday: 1 day after strength. Same pace as Friday, higher HR — this is
    // the interference signal the radar is looking for.
    out.push({
      sport: "running",
      title: "Easy run",
      started_at: dayOffset(monday - 1, 7),
      duration_seconds: runMinutes * 60,
      distance_meters: runMeters,
      avg_heart_rate: isSpike ? 156 : 152,
      elevation_meters: 45,
      session_type: "easy",
    });

    // Friday: two clear rest days behind it, so it qualifies as the rested
    // baseline (MIN_REST_DAYS_FOR_BASELINE = 2).
    out.push({
      sport: "running",
      title: "Easy run",
      started_at: dayOffset(monday - 4, 7),
      duration_seconds: runMinutes * 60,
      distance_meters: runMeters,
      avg_heart_rate: isSpike ? 147 : 143,
      elevation_meters: 45,
      session_type: "easy",
    });

    out.push({
      sport: "gym",
      title: "Upper",
      started_at: dayOffset(monday - 5, 18),
      duration_seconds: (isSpike ? 70 : 55) * 60,
      exercises: liftsForWeek(week),
    });

    // The spike week gets a fourth and fifth session. Everything above is
    // steady state; this is what actually moves acute load above chronic.
    if (isSpike) {
      out.push({
        sport: "running",
        title: "Long run",
        started_at: dayOffset(monday - 6, 8),
        duration_seconds: 95 * 60,
        distance_meters: 18000,
        avg_heart_rate: 151,
        elevation_meters: 120,
        session_type: "long",
      });
      out.push({
        sport: "running",
        title: "Easy run",
        started_at: dayOffset(monday - 2, 7),
        duration_seconds: 55 * 60,
        distance_meters: 10000,
        avg_heart_rate: 154,
        elevation_meters: 40,
        session_type: "easy",
      });
    }
  }

  return out.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

async function findDemoUserId(): Promise<string | null> {
  // listUsers is paginated; the demo account is created by this script so it
  // is almost always on page 1, but do not assume it.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers failed: ${error.message}`);
    const hit = data.users.find((u) => u.email === DEMO_EMAIL);
    if (hit) return hit.id;
    if (data.users.length < 200) break;
  }
  return null;
}

async function doDelete(): Promise<void> {
  const userId = await findDemoUserId();
  if (!userId) {
    console.log(`No account found for ${DEMO_EMAIL} — nothing to delete.`);
    return;
  }
  console.log(`Found demo account ${userId}.`);
  if (!APPLY) {
    console.log("DRY RUN — would delete this auth user and cascade its rows. Re-run with --apply.");
    return;
  }
  // Every user-owned table references auth.users ON DELETE CASCADE, so this
  // one delete removes the activities, sets, scores and profile with it.
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) throw new Error(`deleteUser failed: ${error.message}`);
  console.log("Deleted.");
}

async function doSeed(): Promise<void> {
  const activities = buildActivities();
  const gymCount = activities.filter((a) => a.sport === "gym").length;
  const runCount = activities.filter((a) => a.sport === "running").length;
  const totalMinutes = Math.round(
    activities.reduce((sum, a) => sum + a.duration_seconds, 0) / 60
  );

  console.log(`Target Supabase : ${new URL(url!).host}`);
  console.log(`Demo account    : ${DEMO_EMAIL} (@${DEMO_USERNAME})`);
  console.log(`Athlete         : ${AGE}y, ${BODYWEIGHT_KG}kg, max HR ${MAX_HR}`);
  console.log(
    `Plan            : ${activities.length} activities over ${WEEKS} weeks ` +
      `(${gymCount} gym, ${runCount} runs, ${totalMinutes} min total)`
  );
  console.log(`Spike week      : week ${SPIKE_WEEK} of ${WEEKS} — pushes ACWR out of optimal`);
  console.log("");

  const existing = await findDemoUserId();
  if (existing) {
    console.log(
      `An account already exists for ${DEMO_EMAIL} (${existing}).\n` +
        "Delete it first so the seed is reproducible rather than doubled:\n" +
        "  npx tsx scripts/seed-demo-athlete.ts --delete --apply"
    );
    return;
  }

  if (!APPLY) {
    console.log("DRY RUN — nothing written. Re-run with --apply to create the account.");
    console.log("");
    console.log("First five activities that would be inserted:");
    for (const a of activities.slice(0, 5)) {
      console.log(
        `  ${a.started_at.slice(0, 10)}  ${a.sport.padEnd(8)}` +
          `${String(Math.round(a.duration_seconds / 60)).padStart(3)} min` +
          (a.avg_heart_rate ? `  HR ${a.avg_heart_rate}` : "") +
          (a.exercises ? `  ${a.exercises.length} lifts` : "")
      );
    }
    return;
  }

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: DEMO_EMAIL,
    password: demoPassword,
    email_confirm: true,
  });
  if (createError || !created?.user) {
    throw new Error(`createUser failed: ${createError?.message ?? "no user returned"}`);
  }
  const userId = created.user.id;
  console.log(`Created auth user ${userId}.`);

  // 001's handle_new_user trigger inserts the profile row; fill in the rest.
  // Premium because every screen this account exists to photograph is gated.
  const { error: profileError } = await supabase
    .from("profiles")
    .update({
      username: DEMO_USERNAME,
      display_name: DEMO_DISPLAY_NAME,
      age: AGE,
      weight_kg: BODYWEIGHT_KG,
      max_hr: MAX_HR,
      resting_hr: RESTING_HR,
      gender: "male",
      experience: "intermediate",
      onboarding_completed: true,
      subscription_tier: "premium",
      subscription_status: "active",
    })
    .eq("user_id", userId);
  if (profileError) throw new Error(`profile update failed: ${profileError.message}`);

  let inserted = 0;
  for (const a of activities) {
    const { data: row, error: actError } = await supabase
      .from("activities")
      .insert({
        user_id: userId,
        sport: a.sport,
        title: a.title,
        started_at: a.started_at,
        duration_seconds: a.duration_seconds,
        distance_meters: a.distance_meters ?? null,
        elevation_meters: a.elevation_meters ?? null,
        avg_heart_rate: a.avg_heart_rate ?? null,
        session_type: a.session_type ?? null,
        source: "manual",
        is_draft: false,
      })
      .select("id")
      .single();
    if (actError || !row) throw new Error(`activity insert failed: ${actError?.message}`);

    if (a.exercises?.length) {
      const { error: exError } = await supabase.from("gym_exercises").insert(
        a.exercises.map((e, i) => ({
          activity_id: row.id,
          exercise_name: e.exercise_name,
          muscle_group: e.muscle_group,
          weight_kg: e.weight_kg,
          sets: e.sets,
          reps: e.reps,
          order_index: i,
        }))
      );
      if (exError) throw new Error(`exercise insert failed: ${exError.message}`);
    }
    inserted++;
  }
  console.log(`Inserted ${inserted} activities.`);

  // Scores come from the real engine, not from this script.
  console.log("Recomputing with the live engine…");
  try {
    const result = await recomputeUser(supabase, userId);
    console.log(`Recompute done: ${JSON.stringify(result)}`);
  } catch (err) {
    if (err instanceof RecomputeError) {
      console.error(`Recompute failed (${err.status}): ${err.message}`);
      console.error("The rows are in; re-run the recompute rather than re-seeding.");
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  console.log("");
  console.log("Seeded. Sign in as the demo account and check, in this order:");
  console.log("  /analytics      — Injury Risk should have left the optimal band");
  console.log("  /hybrid-plan    — Diagnostic should name bench as the weak and stalled lift");
  console.log("  /interference   — should now return a finding rather than 'early data'");
  console.log("");
  console.log("If any of those still read as before, the engine disagrees with the seed's");
  console.log("intent — adjust the inputs above rather than the engine.");
}

async function main() {
  if (DELETE) {
    await doDelete();
    return;
  }
  await doSeed();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
