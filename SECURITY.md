# Security

Which key does what, where it lives, and how to rotate it. Written to be useful
at 2am by someone who did not set any of it up.

Findings and their status live in [AUDIT-split-index.md](AUDIT-split-index.md).
This file is the operational half: credentials, boundaries, and what to do when
one leaks.

---

## Reporting a vulnerability

Email **security@splitindex.co.uk** with enough detail to reproduce it. Please
do not open a public issue for anything that exposes user data.

> **Set this up before publishing the repository or linking this file from the
> site.** The address above is a placeholder and does not exist yet — a
> vulnerability report bouncing is worse than no address at all. A forwarding
> alias on the existing domain is enough; a personal inbox address is
> deliberately not used here, because this file is intended to be public.

Split Index holds health data — PAR-Q answers, injury history, pregnancy
status, a low-energy-availability screen — so a report touching the Hybrid Plan
intake is treated as urgent regardless of how it is worded.

---

## Credentials

### Public by design — these belong in the browser

Anything prefixed `NEXT_PUBLIC_` is compiled into the client bundle and is
world-readable. That is not a leak; it is how the client libraries work. What
matters is that **nothing else** ever gets that prefix.

| Variable | What it is | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project REST endpoint | Public by design |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon JWT (`role: "anon"`) | Public by design. **RLS is the control, not this key** |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Stripe publishable (`pk_…`) | Public by design |
| `NEXT_PUBLIC_REVENUECAT_IOS_API_KEY` | RevenueCat SDK key | Public by design |
| `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY` | RevenueCat SDK key | Public by design |
| `NEXT_PUBLIC_APP_URL` | Canonical origin | Public by design |

The anon key being public is the reason migration 056 exists. Any policy that
returns a row to the `anon` role returns it to everyone on the internet. See
WP1 in the audit.

### Secret — server only, never in a client component

| Variable | What it protects | Blast radius if leaked |
|---|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | **Bypasses RLS entirely** | Total. Every row of every table, read and write |
| `STRIPE_SECRET_KEY` | Stripe API as us | Charges, refunds, customer data |
| `STRIPE_WEBHOOK_SECRET` | Proves Stripe sent a webhook | Forged subscription events — free premium, or cancelling someone's |
| `REVENUECAT_WEBHOOK_SECRET` | Same, for native billing | Same |
| `OPENAI_API_KEY` | OpenAI billing | Spend, and prompt/response access |
| `CRON_SECRET` | Vercel cron endpoints | Leaderboard rebuilds and report generation triggered at will |
| `DEMO_ACCOUNT_PASSWORD` | The seeded demo account | That account only |
| `UPSTASH_REDIS_REST_TOKEN` | The rate-limiter's shared counters | Limits can be reset or read; no user data is stored there |

`STRIPE_PRICE_ID*` and `REVENUECAT_*_PRODUCT_ID` are configuration, not
secrets. They identify products; they authenticate nothing.

---

## Rotation

Rotate on any suspected exposure. Do not wait for proof — a key that *might*
have been published has to be treated as published, because there is no way to
find out who fetched it.

**`SUPABASE_SERVICE_ROLE_KEY`** — Supabase dashboard → Project Settings → API →
roll the `service_role` key. Update Vercel (all environments) and every local
`.env.local`. Rolling this invalidates the old key immediately, so deploy the
env change and redeploy together. Note that rolling the JWT secret rolls the
anon key too and will sign out every user.

**`STRIPE_SECRET_KEY`** — Stripe dashboard → Developers → API keys → roll.
Stripe supports overlapping validity: create the new key, deploy, then revoke
the old one, so checkout never breaks mid-rotation.

**`STRIPE_WEBHOOK_SECRET`** — Stripe dashboard → Developers → Webhooks → the
endpoint → roll the signing secret. Signature verification fails for events in
flight during the swap; Stripe retries, so events are not lost.

**`REVENUECAT_WEBHOOK_SECRET`** — RevenueCat dashboard → Integrations →
Webhooks → regenerate the authorization header value.

**`OPENAI_API_KEY`** — platform.openai.com → API keys → create new, deploy,
revoke old.

**`CRON_SECRET`** — generate any long random value (`openssl rand -hex 32`),
update it in Vercel, redeploy. Nothing else reads it.

