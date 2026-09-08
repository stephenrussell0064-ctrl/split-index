#!/usr/bin/env node
/**
 * Tests for the single-checkout-path guard.
 *
 * The one that matters is the third surface. B1 and B2 each watch one component
 * that got this wrong before; neither can see a new paywall modal or an
 * onboarding upsell importing Stripe directly and shipping a 3.1.1 violation
 * with both of them green.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { offenders } from './check-checkout-single-path.mjs';

const root = mkdtempSync(join(tmpdir(), 'checkout-guard-'));
const src = join(root, 'src');

function file(rel, contents) {
  const full = join(src, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, contents, 'utf8');
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'ok  ' : 'FAIL'} ${description}\n` +
      (ok ? '' : `       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`),
  );
}

const flagged = () => offenders(src, root).map((o) => o.file).sort();

// The decision point itself is allowed to import them. That is its job.
file('lib/native/use-checkout.ts', 'import { startStripeCheckout } from "@/lib/stripe/start-checkout";');
check('the decision point may import a payment entry point', flagged(), []);

// A consumer going through useCheckout is correct.
file('components/pricing/sku-picker.tsx', 'import { useCheckout } from "@/lib/native/use-checkout";');
check('a component using useCheckout is fine', flagged(), []);

/*
 * The regression. This is the shape of B1: a component reaching the payment
 * provider directly, with no platform check, shipping a Stripe redirect to an
 * iOS user.
 */
file('components/paywall/upsell-modal.tsx', 'import { startStripeCheckout } from "@/lib/stripe/start-checkout";');
check('a third surface importing Stripe directly is caught', flagged(), ['src/components/paywall/upsell-modal.tsx']);
rmSync(join(src, 'components/paywall'), { recursive: true, force: true });

// The native side is the same violation in the other direction: a purchase
// started without asking which platform we are on.
file('components/paywall/native-upsell.tsx', 'import { purchaseNativeSku } from "@/lib/native/billing";');
check('a component starting a native purchase directly is caught', flagged(), ['src/components/paywall/native-upsell.tsx']);
rmSync(join(src, 'components/paywall'), { recursive: true, force: true });

/*
 * Both real call sites discuss these functions by name, in comments explaining
 * why they do not call them. Flagging a mention would punish the documentation
 * for being accurate and would get the guard disabled.
 */
file(
  'app/settings/settings-client.tsx',
  '// This button used to call startStripeCheckout() directly, with no check.\nimport { useCheckout } from "@/lib/native/use-checkout";',
);
check('a comment naming the function is not an import', flagged(), []);

// Tests mock the entry point; that is how the decision point is tested at all.
file('lib/native/use-checkout.test.ts', 'import { startStripeCheckout } from "@/lib/stripe/start-checkout";');
check('a test file may import it', flagged(), []);

/*
 * The four shapes that walked past this guard until 8 September 2026.
 *
 * It matched `import\s*\{[^}]*symbol[^}]*\}` — a braced named import — so
 * anything else was invisible. None of these is an adversarial trick; they are
 * how people ordinarily refactor, which is what made it worth fixing rather
 * than noting.
 */
file('components/upsell/namespace.tsx', 'import * as pay from "@/lib/stripe/start-checkout";\nexport const A = () => pay.startStripeCheckout();');
check('a namespace import is caught', flagged(), ['src/components/upsell/namespace.tsx']);
rmSync(join(src, 'components/upsell'), { recursive: true, force: true });

file('components/upsell/default.tsx', 'import startStripeCheckout from "@/lib/stripe/start-checkout";\nexport const A = () => startStripeCheckout();');
check('a default import is caught', flagged(), ['src/components/upsell/default.tsx']);
rmSync(join(src, 'components/upsell'), { recursive: true, force: true });

file('components/upsell/dynamic.tsx', 'export const A = async () => { const { startStripeCheckout } = await import("@/lib/stripe/start-checkout"); return startStripeCheckout(); };');
check('a dynamic import is caught', flagged(), ['src/components/upsell/dynamic.tsx']);
rmSync(join(src, 'components/upsell'), { recursive: true, force: true });

/*
 * The one that mattered most. A barrel re-exporting under a new name launders
 * the symbol: every consumer then imports `beginUpgrade`, a name this file has
 * never heard of, and the guard sees nothing anywhere. A 3.1.1 violation
 * reachable by a refactor nobody would think twice about, in the check whose
 * entire job is to make 3.1.1 unreachable.
 */
file('lib/payments/index.ts', 'export { startStripeCheckout as beginUpgrade } from "@/lib/stripe/start-checkout";');
check('a re-export, even renamed, is caught at the barrel', flagged(), ['src/lib/payments/index.ts']);
rmSync(join(src, 'lib/payments'), { recursive: true, force: true });

// The defining module must be allowed to name its own export, and only its own.
file('lib/stripe/start-checkout.ts', 'export function startStripeCheckout() {}');
check('the module that defines it may name it', flagged(), []);
file('lib/stripe/start-checkout.ts', 'export function startStripeCheckout() {}\nimport { purchaseNativeSku } from "@/lib/native/billing";');
check('but not a DIFFERENT payment entry point', flagged(), ['src/lib/stripe/start-checkout.ts']);
rmSync(join(src, 'lib/stripe'), { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
process.stdout.write(`\n  ${failures ? `${failures} failed` : 'all passed'}\n\n`);
process.exit(failures ? 1 : 0);
