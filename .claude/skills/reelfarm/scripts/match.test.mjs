#!/usr/bin/env node
/**
 * Offline regression test for the hook-matching used by `rf.mjs report`.
 * No API key, no network. Run: node scripts/match.test.mjs
 */
import { matchHook, loadHooks } from "./rf.mjs";

const { hooks } = loadHooks();

const cases = [
  ["exact short text", ["Your app gave you 847 points. Ask it why."], "hyb-04"],
  [
    "full line as prompt",
    ["I took four months off. It didn't guilt-trip me. It just told me what I can lift today."],
    "gym-19",
  ],
  [
    "hook inside a longer caption",
    ["slideshow: You added 20kg to your pull-up. Your app logged 20kg... #gym"],
    "gym-17",
  ],
  ["case and punctuation drift", ["BY PACE: 100% EASY.  by heart rate: 6%!!"], "hyb-01"],
  ["unrelated content stays unmatched", ["five tips for a bigger deadlift"], null],
  ["empty input stays unmatched", [null, undefined, ""], null],
];

let failed = 0;
for (const [name, parts, expected] of cases) {
  const got = matchHook(parts, hooks);
  const ok = got === expected;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} -> ${got} (expected ${expected})`);
}

console.log(failed === 0 ? "\nall matching cases pass" : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