After any rotation, check the Supabase and Stripe logs for use of the old key
between the suspected exposure and the revocation.

---

## Where the elevated credential is used, and why

`SUPABASE_SERVICE_ROLE_KEY` bypasses row level security. Every use is a
deliberate decision to step outside the policies, so every use is listed. The
same table is in the header comment of `src/lib/supabase/admin.ts`, next to the
code, because that is where somebody adding a thirteenth will be looking.

| Call site | Why it cannot use the user's own client |
|---|---|
| `api/stripe/webhook` | Stripe calls us. There is no session to scope to; the caller is proved by the signature |
| `api/revenuecat/webhook` | Same shape, same reason |
| `api/cron/leaderboard` | Ranks every athlete against every other. A user-scoped client sees one row |
| `api/cron/hybrid-reports` | Runs on a schedule with nobody signed in |
| `api/account/delete` | Deletes the auth user itself, which a user's own client cannot do |
| `api/hpe/admin/fleet` | Fleet-wide read, behind `resolveAdminRole` |
| `api/hpe/admin/rollout` | Fleet-wide write, behind `resolveAdminRole` and an audit row |
| `api/races` | Writes the shared known-race catalogue — reference data no user owns |
| `api/squads/join` | Reads a squad by invite code before the joiner is a member, so RLS cannot see it |
| `lib/supabase/ensure-profile` | Creates the profile row a brand-new user does not have yet |
| `lib/auth/admin-role` | Resolves the admin role — deliberately not through the user's own client, so a mistake in the `admin_users` policy cannot grant the role |
| `lib/auth/admin-audit` | Writes `admin_access_log`, which has no RLS policies at all — an admin able to read or edit the log of their own accesses defeats the point of keeping one |

**Adding a thirteenth means adding it here and in `admin.ts`.** If the reason is
"it was easier", it is the wrong client.

---

## The boundaries that enforce this

**`import "server-only"`** is the first line of `src/lib/supabase/admin.ts` and
`src/lib/auth/admin-role.ts`. The package's browser entry point throws at build
time, so importing either from anything that reaches a client bundle fails the
build. Before this, nothing but discipline stood between the service-role
client and a `"use client"` component.

**`npm run build` runs `scripts/check-client-bundle.mjs`** and fails the build
if a secret is found in `.next/static`. It looks for the secret itself, not for
mentions of it:

- JWTs are decoded and judged on their payload. `role: "service_role"` fails
  the build; `role: "anon"` passes, because the anon key belongs there. A
  prefix match would be useless — both keys share a byte-identical header.
- Literal `sk_live_`, `sk_test_`, `whsec_`, `sk-`, and private key blocks.
- `process.env.<SECRET>` in a client chunk, which means a server module got
  bundled. Limited by design: Next.js usually erases the identifier, so this is
  a backstop rather than the main defence.

It never prints the secret it finds. A CI log is not a safe place to put the
thing you are complaining about being in an unsafe place.

Run it by hand against an existing build with `npm run check:bundle`.

**Git history has been scanned** for committed `.env` files and key-shaped
strings across every branch, and is clean as of 2026-09-06. Re-run with:

```bash
git log --all -p | grep -aoE '(sk_live_|sk_test_|whsec_|sk-)[A-Za-z0-9_-]{16,}' | sort -u
```

A leaked key is fixed by **rotation, not by rewriting history**. Rebasing hides
the evidence and does nothing about the copy somebody already has.

---

## Environment configuration

- `.env*` is gitignored. No env file has ever been committed.
- **That includes `.env.example`**, which is therefore NOT in the repository —
  `git ls-files` has never listed it. It exists on developer machines and drifts
  from reality with nothing to catch it: two variables in use
  (`REVENUECAT_WEBHOOK_SECRET`, `DEMO_ACCOUNT_PASSWORD`) were missing from it,
  and the two Upstash variables are new. **The tables in this file are the
  authoritative list.** Tracking `.env.example` with a `!.env.example` negation
  would fix it and is a deliberate decision, not a tidy-up: it makes a file that
  currently cannot be committed committable, and the value of that depends on
  trusting that nobody ever pastes a real key into it.
- Secrets live in the Vercel project's environment variables, set per
  environment. **Production values must not be present in Preview** —
  preview deployments are built from branches and are reachable by URL.
- Local development uses `.env.local`, which is never committed and should hold
  development or test credentials rather than production ones.

