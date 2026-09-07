/**
 * M9 — Content-Security-Policy, in two policies rather than one.
 *
 * THE PROBLEM WITH THE OBVIOUS FIX
 * --------------------------------
 * `script-src 'self' 'unsafe-inline'` is the weakest clause in the policy: it
 * is precisely the thing that would stop injected script from running, switched
 * off. The documented fix is a per-request nonce.
 *
 * The cost is not obvious until you measure it. From the bundled Next docs
 * (01-app/02-guides/content-security-policy.md:38 and :391): "you **must** use
 * dynamic rendering to add nonces", and "**all pages must be dynamically
 * rendered**" — static optimisation and ISR disabled, no CDN caching without
 * extra configuration, PPR incompatible. The reason is mechanical rather than
 * arbitrary: Next injects the nonce during server-side rendering by reading the
 * CSP header off the request, and a page prerendered at build time never saw a
 * request.
 *
 * A real build of this app prerenders 13 routes, and one of them is `/`. So the
 * blanket fix pays for a stronger policy on the marketing landing page — which
 * holds no athlete data and has nothing to protect — with slower loads on the
 * page that has to make the first impression.
 *
 * THE SPLIT
 * ---------
 * Every route that holds athlete data is ALREADY dynamic: /dashboard,
 * /activities, /gym, /cardio, /hybrid-plan, /profile, /reports, /social,
 * /settings and every /api route are server-rendered on demand because they
 * read a session. Nonces are free there — the rendering cost the docs warn
 * about has already been paid, for other reasons.
 *
 * So the strict policy goes where the data is, and the marketing and legal
 * surface keeps the policy it has and stays static. That is most of the
 * security benefit for none of the rendering cost.
 *
 * WHAT THIS DOES NOT FIX
 * ----------------------
 * `/`, `/privacy`, `/terms`, `/accessibility`, `/how-scoring-works`,
 * `/login`, `/signup` and the public profile pages keep `'unsafe-inline'`.
 * That is a real remaining gap and it is stated rather than glossed: an
 * injection into the landing page would still execute. The judgement is that
 * those pages render no user-controlled data — see the boundary validation in
 * lib/validation — so the exposure is small, and the trade for static delivery
 * of the pages people arrive on is worth taking. If that stops being true, the
 * fix is to move a path from PUBLIC to the strict list here, which is one line.
 *
 * `style-src` keeps `'unsafe-inline'` in BOTH policies. Nonce-ing styles is a
 * separate change with its own failure mode (Next and Tailwind both inject
 * inline style), and M9 is a finding about scripts. Not smuggling it in here.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

/**
 * Path prefixes that get the strict, nonce-based policy.
 *
 * EVERY ENTRY MUST BE DYNAMICALLY RENDERED. A statically prerendered page
 * served with a nonce policy is worse than one served with the loose policy:
 * its script tags were generated at build time and carry no nonce, so the
 * browser blocks the page's own JavaScript and the page silently does nothing.
 * `csp.test.ts` asserts this list against the routes the build prerenders, so
 * adding a prefix that resolves to a static page fails the build rather than
 * the page.
 *
 * Ordered as they appear in the route table, for diffing against it.
 */
export const NONCE_PATH_PREFIXES = [
  "/activities",
  "/analytics",
  "/api",
  "/cardio",
  "/dashboard",
  "/gym",
  "/hybrid-plan",
  "/interference",
  "/onboarding",
  "/profile",
  "/reports",
  "/settings",
  "/social",
] as const;

/**
 * Routes the build prerenders as static, which therefore must NOT be under any
 * prefix above. Kept here so the two lists can be compared by a test rather
 * than by whoever next reads the build output.
 *
 * Three of them — /settings, /settings/billing, /cardio/gps-run — ARE under a
 * strict prefix, and are opted into dynamic rendering with `connection()` in
 * their own files. They are app pages behind a login; nobody notices them being
 * server-rendered, which is exactly the thing that is not true of `/`.
 */
export const DYNAMIC_BY_FORCE = [
  "/settings",
  "/settings/billing",
  "/cardio/gps-run",
] as const;

export function needsNonce(pathname: string): boolean {
  return NONCE_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function collapse(policy: string): string {
  return policy.replace(/\s{2,}/g, " ").trim();
}

/**
 * The policy for the public, statically-rendered surface. This is the policy
 * that shipped before the split, unchanged, so the marketing pages behave
 * exactly as they did.
 */
export function publicCsp(isDev = process.env.NODE_ENV === "development"): string {
  return collapse(`
    default-src 'self';
    script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self' data:;
    connect-src 'self' ${supabaseUrl};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `);
}

/**
 * The strict policy, for the authenticated surface.
 *
 * `'strict-dynamic'` is the clause that makes the nonce worth having: without
 * it an injected `<script src="/anything-on-our-origin">` still satisfies
 * `'self'`. With it, browsers that understand it ignore `'self'` and host
 * sources entirely and allow only nonced scripts plus what those load. `'self'`
 * stays as the fallback for browsers that do not.
 *
 * `'unsafe-eval'` remains dev-only: React uses `eval` in development to
 * reconstruct server-side error stacks in the browser, and neither React nor
 * Next use it in production.
 */
export function strictCsp(
  nonce: string,
  isDev = process.env.NODE_ENV === "development"
): string {
  return collapse(`
    default-src 'self';
    script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""};
    style-src 'self' 'unsafe-inline';
    img-src 'self' data: https:;
    font-src 'self' data:;
    connect-src 'self' ${supabaseUrl};
    object-src 'none';
    base-uri 'self';
    form-action 'self';
    frame-ancestors 'none';
    upgrade-insecure-requests;
  `);
}

/**
 * A fresh nonce. `crypto.randomUUID` is available in the edge runtime and is
 * cryptographically random, which is the only property that matters: a
 * predictable nonce is the same as no nonce at all.
 *
 * Base64 because the CSP grammar for a nonce-source is base64-ish and a raw
 * UUID's hyphens are outside it.
 */
export function generateNonce(): string {
  return btoa(crypto.randomUUID());
}
