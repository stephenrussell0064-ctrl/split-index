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

for (const id of ids) {
  const slug = HOOKS[id];
  run(`npx remotion render Ad-${id} ${outDir}/ad-${id}-${slug}.mp4 ${scale} ${crf} --log=error`);
  run(`npx remotion render AdSfx-${id} ${outDir}/ad-${id}-${slug}-sfx.mp4 ${scale} ${crf} --log=error`);
  run(`npx remotion still Cover-${id} ${outDir}/cover-${id}-${slug}.png ${scale} --log=error`);
}

if (!only || only === "A") {
  run(`npx remotion render Short-A ${outDir}/short-A-${HOOKS.A}.mp4 ${scale} ${crf} --log=error`);
  run(`npx remotion render ShortSfx-A ${outDir}/short-A-${HOOKS.A}-sfx.mp4 ${scale} ${crf} --log=error`);
}

console.log(`\n✓ rendered into ${outDir}/`);
