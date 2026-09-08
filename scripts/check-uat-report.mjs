#!/usr/bin/env node
/**
 * Run the UAT personas, and read the report THIS run produced.
 *
 * ## The two checks this replaces
 *
 * `uat-bots` — "Automated UAT personas drive the app end to end" — was checked
 * by testing that the directory `tests/uat` exists. A directory holding one
 * empty file passes that, and so does a suite nothing runs.
 *
 * `uat-cold-start-lurch` — "Index stops lurching ~200 points on an irregular
 * athlete's early sessions" — was checked by greping
 * `docs/pre-launch/uat-bot-report.md` for the ABSENCE of the string "the index
 * does not lurch". That report is a generated artifact that is committed. The
 * grep read whatever was committed last, so the milestone stayed green for as
 * long as nobody re-ran the bots — which is precisely the case where the
 * regression is real and unnoticed. It was checking a file's memory of a
 * result, not the result.
 *
 * The lurch finding is `degraded` severity, which by design does not fail the
 * build (`tests/uat/README.md`: where to spend effort is a product decision).
 * That is a reasonable policy for CI and the wrong one for this milestone,
 * which claims this specific finding is closed. So the suite keeps its policy
 * and the registry asserts on the report the suite just wrote.
 *
 *   node scripts/check-uat-report.mjs
 *   node scripts/check-uat-report.mjs --no-finding "the index does not lurch"
 *
 * The freshness check is the load-bearing part. `writeFileSync` lives in an
 * `afterAll` hook; delete it and every test still passes, and every later run
 * of this script would read a report from a version of the engines that no
 * longer exists.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const REPORT = join(ROOT, 'docs/pre-launch/uat-bot-report.md');

/** Below this the persona set has been gutted and the checks have nothing to be wrong about. */
const MIN_ATHLETES = 8;
const MIN_SESSIONS = 200;

const forbidden = [];
for (let i = 2; i < process.argv.length; i++) {
  if (process.argv[i] === '--no-finding') forbidden.push(process.argv[++i]);
}

const before = statSync(REPORT).mtimeMs;

const run = spawnSync('npx', ['vitest', 'run', 'tests/uat'], {
  cwd: ROOT,
  stdio: 'inherit',
  encoding: 'utf8',
});

if (run.status !== 0) {
  process.stderr.write('\nthe UAT personas did not pass — see the failures above\n\n');
  process.exit(1);
}

const failures = [];

const after = statSync(REPORT).mtimeMs;
if (after <= before) {
  failures.push(
    'the suite ran and did not rewrite docs/pre-launch/uat-bot-report.md — ' +
      'everything below would be reading a stale file',
  );
}

const report = readFileSync(REPORT, 'utf8');

// "**0 blocking · 0 degraded · 1 notes** across 10 athletes."
const header = report.match(
  /\*\*(\d+) blocking · (\d+) degraded · (\d+) notes?\*\* across (\d+) athletes/,
);
if (!header) {
  failures.push('the report has no summary line — its format changed and this check cannot read it');
} else {
  const [, blocking, , , athletes] = header;
  if (Number(blocking) > 0) {
    failures.push(`${blocking} blocking finding(s): the app is broken or lying for at least one athlete`);
  }
  if (Number(athletes) < MIN_ATHLETES) {
    failures.push(`only ${athletes} athletes ran (expected at least ${MIN_ATHLETES})`);
  }
}

// "  84 sessions over 12 weeks · index 709 → 874 · ACWR 0.98–4.00"
const sessions = [...report.matchAll(/^\s*(\d+) sessions over \d+ weeks/gm)].reduce(
  (total, m) => total + Number(m[1]),
  0,
);
if (sessions < MIN_SESSIONS) {
  // "End to end" means weeks of training per athlete. A simulator that
  // returned after one session would satisfy every other assertion here.
  failures.push(
    `${sessions} sessions across all athletes (expected at least ${MIN_SESSIONS}) — ` +
      'the personas are not being driven through a real training block',
  );
}

for (const finding of forbidden) {
  // Findings appear as "### <persona> — <check>". Matching the heading rather
  // than the whole document keeps the prose in this file's own explanation
  // from ever being mistaken for a result.
  const re = new RegExp(`^### .* — ${finding.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm');
  if (re.test(report)) {
    const detail = report.split(re)[1]?.split('\n###')[0]?.trim().split('\n')[1] ?? '';
    failures.push(`"${finding}" is back:\n      ${detail}`);
  }
}

if (failures.length === 0) {
  process.stdout.write(
    `\n${sessions} simulated sessions across ${header?.[4] ?? '?'} athletes, report regenerated, ` +
      `no blocking findings${forbidden.length ? `, none of: ${forbidden.join('; ')}` : ''}\n`,
  );
  process.exit(0);
}

process.stderr.write(
  `\nThe UAT run does not support what the milestone claims:\n\n` +
    failures.map((f) => `  - ${f}`).join('\n\n') +
    `\n\nThe full report is docs/pre-launch/uat-bot-report.md, rewritten by the run above.\n\n`,
);
process.exit(1);
