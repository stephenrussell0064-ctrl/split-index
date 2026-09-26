/**
 * Render every deliverable into ./out.
 *
 *   npm run render            everything (≈ 12 videos + 5 stills, full quality)
 *   npm run render -- --only A            one variant (silent + sfx + cover)
 *   npm run render -- --drafts            quarter-res drafts of everything, fast
 *
 * Order of operations, deliberately:
 *   1. `compute` — re-runs the app's scoring engines over demo-profile.ts and
 *      REFUSES to continue if any hook claim is false for the profile.
 *   2. `sfx` — regenerates the self-synthesised sound files.
 *   3. renders, via the Remotion CLI so remotion.config.ts (H.264, CRF 16,
 *      yuv420p, ANGLE) applies.
 *
 * Output names carry the variant letter and its slug so the posting kit can
 * refer to files unambiguously.
 */
import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";

const args = process.argv.slice(2);
const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
const drafts = args.includes("--drafts");
const formatsOnly = args.includes("--formats");
const realOnly = args.includes("--real");
const showcaseOnly = args.includes("--showcase");
const reelOnly = args.includes("--reel");
const ugcOnly = args.includes("--ugc");

const HOOKS = { A: "bench-elite-5k-beginner", B: "lifting-slowing-running", C: "built-an-app", D: "strong-or-fit", E: "rate-me" };
const ids = only ? [only] : Object.keys(HOOKS);

const run = (cmd) => {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
};

const scale = drafts ? "--scale=0.25" : "";
const crf = drafts ? "--crf=28" : "";
const outDir = drafts ? "out/drafts" : "out";
mkdirSync(outDir, { recursive: true });

run("npm run --silent compute");
run("npm run --silent sfx");

const FORMATS = { StatCard: "stat-card", Quiz: "guess-the-tier", TugOfWar: "the-gap", RadarExplainer: "radar-explainer", TextStory: "text-story", MicroLoop: "micro-loop" };

if (ugcOnly) {
  mkdirSync(`${outDir}/ugc`, { recursive: true });
  const UGC = { ArmFat: "arm-fat-loss-exercises", RunFaster5k: "how-to-run-faster-5k", BenchNotGoingUp: "bench-press-not-going-up", RunningBadForGains: "is-running-bad-for-gains", HybridSplit: "hybrid-athlete-training-split", HyroxPlan: "hyrox-training-plan", Zone2: "zone-2-running-explained", HowMuchDeadlift: "how-much-should-i-deadlift", ProgressTracker: "gym-progress-tracker-app", BellyFat: "how-to-lose-belly-fat-gym", Good5kTime: "good-5k-time-for-my-age", StartRunning: "how-to-start-running", PplSplit: "push-pull-legs-split", SpeedShoes: "speed-running-shoes" };
  for (const [id, slug] of Object.entries(UGC)) {
    run(`npx remotion render Ugc-${id} ${outDir}/ugc/ugc-${slug}.mp4 ${scale} ${crf} --props='{"sfx":false,"safeZone":false}' --log=error`);
    run(`npx remotion render UgcSfx-${id} ${outDir}/ugc/ugc-${slug}-sfx.mp4 ${scale} ${crf} --log=error`);
  }
  console.log(`\n✓ rendered into ${outDir}/ugc/`);
  process.exit(0);
}

const REELS = { OneScore: "one-score", TheLab: "the-lab", TheEngine: "the-engine", Recovery: "recovery-and-planning" };
if (reelOnly) {
  mkdirSync(`${outDir}/showreel`, { recursive: true });
  run("npx tsx scripts/gen-vo.ts --keep");
  for (const [id, slug] of Object.entries(REELS)) {
    if (only && only !== id) continue;
    run(`npx remotion render Reel-${id} ${outDir}/showreel/reel-${slug}.mp4 ${scale} ${crf} --props='{"voice":true,"safeZone":false}' --log=error`);
    run(`npx remotion render ReelSilent-${id} ${outDir}/showreel/reel-${slug}-silent.mp4 ${scale} ${crf} --log=error`);
  }
  console.log(`\n✓ rendered into ${outDir}/showreel/`);
  process.exit(0);
}

const SHOWCASE = { Dashboard: "dashboard-and-race-predictions" };
if (showcaseOnly) {
  mkdirSync(`${outDir}/showcase`, { recursive: true });
  for (const [id, slug] of Object.entries(SHOWCASE)) {
    run(`npx remotion render Showcase-${id} ${outDir}/showcase/showcase-${slug}.mp4 ${scale} ${crf} --props='{"sfx":false,"safeZone":false}' --log=error`);
    run(`npx remotion render ShowcaseSfx-${id} ${outDir}/showcase/showcase-${slug}-sfx.mp4 ${scale} ${crf} --log=error`);
  }
  console.log(`\n✓ rendered into ${outDir}/showcase/`);
  process.exit(0);
}

const REAL_HOOKS = { A: "bench-133-5k-1825", B: "is-759-good", C: "built-an-app", D: "strong-or-fit", E: "rate-my-bench-and-5k" };
if (realOnly) {
  mkdirSync(`${outDir}/real`, { recursive: true });
  for (const id of ids) {
    const slug = REAL_HOOKS[id];
    run(`npx remotion render Real-${id} ${outDir}/real/real-${id}-${slug}.mp4 ${scale} ${crf} --log=error`);
    run(`npx remotion render RealSfx-${id} ${outDir}/real/real-${id}-${slug}-sfx.mp4 ${scale} ${crf} --log=error`);
    run(`npx remotion still RealCover-${id} ${outDir}/real/cover-${id}-${slug}.png ${scale} --log=error`);
  }
  if (!only || only === "A") {
    run(`npx remotion render RealShort-A ${outDir}/real/short-A-${REAL_HOOKS.A}.mp4 ${scale} ${crf} --log=error`);
    run(`npx remotion render RealShortSfx-A ${outDir}/real/short-A-${REAL_HOOKS.A}-sfx.mp4 ${scale} ${crf} --log=error`);
  }
  console.log(`\n✓ rendered into ${outDir}/real/`);
  process.exit(0);
}

for (const id of formatsOnly ? [] : ids) {
  const slug = HOOKS[id];
  run(`npx remotion render Ad-${id} ${outDir}/ad-${id}-${slug}.mp4 ${scale} ${crf} --log=error`);
  run(`npx remotion render AdSfx-${id} ${outDir}/ad-${id}-${slug}-sfx.mp4 ${scale} ${crf} --log=error`);
  run(`npx remotion still Cover-${id} ${outDir}/cover-${id}-${slug}.png ${scale} --log=error`);
}

if (!formatsOnly && (!only || only === "A")) {
  run(`npx remotion render Short-A ${outDir}/short-A-${HOOKS.A}.mp4 ${scale} ${crf} --log=error`);
  run(`npx remotion render ShortSfx-A ${outDir}/short-A-${HOOKS.A}-sfx.mp4 ${scale} ${crf} --log=error`);
}

if (!only) {
  mkdirSync(`${outDir}/formats`, { recursive: true });
  for (const [id, slug] of Object.entries(FORMATS)) {
    run(`npx remotion render Fmt-${id} ${outDir}/formats/${slug}.mp4 ${scale} ${crf} --props='{"sfx":false,"safeZone":false}' --log=error`);
    run(`npx remotion render FmtSfx-${id} ${outDir}/formats/${slug}-sfx.mp4 ${scale} ${crf} --log=error`);
  }
}

console.log(`\n✓ rendered into ${outDir}/`);
