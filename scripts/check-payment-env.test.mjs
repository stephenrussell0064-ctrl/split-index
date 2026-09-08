#!/usr/bin/env node
/**
 * Tests for the payment-configuration guard.
 *
 * The one that matters most is the test-store flag. Every other failure here is
 * loud — a purchase that cannot start, a webhook that 401s. That one is silent:
 * the paywall works, the purchase succeeds, the user sees a confirmation, and
 * no money moves. It is the only failure mode that looks like success from
 * every angle including the customer's.
 */

import { paymentEnvProblems } from './check-payment-env.mjs';

const PRODUCTION = {
  VERCEL_ENV: 'production',
  REVENUECAT_WEBHOOK_SECRET: 'whsec_real',
  NEXT_PUBLIC_REVENUECAT_IOS_API_KEY: 'appl_realkey',
  REVENUECAT_MONTHLY_PRODUCT_ID: 'si_monthly',
  REVENUECAT_ANNUAL_PRODUCT_ID: 'si_annual',
};

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'ok  ' : 'FAIL'} ${description}\n` +
      (ok ? '' : `       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`),
  );
}

const names = (env) => paymentEnvProblems(env).map((p) => p.name).sort();

check('a complete production build passes', names(PRODUCTION), []);

check(
  'a missing webhook secret is caught — the purchase succeeds and premium is never granted',
  names({ ...PRODUCTION, REVENUECAT_WEBHOOK_SECRET: '' }),
  ['REVENUECAT_WEBHOOK_SECRET'],
);

check(
  'a missing iOS key is caught — no purchase can even start',
  names({ ...PRODUCTION, NEXT_PUBLIC_REVENUECAT_IOS_API_KEY: undefined }),
  ['NEXT_PUBLIC_REVENUECAT_IOS_API_KEY'],
);

check(
  'missing product ids are caught — a completed purchase maps to no plan',
  names({ ...PRODUCTION, REVENUECAT_ANNUAL_PRODUCT_ID: '  ' }),
  ['REVENUECAT_ANNUAL_PRODUCT_ID'],
);

// The silent one.
check(
  'the test-store flag left on is caught',
  names({ ...PRODUCTION, NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE: 'true' }),
  ['NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE'],
);

check(
  'and the reason says nobody is charged, not just that a flag is set',
  /nobody is charged/.test(
    paymentEnvProblems({ ...PRODUCTION, NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE: 'true' })[0].consequence,
  ),
  true,
);

check(
  'a test key in a production slot is caught',
  names({ ...PRODUCTION, NEXT_PUBLIC_REVENUECAT_IOS_API_KEY: 'test_abc' }),
  ['NEXT_PUBLIC_REVENUECAT_IOS_API_KEY'],
);

check(
  'a placeholder value counts as missing',
  names({ ...PRODUCTION, REVENUECAT_WEBHOOK_SECRET: 'changeme' }),
  ['REVENUECAT_WEBHOOK_SECRET'],
);

/*
 * Local and preview builds must not be held to this. Enforcing there teaches
 * people to set fake values, and a fake value passes a presence check while
 * failing in exactly the way this is meant to prevent.
 */
check('a laptop build is not enforced', names({}), []);
check('a preview deploy is not enforced', names({ VERCEL_ENV: 'preview' }), []);
/*
 * The regression. The first version keyed off NEXT_PUBLIC_APP_URL being an
 * https origin, and .env.local sets that to the real domain because it is the
 * app's canonical URL. Every local build looked like production and the guard
 * refused to build — and a guard that blocks development is deleted within a
 * day, after which it protects nothing.
 */
check(
  'the app url being the real domain does not make a laptop build production',
  names({ NEXT_PUBLIC_APP_URL: 'https://splitindex.co.uk' }),
  [],
);
check('but it can be forced, for exercising it deliberately', names({ FORCE_PAYMENT_ENV_CHECK: 'true' }).length > 0, true);

check(
  'every problem names a consequence, not just a variable',
  paymentEnvProblems({ VERCEL_ENV: 'production' }).every(
    (p) => typeof p.consequence === 'string' && p.consequence.length > 30,
  ),
  true,
);

process.stdout.write(`\n  ${failures ? `${failures} failed` : 'all passed'}\n\n`);
process.exit(failures ? 1 : 0);
