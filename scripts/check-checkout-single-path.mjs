#!/usr/bin/env node
/**
 * One place decides how a purchase happens. Enforce it.
 *
 * ## The bug this is the guard for
 *
 * B1 was an App Store guideline 3.1.1 violation shipping in the most prominent
 * upgrade button in the app: the Settings button called `startStripeCheckout()`
 * with no platform check, so an iOS user tapping Upgrade was sent to
 * checkout.stripe.com and asked for a card. The cause was not that anyone chose
 * to do that — it was that the platform branch existed in two places, SkuPicker
 * was migrated to RevenueCat, and the Settings copy was forgotten.
 *
 * `use-checkout.ts` is now the single decision point, and both call sites go
 * through it. Both files carry a comment saying so. A comment is not a
 * constraint: the next component that needs an upgrade button can import the
 * Stripe entry point directly and nothing will object, which is exactly the
 * shape of the original mistake.
 *
 * So: **only `use-checkout.ts` may import a payment entry point.** Everything
 * else asks it.
 *
 * ## Why not lint this with a positive check instead
 *
 * The registry's B1 check greps `src/app/(app)/settings` for the absence of
 * `startStripeCheckout`. That is correct and narrow — it watches the one
 * component that got it wrong before. It cannot see a third surface. A paywall
 * modal, an onboarding upsell, a "you have hit the free limit" prompt: any of
 * those could import Stripe directly, ship a 3.1.1 violation, and leave both
 * B1 and B2 green.
 *
 *   node scripts/check-checkout-single-path.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');

/** The one module allowed to reach a payment provider directly. */
const DECISION_POINT = 'src/lib/native/use-checkout.ts';

/**
 * Entry points that actually start a purchase.
 *
 * Deliberately the functions, not the modules: `@/lib/stripe/...` is imported
 * all over for types and billing-portal links, none of which starts a payment.
 * Matching the module would produce noise, and a noisy guard gets an
 * eslint-disable rather than a fix.
 */
const PAYMENT_ENTRY_POINTS = [
  ['startStripeCheckout', 'sends the user to Stripe, which is a 3.1.1 violation on iOS'],
  ['purchaseNativeSku', 'starts a native purchase without the platform check'],
  ['presentProPaywall', 'presents the native paywall without the platform check'],
];

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(ts|tsx)$/.test(full)) acc.push(full);
  }
  return acc;
}

export function offenders(root = SRC, projectRoot = ROOT) {
  const found = [];

  for (const file of walk(root)) {
    const rel = relative(projectRoot, file);
    if (rel === DECISION_POINT) continue;
    // A test may name anything — mocking the entry point is how the decision
    // point itself is tested, and use-checkout.test.ts does exactly that.
    if (/\.test\.(ts|tsx)$/.test(rel)) continue;

    const text = readFileSync(file, 'utf8');
    for (const [symbol, consequence] of PAYMENT_ENTRY_POINTS) {
      // An import, not a mention: both call sites discuss these by name in
      // comments explaining why they do not call them, and flagging that would
      // punish the documentation for being accurate.
      const imported = new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`, 's').test(text);
      if (imported) found.push({ file: rel, symbol, consequence });
    }
  }

  return found;
}

function main() {
  const found = offenders();

  if (found.length === 0) {
    process.stdout.write(
      `every purchase goes through ${DECISION_POINT}; nothing else imports a payment entry point\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nThese reach a payment provider without going through the platform check:\n\n` +
      found.map((f) => `  ${f.file}\n    imports ${f.symbol} — ${f.consequence}\n`).join('\n') +
      `\nUse useCheckout() from ${DECISION_POINT}. It is the single place that decides\n` +
      `between native billing and Stripe, and it exists because that branch once lived\n` +
      `in two components and one of them was forgotten during a migration.\n\n`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