> **Operator check, not verifiable from the repository:** whether Preview
> currently carries production values can only be seen in the Vercel dashboard.
> Worth confirming; it is the most common way a production key ends up
> somewhere it should not be.

---

## Rate limiting

Two layers, in `src/proxy.ts` and `src/lib/security/rate-limit.ts`:

1. **A per-instance burst guard.** In memory, no network, runs first. Not a real
   limit — that is the point of layer 2 — but it rejects a pathological flood
   without spending a Redis round trip on every request.
2. **Upstash Redis**, shared across every serverless instance. Per-route-class
   ceilings from `lib/security/config.ts`, keyed by the **authenticated user id**
   where there is one and by IP where there is not.

Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel. Without
them the limiter logs a warning once per cold start and falls back to layer 1
alone, which on a serverless deployment means the limit is 120/min multiplied by
however many instances are warm.

**It fails open.** If Redis is unreachable, requests are allowed and the failure
is logged. That is deliberate: this limiter guards ordinary application routes,
all of which are already behind authentication and RLS, and failing closed would
turn an Upstash outage into a total outage of a paid product. The endpoints where
failing open would be dangerous are not limited here at all — see below.

Webhooks and cron are never limited. A webhook's control is its signature;
throttling it only drops real events the provider then retries, which turns a
limiter into an outage in the billing path.

### Auth limits live in Supabase, deliberately

Sign-in, sign-up, OTP request, OTP verify and password reset are called by
`createBrowserClient` **directly against `<project>.supabase.co/auth/v1/*`**.
Those requests never reach this origin, so nothing in this repository can see
them, count them or limit them.

The mechanism in the path is GoTrue's own limiting. WP13.5 asks that the two be
coordinated so they cannot silently disagree, and the way to guarantee that is
to have one mechanism rather than two — a second limiter here would see a
fraction of the traffic and disagree with the real one by construction.

> **Operator task.** Set these in Supabase → Authentication → Rate Limits. They
> are recorded in `SUPABASE_AUTH_RATE_LIMITS` in `src/lib/security/config.ts`
> because a number that lives only in a dashboard is a number nobody reviews.
>
> | Setting | Value |
> |---|---|
> | Sign-in / sign-up per hour per IP | 30 |
> | OTP / magic-link sends per hour | 3 |
> | OTP verification attempts | 5 |
> | Password reset emails per hour | 3 |
> | Token refreshes per 5 min | 150 |
>
> Also confirm **email confirmation is enabled**. Migration 058 requires a
> confirmed address to log a session, and the impact query at the top of that
> file must be run before it is applied.

---

## What protects the data

Stated plainly because it is easy to assume the wrong thing:

**Row level security is the control, not network isolation.** Supabase
deliberately exposes PostgREST to the internet and ships the anon key in the
browser. Both are correct. It follows that any RLS policy returning a row to
`anon` returns it to everyone, and no firewall changes that.

Every table with a `user_id` column is owner-only. Anything another athlete is
meant to see goes through a named view — see migration 056 and
`src/lib/social/public-projections.test.ts`, which fails the build if a policy
regresses or a projection grows a column it should not have.

**Special category health data requires explicit consent** under Article 9. The
gate is server-side on every path that touches it, the consent log is
append-only, and withdrawal deletes rather than hides. See migration 057 and
`src/lib/consent/article9.ts`.

---

## Known gaps

Listed because a security document that only describes what works is
marketing. Full detail and severities are in
[AUDIT-split-index.md](AUDIT-split-index.md).

- **No structured security logging.** No auth failures, rate-limit trips or
  entitlement denials are recorded, so there is no alert path and little to read
  after an incident. (Audit H6.)
- **The GoTrue session settings are unverified from here.** Session lifetime,
  refresh rotation, single-use reset and OTP tokens are all Supabase behaviours
  this application never touches, so there is nothing in the test suite that can
  prove them. They need an integration test against a live project. (Audit M7.)
- **No HSTS header**, and the production CSP allows `'unsafe-inline'` for
  scripts. (Audit M8, M9.)
- **Postgres error text reaches clients** in roughly 23 route files, carrying
  constraint and column names. (Audit M1.)
- **Most routes still have no schema at the boundary** — 3 of ~40. (Audit N1.)

---

*Last reviewed: 2026-09-06.*
