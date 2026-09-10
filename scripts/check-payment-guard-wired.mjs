#!/usr/bin/env node
/**
 * Is the payment guard still wired into the build, or only still correct?
 *
 * ## What the existing tests already do, and the one thing they cannot
 *
 * `check-payment-env.test.mjs` is careful work and this does not replace it. It
 * exercises `paymentEnvProblems` against synthetic environments, and it already
 * asserts the wiring: it strips comments from `next.config.ts` and requires
 * both the import and a bare `assertProductionCanTakeMoney();` at module scope.
 * Deleting the call is caught there.
 *
 * What it cannot do is tell whether the call *does anything*, because it reads
 * the text of the config rather than running it. Changing one character inside
 * the guard —
 *
 *     if (problems.length === 0) return;   ->   if (problems.length >= 0) return;
 *
 * — leaves the import in place, the module-scope call in place, and every
 * assertion in that file passing, while the guard returns before it can throw.
 * A production build then ships that cannot take money, and the milestone stays
 * green. That mutation was run: all existing tests passed, and this caught it.
 *
 * ## How this proves the wiring rather than the logic
 *
 * It loads `next.config.ts` itself, in a child process, with a deliberately
 * incomplete production environment, and requires the load to fail. The guard
 * runs at module scope, so importing the config *is* running it. Node strips
 * the TypeScript natively, so this costs a second rather than a build.
 *
 * Two processes, not two imports: a module executes its top level once per
 * process, so a second import in the same process returns the cache and runs
 * nothing.
 *
 * The passing case matters as much as the failing one. A guard that throws on
 * everything would satisfy the first assertion and break every real build, so
 * a complete environment must load cleanly.
 *
 *   node scripts/check-payment-guard-wired.mjs
 */

import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * A production environment with everything the guard asks for.
 *
 * Deliberately fake values: the guard checks presence and shape, never talks to
 * RevenueCat, and a real key has no business in a check that prints its inputs
 * on failure.
 */
const COMPLETE = {
  VERCEL_ENV: 'production',
  REVENUECAT_WEBHOOK_SECRET: 'whsec_probe_not_a_real_secret',
  NEXT_PUBLIC_REVENUECAT_IOS_API_KEY: 'appl_probe_not_a_real_key',
  REVENUECAT_MONTHLY_PRODUCT_ID: 'si_monthly',
  REVENUECAT_ANNUAL_PRODUCT_ID: 'si_annual',
  NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE: 'false',
};

/** Loads next.config.ts in a fresh process. Resolves to whether it threw. */
async function loadConfig(env) {
  // The child prints the rejection before exiting. Without that, stderr holds
  // only Node's module-type warning and the parent cannot tell the payment
  // guard's refusal from any other failure to load the file — which is the
  // difference between "the guard fired" and "the config is broken".
  const script =
    "import('./next.config.ts').then(" +
    '() => process.exit(0),' +
    '(err) => { process.stderr.write(String(err && err.message ? err.message : err)); process.exit(1); });';
  try {
    await run(process.execPath, ['-e', script], {
      cwd: ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
      timeout: 60_000,
    });
    return { threw: false };
  } catch (err) {
    // A non-zero exit is the guard firing. Anything else — a timeout, a syntax
    // error — is not evidence about the guard, so it is reported separately.
    if (err.killed || err.signal) return { threw: false, broken: `the load timed out: ${err.message}` };
    return { threw: true, stderr: String(err.stderr ?? '') };
  }
}

const failures = [];

// 1. The guard must refuse a production build that cannot take money.
const missingSecret = await loadConfig({ ...COMPLETE, REVENUECAT_WEBHOOK_SECRET: '' });
if (missingSecret.broken) {
  failures.push(`could not tell whether the guard fires — ${missingSecret.broken}`);
} else if (!missingSecret.threw) {
  failures.push(
    'next.config.ts loaded cleanly with REVENUECAT_WEBHOOK_SECRET empty in a production build. ' +
      'Either assertProductionCanTakeMoney() is not being called, or its body no longer throws — ' +
      'check-payment-env.test.mjs covers the first and cannot see the second. ' +
      'A purchase would succeed, Apple would take the money, and the entitlement would never land.',
  );
} else if (!/cannot reliably take money/.test(missingSecret.stderr)) {
  failures.push(
    'the config refused to load, but not with the payment guard’s message, so something else is broken and ' +
      `the guard is unproven: ${missingSecret.stderr.slice(0, 300)}`,
  );
}

// 2. The test-store flag, which is the only failure that looks like success.
const testStore = await loadConfig({ ...COMPLETE, NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE: 'true' });
if (!testStore.broken && !testStore.threw) {
  failures.push(
    'next.config.ts loaded cleanly with NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE=true in a production build. ' +
      'Every purchase would route to a test store while looking like success to the customer.',
  );
}

// 3. And it must not refuse a build that is fine.
const complete = await loadConfig(COMPLETE);
if (!complete.broken && complete.threw) {
  failures.push(
    'next.config.ts refused to load with a COMPLETE production environment. A guard that refuses ' +
      `everything blocks every real deploy: ${complete.stderr.slice(0, 300)}`,
  );
}

if (failures.length === 0) {
  process.stdout.write(
    '\n  the payment guard is wired into next.config.ts and firing\n' +
      '    · refuses a production build with no webhook secret\n' +
      '    · refuses one pointed at the test store\n' +
      '    · loads a complete production environment cleanly\n\n',
  );
  process.exit(0);
}

process.stdout.write('\n  The payment guard is not doing what the milestone claims:\n\n');
for (const f of failures) process.stdout.write(`  · ${f}\n\n`);
process.exit(1);
