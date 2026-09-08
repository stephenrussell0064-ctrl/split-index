#!/usr/bin/env node
/**
 * Refuse a production build that cannot take money.
 *
 * ## The failure this exists for
 *
 * There is one subscriber who matters more than the rest, and it is the first
 * one. If the payment path is misconfigured when they tap subscribe, they are
 * charged and get nothing, or they are not charged and think they were — and
 * neither is recoverable by apologising a week later.
 *
 * Every input to that path is an environment variable set in a dashboard, and
 * none of them is checked by anything. The webhook that grants premium reads
 *
 *     const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
 *     if (!secret) return false;
 *
 * so an unset secret rejects every RevenueCat callback. The purchase succeeds,
 * Apple takes the money, and the entitlement is never granted. Nothing in the
 * build, the deploy or the app surfaces that; the first sign is a support email
 * from somebody who has paid.
 *
 * `SECURITY.md` already records that `REVENUECAT_WEBHOOK_SECRET` went missing
 * from `.env.example` once, and that `.env.example` is not even tracked — so
 * the authoritative list is a markdown table, which is documentation and not a
 * guard.
 *
 * The sibling project does this already: `apprentigate/next.config.ts` refuses
 * to build for a real origin without its Turnstile key, because a broken
 * contact form reached the live domain twice. This is the same guard with money
 * attached.
 *
 * ## The quiet one
 *
 * `NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE=true` sends every purchase to
 * RevenueCat's test store. The app works, the paywall works, the purchase
 * "succeeds", and nobody is ever charged. `resolveApiKey` already refuses a
 * `test_` key set as a production key — but the flag overrides that path
 * entirely, and a flag left on from testing is exactly the kind of thing that
 * survives a launch.
 *
 *   node scripts/check-payment-env.mjs
 */

/** Unset, empty, or obviously a placeholder rather than a real value. */
function missing(value) {
  const v = (value ?? '').trim();
  return v === '' || /^(changeme|todo|xxx+|your[-_]?)/i.test(v);
}

/**
 * @param env process.env, or a fixture
 * @returns problems, each one a reason the first subscriber would fail
 */
export function paymentEnvProblems(env) {
  const problems = [];

  /*
   * VERCEL_ENV, not the app's URL.
   *
   * The first version keyed off NEXT_PUBLIC_APP_URL being an https origin —
   * and .env.local sets that to the real domain, because it is the app's
   * canonical URL and is needed locally too. So every local build looked like
   * production and the guard refused to build at all. A guard that blocks
   * ordinary development gets deleted within a day, and then it protects
   * nothing.
   *
   * VERCEL_ENV is set by the platform doing the deploying: "production" only
   * for a production deploy, "preview" for a branch, and absent on a laptop.
   * FORCE_PAYMENT_ENV_CHECK exists so this can be exercised deliberately.
   */
  const targetsProduction =
    env.VERCEL_ENV === 'production' || env.FORCE_PAYMENT_ENV_CHECK === 'true';

  // Local and preview builds legitimately run without live payment config.
  // Enforcing there would only teach people to set fake values, and a fake
  // value passes a presence check while failing exactly as this is meant to
  // prevent.
  if (!targetsProduction) return problems;

  const required = [
    ['REVENUECAT_WEBHOOK_SECRET', 'the webhook rejects every callback, so a purchase never grants premium'],
    ['NEXT_PUBLIC_REVENUECAT_IOS_API_KEY', 'the iOS app cannot start a purchase at all'],
    ['REVENUECAT_MONTHLY_PRODUCT_ID', 'a completed purchase cannot be mapped to a plan'],
    ['REVENUECAT_ANNUAL_PRODUCT_ID', 'a completed purchase cannot be mapped to a plan'],
  ];

  for (const [name, consequence] of required) {
    if (missing(env[name])) problems.push({ name, consequence });
  }

  // The silent one. Everything works and no money moves.
  if ((env.NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE ?? '').trim() === 'true') {
    problems.push({
      name: 'NEXT_PUBLIC_REVENUECAT_USE_TEST_STORE',
      consequence:
        'is "true", so every purchase goes to RevenueCat\'s test store. The paywall works, the purchase succeeds, and nobody is charged',
    });
  }

  // A test key in a production slot. resolveApiKey catches this at runtime and
  // logs, but by then the build has shipped and the log is on a device.
  for (const name of ['NEXT_PUBLIC_REVENUECAT_IOS_API_KEY', 'NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY']) {
    if ((env[name] ?? '').startsWith('test_')) {
      problems.push({
        name,
        consequence: 'is a Test Store key in a production slot — RevenueCat crashes release builds configured this way',
      });
    }
  }

  return problems;
}

function main() {
  const problems = paymentEnvProblems(process.env);

  if (problems.length === 0) {
    const enforced =
      process.env.VERCEL_ENV === 'production' || process.env.FORCE_PAYMENT_ENV_CHECK === 'true';
    process.stdout.write(
      enforced
        ? 'payment configuration is complete for a production build\n'
        : 'not a production deploy — payment configuration not enforced\n',
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nRefusing to ship: this build cannot reliably take money.\n\n` +
      problems.map((p) => `  ${p.name}\n    ${p.consequence}\n`).join('\n') +
      `\nThe first subscriber is the one this protects. They are charged once and\n` +
      `they do not come back to try again.\n\n` +
      `Set these in the Vercel production environment. SECURITY.md holds the\n` +
      `authoritative list and where each value comes from.\n\n`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
