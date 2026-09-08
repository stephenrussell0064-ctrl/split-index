#!/usr/bin/env node
/**
 * Does the suite notice when the implementation is wrong?
 *
 * A passing suite proves the tests pass. It does not prove they would fail if
 * the code were broken — which is the only property that makes "green" worth
 * anything. Each mutation below is a plausible bug in a module where being
 * wrong costs real money or real harm. If the suite stays green, the tests
 * around that module are decoration.
 *
 * Every file is copied before it is touched and restored afterwards, including
 * on failure.
 */

import { copyFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// A fresh temp directory per run, so a crashed run cannot leave a stale backup
// that a later run restores over good code.
const BAK = mkdtempSync(join(tmpdir(), 'mutation-'));

const MUTATIONS = [
  {
    what: 'premium gate always open — every free account gets paid features',
    file: 'src/lib/premium/features.ts',
    tests: 'src/lib/premium',
    apply: (s) => s.replace(/const access = PREMIUM_FEATURES\[feature\];/, 'const access = PREMIUM_FEATURES[feature]; if (true) return true;'),
  },
  {
    what: 'content filter passes everything — slurs publish',
    file: 'src/lib/moderation/filter.ts',
    tests: 'src/lib/moderation',
    apply: (s) => s.replace(/export function assess\(text: string\): Assessment \{/, 'export function assess(text: string): Assessment {\n  if (text) return CLEAN;'),
  },
  {
    what: 'blocking becomes one-way — the blocked person still sees the blocker',
    file: 'src/lib/moderation/index.ts',
    tests: 'src/lib/moderation',
    apply: (s) =>
      s.replace(
        /\(row\.blocker_id === b && row\.blocked_id === a\),/,
        'false,',
      ),
  },
  {
    what: 'webhook accepts unauthenticated callbacks — anyone can grant themselves premium',
    file: 'src/app/api/revenuecat/webhook/route.ts',
    tests: 'src/app/api/revenuecat',
    apply: (s) => s.replace(/if \(!secret\) return false;/, 'if (!secret) return true;'),
  },
  {
    what: 'evidence weighting removed — one session reads as confidently as five',
    file: 'src/lib/scoring/index-engine.ts',
    tests: 'src/lib/scoring/index-engine.test.ts',
    apply: (s) => s.replace(/return clamp\(confidence \/ FULL_EVIDENCE_SESSIONS, 0, 1\);/, 'return 1;'),
  },
  {
    what: 'injury risk always returns low — the flag never fires',
    file: 'src/lib/scoring/injury-risk.ts',
    tests: 'src/lib/scoring/injury-risk.test.ts',
    apply: (s) => s.replace(/export function injuryRisk\(acwr: number\): InjuryRiskResult \{/, 'export function injuryRisk(acwr: number): InjuryRiskResult {\n  acwr = 1.0;'),
  },
  {
    what: 'interference needs one paired session, not three — noise reads as a finding',
    file: 'src/lib/scoring/interference.ts',
    tests: 'src/lib/scoring/interference.test.ts',
    apply: (s) => s.replace(/MIN_PAIRED_SESSIONS: 3,/, 'MIN_PAIRED_SESSIONS: 1,'),
  },
  /*
   * The two App Store blockers themselves. Both were invisible to the type
   * checker and to every test that existed at the time, which is why the
   * routing decision was extracted into a pure function — so it could be
   * tested without a React testing library this project does not have. These
   * two mutations are the check on whether that worked.
   */
  {
    what: 'B2 regression — "checking" falls through instead of refusing',
    file: 'src/lib/native/use-checkout.ts',
    tests: 'src/lib/native/use-checkout.test.ts',
    apply: (s) => s.replace('if (platform === "checking") return { status: "not-ready" };', ''),
  },
  {
    what: 'B1 regression — the native branch is skipped and everything goes to Stripe',
    file: 'src/lib/native/use-checkout.ts',
    tests: 'src/lib/native/use-checkout.test.ts',
    apply: (s) => s.replace('if (platform === "native") {', 'if (false) {'),
  },
];

let caught = 0;
let missed = 0;

for (const m of MUTATIONS) {
  const path = join(ROOT, m.file);
  const backup = join(BAK, m.file.replace(/\//g, '_') + '.bak');
  copyFileSync(path, backup);

  try {
    const original = readFileSync(path, 'utf8');
    const mutated = m.apply(original);
    if (!mutated || mutated === original) {
      process.stdout.write(`  SKIP  ${m.what}\n        (mutation did not apply — pattern moved)\n`);
      continue;
    }
    writeFileSync(path, mutated, 'utf8');

    let green = true;
    try {
      execSync(`npx vitest run ${m.tests}`, { cwd: ROOT, stdio: 'pipe', timeout: 300000 });
    } catch {
      green = false;
    }

    if (green) {
      missed++;
      process.stdout.write(`  MISSED  ${m.what}\n          suite stayed green with this broken\n`);
    } else {
      caught++;
      process.stdout.write(`  caught  ${m.what}\n`);
    }
  } finally {
    copyFileSync(backup, path);
    try { unlinkSync(backup); } catch {}
  }
}

process.stdout.write(
  `\n  ${caught} caught, ${missed} missed\n\n` +
    (missed === 0
      ? '  Every mutation was caught. The suite has teeth.\n\n'
      : '  A missed mutation means the tests around that module pass whether or not\n' +
        '  it works. Fix the tests, not this file.\n\n'),
);
process.exit(missed === 0 ? 0 : 1);
