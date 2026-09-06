# AUDIT — Split Index

**Phase 0 of `CLAUDE-CODE-BRIEF-cross-project-hardening-audit.md` v1.0**
Run date: 2026-09-06 · Branch: `hybrid-plan-engine` @ `adb35c5` · Auditor: Claude Code
**No application code was changed during this audit.** This file is the only artefact.

---

## Status — updated 2026-09-06

Phase 0 ran on `adb35c5`. The findings below are the record of what was found
then and are **not rewritten** as they are fixed — a standing audit is only
re-runnable if you can still see what the last run said. Each finding carries
its current status inline; this table is the summary.

| Finding | Status | Closed by |
|---|---|---|
| C1 `profiles` full row to `anon` | **CLOSED** | `5e70dd8` |
| C2 `strength_scores` bodyweight to `anon` | **CLOSED** | `5e70dd8` |
| C3 readiness/fatigue to `anon` | **CLOSED** | `5e70dd8` |
| C4 `workout_scores` blob to `anon` | **CLOSED** | `5e70dd8` |
| L6 `challenge_participants` | **CLOSED** | `5e70dd8` |
| H1 Article 9 consent absent | **CLOSED** | `604a095` |
| H5 no CI | **CLOSED** | `2c4cefe` |
| H4 no build-time key gate | **CLOSED** | `8d9096a` |
| L3 no SECURITY.md | **CLOSED** | `8d9096a` |
| M1 database error text to clients | **CLOSED** | `c467470` |
| M2 provider error text in a redirect URL | **CLOSED** | `0dd3d55` |
| H3 per-instance rate limiting | **CLOSED** | `76b9d6b` |
| H7 email verification never enforced | **CLOSED** | `76b9d6b` |
| H8 Engine palette fails WCAG at 2.50:1 | **CLOSED** | `5525455` |
| M3 PremiumGate exposes the value in the DOM | **CLOSED** | `5525455` |
| M13 no accessibility statement, no skip link | **CLOSED** | `5525455` |
| L1 muted-foreground fails text AA | **CLOSED** | `5525455` |
| M4 no getEntitlements, no matrix test | **CLOSED** | `1d6976c` |
| M7 session/refresh left at defaults | **PARTIAL** — values recorded and made an operator task; GoTrue behaviour still unverifiable from here | `76b9d6b` |
| H2 no boundary validation | **PARTIAL** — 3 routes of ~40; **and materially corrected, see the finding** | `4f10902` |
| M11 no central config / bounds | **PARTIAL** — module exists; a second set of bounds still lives in the scoring guard | `4f10902` |
| Everything else | **OPEN** | — |

Zero Critical findings remain open. The brief's gate for a growth push is WP1,
WP2, WP6 and WP13 complete: **WP1 done, WP2 done, WP6 open, WP13 open.**

### Corrections to Phase 0 itself

Two things the first run got wrong, recorded rather than quietly amended:

1. **H2 overstated the gap.** "No server-side schema validation on any API
   route" was true and remains true. But the finding read as "nothing is
   validated", and that is wrong. `src/lib/scoring/input-guards.ts` is a real
   guard layer with plausibility limits on duration, distance, load,
   bodyweight, heart rate, power, pace and elevation, plus bodyweight-relative
   checks that distinguish a 700kg leg press from a 700kg bench press. Several
   routes validate ad hoc and validate well. Measured: of eight hostile
   payloads fired at `POST /api/activities` on `adb35c5`, five were already
   refused with a 4xx and no write. See H2 for what was actually missing.

2. **The Phase 0 severity table counted 33 findings and four Criticals.** That
   stands, but C1–C4 were one defect in four places sharing one fix, which the
   triage said and the count did not. Worth remembering when reading the
   headline number: severity counts measure exposure, not work.

---

## How to read this document

Every finding carries a severity, a work package, and evidence you can re-check
yourself — a file and line, or a command and its output. Where I could not verify
something, it says so rather than guessing.

**Severities** are the brief's, not mine:
**Critical** = one account's data reachable by another, or a secret exposed, or money taken
incorrectly. **High** = a control is absent that would contain a Critical if one existed.
**Medium** = a control is present but incomplete or untested. **Low** = hygiene.

### Scope limit you need to know before acting on Part A

Every RLS finding below is read from **migration source**, not from the live database. I
have no credentials for the production Supabase project from this environment, so I could
not run the `pg_policies` / `pg_tables` enumeration the brief asks for. Migration source and
a live database can disagree — a policy edited in the Supabase dashboard, or a migration
that never applied, would not show up here. Migration `049` exists precisely because a
version-number collision meant a privacy fix silently never applied to any database that had
already taken the other `046`, so this is a demonstrated failure mode in this project, not a
hypothetical one.

**Before fixing anything in WP1, run the enumeration against production and reconcile it
with this document.** If the live database is worse than the source, the findings get worse.
If it is better, some of them close for free. Either way the answer belongs in the test, and
the test is what closes the work package.

---

## 1. Inventory

| | |
|---|---|
| **Stack** | Next.js 16.2.10 (App Router), React 19.2.4, TypeScript 5, Tailwind 4 |
| **Hosting** | Vercel (`.vercel/project.json`); one cron in `vercel.json` |
| **Native** | Capacitor 8 iOS + Android, wrapping the deployed web app via `server.url` |
| **Database** | Supabase Postgres — 45 tables in `public`, 55 migrations |
| **Auth** | Supabase Auth (GoTrue): email+password, OAuth, email OTP |
| **Payments** | Stripe (web, live) + RevenueCat (native, wired) |
| **AI** | OpenAI (`openai` ^6.45.0), server-side |
| **Takes money** | **Yes** — monthly, annual and lifetime SKUs |
| **Holds personal data** | **Yes** — name, username, email, age, sex, country, bodyweight, height, max HR |
| **Holds special category data** | **Yes** — PAR-Q, chest pain on exertion, injury history and sites, surgery, pregnancy/postpartum status, medication affecting HR, low-energy-availability screen incl. amenorrhoea and bone stress injury |
| **Accepts user uploads** | **No** — avatars are a fixed preset set (`src/lib/constants/avatars.ts`); an `avatars` storage bucket exists (mig. 010) but no upload path ships |
| **Sends email** | Transactional only, via Supabase Auth. No marketing sender. |
| **Public** | Yes — marketing site, `/privacy`, `/terms`, public profile pages at `/social/profile/[username]` |
| **Test suite** | 98 files, **1347 tests, all passing** (`npx vitest run`, 14.7s) |
| **CI** | **None.** `.github/` contains prompt assets only — no workflows. |

The special-category inventory is not inferred. It is the literal field list at
[intake-record.ts:197](src/lib/scoring/hpe/intake-record.ts#L197):

```
health:   parq_positive, chest_pain_on_exertion, current_injury_limiting,
          injury_last_12_weeks, injury_sites, surgery_last_6_months,
          pregnant_or_postpartum_12wk, medication_affecting_hr
fuelling: lea_restricted_food, lea_trains_fasted, lea_unintended_weight_loss,
          lea_bone_stress_injury, lea_amenorrhoea
```

That is Tier 2 under the brief's Article 9 position, unambiguously and by design — those
questions exist to determine health status. Everything downstream of them inherits the
classification.

---

## 2. Applicability matrix

| WP | Area | Status | Note |
|---|---|---|---|
| §1 | Central security config module | **Applicable** | Absent. No `lib/security/config.ts` or equivalent; limits are inline literals. |
| WP1 | RLS and ownership | **Applicable** | RLS on 45/45 tables. Four policies expose owned rows to `anon`. |
| WP2 | Secrets and env hygiene | **Applicable** | History clean; no build-time gate. |
| WP3 | Server-side validation | **Applicable** | Zero routes validate at the boundary. |
| WP4 | Rate limiting | **Applicable** | Present but architecturally ineffective on Vercel. |
| WP5 | Error handling | **Applicable** | DB error text reaches clients in 23 route files. |
| WP6 | Roles and entitlements | **Applicable** | Admin role **already shipped** — see contradiction note below. |
| WP7 | Security and audit logging | **Applicable** | Absent apart from one table (`hpe_rollout_audit`). |
| WP13 | Authentication hardening | **Applicable** | OAuth callback issue **already fixed**. Verification gap remains. |
| WP14 | Deployment and transport | **Applicable** | Most headers present. HSTS absent. |
| WP8 | Indexes and projections | **Applicable** | Good ownership-path coverage; leaderboard and set-history gaps. |
| WP9 | Async work | **Applicable** | Two Vercel crons exist; heavy work still in the request path. |
| WP10 | Load testing | **Applicable** | Not started. Produces a finding, not a fix. |
| WP11 | Compliance surface | **Applicable** | Privacy + terms shipped. Article 9 consent absent. |
| WP12 | Accessibility | **Applicable** | Measured contrast failure in one brand palette. |
| D0 | Honest read | **Applicable** | Read and accepted; no code. |
| D1 | Cold-start payoff | **Applicable** | Onboarding calibration exists; CSV import bootstrap does not. |
| D2 | Funnel instrumentation | **Applicable** | Absent entirely. |
| D3 | Remote paywall config | **Applicable** | Pricing is hard-coded in `lib/pricing/config.ts`. |
| D4 | Share mechanics | **Applicable** | Share cards ship; no referral token, no invite-rate measurement. |
| D5 | Multi-page paywall | **Applicable** | Single-screen billing page today. |
| — | DMCA agent registration | **N/A — no third-party works hosted.** Revisit when user uploads ship. Policy page still owed. |
| — | CCPA / CAN-SPAM | **N/A — settled in the brief.** UK-first; PECR is the applicable email regime. |
| — | Redis / ECS / K8s | **N/A — rejected in the brief.** Vercel and Supabase already do this. |
| — | PECR marketing email | **N/A today** — no marketing sender exists. Becomes Applicable the day one ships. |

### Contradictions with the brief — shipped code wins

The brief was written from architecture notes, and two of its premises are out of date. Per
its own instruction I am flagging rather than overwriting:

1. **"Split Index has no admin role"** (WP6). It does. Migration `041_admin_roles_and_fleet_review.sql`
   creates `admin_users` with an `operator`/`viewer` split, and
   [admin-role.ts](src/lib/auth/admin-role.ts) resolves it through the service-role client
   with a written justification, no `grantAdmin` function, and no INSERT policy — grants
   happen by migration or by an operator acting knowingly. This is close to what WP6.1 asks
   for and better than what WP6.1 describes. WP6 narrows to entitlements, not roles.

2. **"If the OAuth callback issue is still outstanding"** (WP13.7). It is not.
   [auth/callback/route.ts](src/app/auth/callback/route.ts) exchanges the code, verifies the
   OTP, calls `getUser()`, ensures the profile, and redirects with a session established.
   What is missing is the **regression test**, not the fix.

A third is worth stating because it changes sequencing rather than a fact: the brief assumes
tests are the deliverable. **This repository has 1347 passing tests and no CI.** Nothing runs
them on push. Every acceptance criterion in the brief is a test, and a test nothing runs is a
comment. See H5.

---

## 3. Findings

### CRITICAL

---

#### C1 — Every column of `profiles` is readable by anyone holding the public anon key
> **CLOSED `5e70dd8`.** Replaced by the `public_profiles` view — twelve columns, `anon`-readable. Bodyweight, height, age, sex and `stripe_customer_id` are no longer reachable.
**WP1 · Evidence: [001_initial_schema.sql:338](supabase/migrations/001_initial_schema.sql#L338)**

```sql
CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (username IS NOT NULL);
```

No `TO authenticated` clause, so this applies to `public`, which includes `anon`. Supabase
grants `anon` SELECT on `public` tables by default and I found no `REVOKE` anywhere in the
55 migrations (`grep -rni "revoke" supabase/migrations/` returns only prose in comments).

The policy is row-scoped but **not column-scoped**, and RLS has no column dimension. So the
row it returns for every athlete who has set a username is the whole row:

```
age, height_cm, weight_kg, max_hr, gender, country, bio,
subscription_tier, subscription_status, stripe_customer_id, ...
```

Anyone who opens the network tab, takes the anon key, and issues
`GET /rest/v1/profiles?select=*` gets bodyweight, height, age, sex and Stripe customer ID
for the entire user base. The intent — let a public profile page show a username and an
avatar — is legitimate. The implementation exposes the table behind it. This is exactly
WP1.4: a public projection must be a view over the columns it needs, never the underlying
rows.

**Fix shape:** a `public_profiles` view exposing `username, display_name, avatar_url,
country, current_*_index` only; drop this policy; point the profile page and leaderboard at
the view.

---

#### C2 — Per-set bodyweight history for every user is readable by `anon`
> **CLOSED `5e70dd8`.** `public_strength_scores` drops `bodyweight_kg` **and** `relative_strength` — the ratio is 1RM/bodyweight, so keeping it beside `estimated_1rm_kg` would have let anyone recover the weight by division.
**WP1 · Evidence: [012_public_read_strength_scores.sql:7](supabase/migrations/012_public_read_strength_scores.sql#L7)**

```sql
CREATE POLICY "Public leaderboard strength scores" ON strength_scores FOR SELECT USING (true);
```

`strength_scores` carries `bodyweight_kg`, `estimated_1rm_kg`, `relative_strength`,
`exercise_name`, `recorded_at` and `user_id` per scored exercise
([002:43-58](supabase/migrations/002_scoring_reference_and_leaderboards.sql#L43)). `USING (true)`
returns all of it to `anon`.

Joined to C1 on `user_id`, this is a named, timestamped bodyweight series per athlete. The
migration's own comment explains the reasoning honestly — the By Exercise and By Muscle Group
leaderboards need to read everyone's rows — and reaches for the widest possible policy to get
there. The leaderboard needs `exercise_name` and `strength_index`. It does not need
`bodyweight_kg`.

---

#### C3 — Readiness and fatigue history is readable by `anon`
> **CLOSED `5e70dd8`.** `public_index_history` carries the four index columns and the timestamp. `fatigue_score` and `recovery_score` are gone.
**WP1, WP11 · Evidence: [001_initial_schema.sql:356](supabase/migrations/001_initial_schema.sql#L356)**

```sql
CREATE POLICY "Public leaderboard index" ON split_index_history FOR SELECT USING (true);
```

`split_index_history` holds `fatigue_score` and `recovery_score` per snapshot
([001:144-155](supabase/migrations/001_initial_schema.sql#L144)). Under the brief's own Article 9
position, "any readiness or interference output that characterises the user's physical
condition" is **Tier 2 special category data**. WP11.5 requires Tier 2 to be owner-only at
the database layer and excluded from every projection reachable by `anon`. This policy is
the direct opposite of that requirement, for every user, since migration 001.

This is the finding I would close first. It is a one-line severity difference from C2 in
mechanism and a large one in consequence: C2 leaks personal data, C3 leaks special category
data.

---

#### C4 — `workout_scores` including its free-form `score_breakdown` is readable by `anon`
> **CLOSED `5e70dd8`.** `public_workout_scores` projects eight named JSON paths instead of the blob, so a future scoring change cannot leak through it.
**WP1 · Evidence: [001_initial_schema.sql:352](supabase/migrations/001_initial_schema.sql#L352)**

```sql
CREATE POLICY "Public leaderboard scores" ON workout_scores FOR SELECT USING (true);
```

Same mechanism. The aggravating factor here is `score_breakdown JSONB DEFAULT '{}'`: an
unconstrained blob written by the scoring engine
([activity-scorer.ts:293,341](src/lib/scoring/activity-scorer.ts#L293)). Today it holds
`strength_result`. Nothing prevents a future engine change from putting bodyweight, HR or a
readiness figure in there, and that change would be a data breach with no code review signal
attached to it — the policy is in a file nobody would open.

`challenge_participants` (001:377) has the same `USING (true)` shape but carries only
challenge progress; it is Low, not Critical, and is listed at L6.

---

### HIGH

---

#### H1 — Special category data is collected with no Article 9 consent, no record, and no withdrawal path
> **CLOSED `604a095`.** Append-only consent log, server-side gate on every Tier 2 path, one-action withdrawal that deletes. The DPIA and ICO registration in H9 remain open and are **not** closed by it.
**WP11 · Evidence: `grep -rn -i "consent" supabase/migrations/` → no consent table.
`grep -n -i "consent" src/components/hybrid-plan/intake-wizard.tsx` → no matches.**

The HPE intake asks for PAR-Q status, chest pain on exertion, injury history and sites,
recent surgery, pregnancy/postpartum status, medication affecting heart rate, and a
low-energy-availability screen including amenorrhoea. The wizard collects and stores these
with no consent gate whatsoever. There is no consent table, no consent event, no record of
wording or version, and no withdrawal action in settings.

`PATCH /api/hpe/intake` writes them straight to `hpe_intake` after an allowlist on field
*names* — [route.ts:57-64](src/app/api/hpe/intake/route.ts#L57).

The privacy policy is aware of the gap and hedges it rather than closing it
([privacy/page.tsx:141-146](src/app/privacy/page.tsx#L141)):

> "Health and fitness data may constitute special category data. Where applicable, we process
> this data based on your explicit consent and/or because it is necessary for the provision
> of our fitness analytics service at your request."

"Explicit consent and/or necessity" is not a lawful basis; it is two of them in a trench
coat. Article 9 has no "necessary for the service" condition for a commercial fitness
product — that is Article 6 reasoning applied to an Article 9 problem. And an explicit
consent that was never asked for cannot be evidenced. Per WP11: a consent you cannot evidence
is a consent you do not have.

Severity is High rather than Critical strictly by the brief's definitions — no account's data
is reachable by another *through this finding*. It is nonetheless the top of the High list
and, with C3, the pair I would put in front of a solicitor first.

**Note the dependency:** WP11.2 requires the app to stay fully usable if consent is refused,
with refusal disabling only the Hybrid Plan Engine and the injury Risk Index. Tier 2 answers
currently feed `hpe_athlete_profile`, plan generation and the safety engine. Whether that
separation is clean is the thing to establish before writing the consent gate — if it is
awkward, the brief is explicit that this is a signal the tiers are entangled in the schema,
not a reason to bundle the consent.

---

#### H2 — No server-side schema validation on any API route
**WP3 · Evidence: `grep -rn 'from "zod"' src/app/api` → zero matches, across 47 route files.**

`zod` is a dependency and is used in exactly one place: `src/components/activities/form-state.ts`
— a **client** component. That is the brief's opening line in WP3 made literal: client-side
validation is a UX feature, not a security control, and here it is the only *schema* validation there is.

> **CORRECTED, and PARTIALLY CLOSED `4f10902`.** The sentence above is accurate;
> the finding as originally written was not, because it read as "nothing is
> validated". It is not.
>
> `src/lib/scoring/input-guards.ts` is a real guard layer with plausibility
> limits on duration, distance, load, bodyweight, heart rate, power, pace and
> elevation — plus bodyweight-relative checks that know a 700kg leg press is
> ordinary and a 700kg bench press is not, which is a judgement no fixed bound
> makes. Routes validate ad hoc too, and several validate well: the HRV
> endpoint bounds rMSSD, reactions bound 1–10, comments cap length, the rollout
> endpoint insists on a reason of at least eight characters.
>
> **Measured rather than asserted.** Eight hostile payloads fired at
> `POST /api/activities` on `adb35c5`: five refused with a 4xx and no write.
> The three that were not — bodyweight of zero, unknown sport, unknown key —
> failed as **500s**. Nothing was written, which is the important half. But a
> 500 is the engine throwing partway through a request that had already done
> work: no field message for the athlete, a stack trace in the log, and no way
> to tell a hostile payload from an outage.
>
> What was genuinely missing, and is now fixed for three routes: parsing at the
> boundary rather than mid-handler, 4xx instead of 5xx, unknown-key rejection,
> enum validation, and field-level messages. What remains is listed at N1.

Two representative cases:

- **`PATCH /api/hpe/intake`** allowlists field *names* and then writes the values untouched
  ([route.ts:57-64](src/app/api/hpe/intake/route.ts#L57)). `values` is `Record<string, unknown>`.
  Any type, any magnitude, straight into the special-category table.
- **`GET /api/social/leaderboard`** casts query strings directly to typed enums with no check
  ([route.ts:33-38](src/app/api/social/leaderboard/route.ts#L33)):
  `const period = (searchParams.get("period") ?? "all_time") as LeaderboardPeriod;`
  The `as` is a lie to the compiler about a value from the network.

No plausibility bounds exist anywhere, so the §1 rejection rule ("reject, never silently
clamp") has nothing to enforce. Database `CHECK` constraints do catch some of this — `activities`
bounds heart rate 40–230 and `profiles` bounds age 13–120 — but a constraint violation surfaces
as a 500 with a Postgres error string (see M1), not a 400 with a field message.

---

#### H3 — Rate limiting is in-process, so it does not survive the deployment model
> **CLOSED `76b9d6b`.** Upstash Redis, shared across instances, per-route-class ceilings, keyed by the verified user id. The in-memory guard survives as a first-layer burst doorman. Auth routes are explicitly out of scope and stay with GoTrue — see the finding's own note and SECURITY.md.
**WP4 · Evidence: [src/proxy.ts:12](src/proxy.ts#L12)**

```ts
const hits = new Map<string, { count: number; resetAt: number }>();
```

A `Map` in module scope. On Vercel every serverless instance has its own, instances scale
horizontally under exactly the load that matters, and a cold start resets the counter. The
comment calls it "best-effort per-instance," which is accurate and is the problem: the
effective limit is 60/min × instance count, and an attacker's request distribution across
instances is not something we control.

Against §1 specifically:
- One flat limit (60/min) for every API route, keyed by **IP only** — no user-ID keying, so
  `RATE_LIMIT_WRITE_PER_MIN` vs `RATE_LIMIT_READ_PER_MIN` vs `RATE_LIMIT_LEADERBOARD_PER_MIN`
  do not exist as distinct concepts.
- Auth routes are **not covered at all** — the comment notes login/signup go straight to
  GoTrue from the browser, which is true, so `RATE_LIMIT_AUTH_PER_MIN` and
  `RATE_LIMIT_OTP_RESEND_PER_HOUR` are delegated to Supabase's defaults, unset and unmeasured
  by us. WP13.5 requires per-account *and* per-IP limiting coordinated with WP4; neither half
  is ours today.
- `X-Forwarded-For` is taken as the first hop with no trusted-proxy check
  ([proxy.ts:16](src/proxy.ts#L16)). On Vercel the platform header is reliable, but the code
  does not encode that assumption anywhere.

Correctly done: `/api/stripe/webhook` and `/api/cron` are exempt (WP4.4), and the Stripe
webhook does verify its signature before acting
([webhook/route.ts:26-32](src/app/api/stripe/webhook/route.ts#L26)). That half of WP4 needs a
test, not a change.

---

#### H4 — No build-time gate stops a server key reaching the client bundle
> **CLOSED `8d9096a`.** `npm run build` now runs a client-bundle scanner that exits non-zero on a service-role JWT, a Stripe/OpenAI secret or a `process.env.<SECRET>` read. Proven end to end by planting a fabricated key in a `"use client"` component: build exits 1, names the chunk, and exits 0 once removed. `import "server-only"` added to both elevated-credential modules, and the Stripe webhook's duplicate factory removed.
**WP2 · Evidence: `grep -rn "server-only" src/` → no `import "server-only"` anywhere. No CI.**

The good news first, because it is genuinely good:

- `.env*` is gitignored ([.gitignore:34](.gitignore#L34)); `git ls-files | grep -E '\.env'` is empty.
- **Git history is clean.** A full-history scan for `sk_live_`, `sk_test_`, `whsec_`, Supabase
  JWT and OpenAI key patterns across every branch returned nothing.
- The `NEXT_PUBLIC_` surface is correct and minimal — `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
  `APP_URL`, and the two RevenueCat *publishable* keys. No secret is public-prefixed.
- Service-role use is confined to three modules and nine route files, all server-side today.

What is missing is the thing that keeps it true tomorrow. WP2.2 asks for a build-time grep of
the client bundle that **fails the build**, explicitly because this must not be a code-review
convention. There is no such gate, and with no CI (H5) there is nowhere to hang one.
WP2.5 asks that every elevated-credential call site sit in a module importing `server-only`;
none do, so nothing but convention stops
[`src/lib/supabase/admin.ts`](src/lib/supabase/admin.ts) being imported from a `"use client"`
component, where `SUPABASE_SERVICE_ROLE_KEY!` would inline as `undefined` in dev and — with
the wrong bundler configuration — as itself.

`SECURITY.md` (WP2.6) does not exist.

---

#### H5 — There is no CI, so no acceptance criterion in this brief can be load-bearing
> **CLOSED `2c4cefe`.** Tests and typecheck block on push and PR; lint runs non-blocking with its remaining count documented in the workflow.
**Cross-cutting · Evidence: `find .github -type f` → prompt assets only, no `workflows/`.**

1347 tests pass locally. Nothing runs them on push, on PR, or before deploy. Vercel builds
run `next build`, which type-checks but does not run vitest.

This is structural rather than a vulnerability, and I am raising it as High because it gates
the brief's entire method. WP1 wants a test that fails if any table has `rowsecurity = false`.
WP2 wants a build that fails on a planted key. WP14 wants an automated header and TLS check
in CI. Every one of those is a gate, and a gate that nothing runs is a comment. **Fix this
before or alongside the first work package**, or each subsequent "proof" is proof only on the
machine that happened to run it.

---

#### H6 — No structured security or audit logging exists
**WP7 · Evidence: no logging module in `src/lib`; `console.*` in 9 route files; one audit table.**

There is no logger, no correlation ID, no structured event shape. What exists is bare
`console.log`/`console.error` in nine files, and `hpe_rollout_audit` (mig. 041) covering
admin rollout changes only.

None of WP7's event types are recorded: auth successes and failures, rate-limit trips,
entitlement denials, admin *reads* (only rollout writes are audited), elevated-credential
queries, payment webhook events, or 5xx responses. There is consequently no alert path for
repeated auth failure or repeated entitlement denial from one account — the latter being, as
the brief notes, the signature of someone probing the paywall.

The compensating fact worth recording: because there is no logger, there is currently **no
risk of health values leaking into logs**, which is WP7's other half. That inverts once a
logger exists — the redaction rule needs to be written into it on day one, not retrofitted.
`console.error("[auth/callback] Sign-in failed:", { reason, detail, next })`
([callback/route.ts:24](src/app/auth/callback/route.ts#L24)) logs a raw provider error string
today and is the shape of the mistake to avoid.

---

#### H7 — Email verification is never enforced anywhere in the application
> **CLOSED `76b9d6b`.** Migration 058: a RESTRICTIVE INSERT policy on activities, gym_exercises and workout_scores requiring a confirmed address, and every public projection joined to `auth.users`. Enforced in RLS rather than the API, because the anon key is in the browser and a direct PostgREST insert would bypass a route check. **The impact query at the top of 058 must be run before it is applied.**
**WP13.3 · Evidence: `grep -rn "email_confirmed_at\|confirmed_at" src/` → zero matches.**

Nothing in the codebase reads the verification state. Supabase may be configured to require
confirmation before issuing a session — that is a dashboard setting I cannot read from here —
but the application does not check, so it cannot be relied on and it is not tested. If that
setting is ever off, or is bypassed by an OAuth path, an unverified account can log sessions
and appear in the leaderboard projection, which WP13.3 identifies as a spam vector on a
public list.

The cron that builds the leaderboard filters on `username IS NOT NULL` and a non-null index
([cron/leaderboard/route.ts:33-37](src/app/api/cron/leaderboard/route.ts#L33)) — not on
verification.

---

#### H8 — The Engine palette fails WCAG 2.2 AA at 2.50:1, below even the non-text threshold
> **CLOSED `5525455`.** Tuned variants at 5.26:1 (text) and 3.52:1 (icons/borders), scoped to the light surfaces so the dark shell — where the same blue is 7.80:1 — is untouched. Two further failures surfaced in the light-mode token remap that Phase 0 had not measured: cardio-mode muted text at 3.04:1, and **white on the accent fill at 2.60:1**, which made every primary button label in cardio mode less legible than its button. All measured by a test that reads the shipped tokens.
**WP12 · Evidence: measured, computed from the shipped tokens.**

The brief predicted colour would be the likely conformance failure and asked for measured
ratios rather than impressions. Here they are, computed from
[`src/lib/design/tokens.ts`](src/lib/design/tokens.ts) and
[`src/app/globals.css`](src/app/globals.css) using the WCAG 2.x relative-luminance formula:

| Pairing | Ratio | 4.5:1 text | 3:1 non-text |
|---|---:|---|---|
| `#3DFF6E` on `#060606` — Lab accent on app bg | **15.17:1** | PASS | PASS |
| `#3DFF6E` on `#070908` — Lab accent on gym bg | **14.96:1** | PASS | PASS |
| `#04120A` on `#3DFF6E` — accent foreground | **14.35:1** | PASS | PASS |
| `#3BA6FF` on `#060606` — Engine accent on app bg | **7.80:1** | PASS | PASS |
| **`#3BA6FF` on `#F7FBFF` — Engine accent on cardio bg** | **2.50:1** | **FAIL** | **FAIL** |
| **`#3BA6FF` on `#FFFFFF` — Engine accent on white** | **2.60:1** | **FAIL** | **FAIL** |
| **`#6BB8FF` on `#F7FBFF` — Engine accent-soft on cardio bg** | **2.03:1** | **FAIL** | **FAIL** |
| `#A1A1AA` on `#060606` — muted | 7.91:1 | PASS | PASS |
| `#71717A` on `#060606` — muted-foreground | **4.19:1** | **FAIL** | PASS |
| `#A8B5AC` on `#070908` — gym muted | 9.39:1 | PASS | PASS |
| `#EAB308` / `#EF4444` / `#22C55E` on `#060606` | 10.57 / 5.38 / 8.89:1 | PASS | PASS |

The Lab palette (neon green on black) is excellent — 15:1 is far above requirement. The
**Engine palette is the failure**: sky blue on a near-white cardio surface at 2.50:1 does not
meet the 4.5:1 text threshold and does not meet the 3:1 non-text threshold either, so it
fails as an icon, a border or a chart line as well as as text. `--cardio-accent-soft` at
2.03:1 is worse.

Per WP12.2 the fix is a tuned variant for use on light surfaces, not abandoning the palette —
the same hue darkened to roughly `#0B6FC4` clears 4.5:1 on `#F7FBFF` while reading as the same
blue. `--muted-foreground` at 4.19:1 is a near miss and is filed separately at L1.

Reproduce: `node scratchpad/contrast.mjs` (script preserved in the session scratchpad; it is
40 lines and should move into the repo as the WP12 test).

---

#### H9 — DPIA absent; ICO registration unevidenced
**WP11.6, WP11.7 · Stephen's actions, not code changes. Flagged per brief instruction.**

Large-scale processing of health data with profiling makes a DPIA effectively mandatory, and
it is also the artefact that would record the Tier 1 contract-necessity reasoning the brief
sets out. No DPIA exists in `docs/`. No evidence of ICO registration or payment of the data
protection fee exists in the repository, which is where I can look — if it has been done,
this closes with a note; if not, it is a legal requirement for a UK controller at the lowest
fee tier.

---

### MEDIUM

---

#### M1 — Postgres error text is returned to clients in 23 route files
> **CLOSED `c467470`.** 44 sites across 29 route files — the Phase 0 count of 23 was low, because `grep error.message` is case-sensitive and misses `fetchError.message` and its siblings. Replaced with `serverError()` / `databaseError()`: a sentence and a correlation id to the client, the detail to the log. Known unique violations map to real messages by constraint name and return 409.
**WP5 · Evidence: `grep -rln 'error\.message' src/app/api` → 23 files, 41 sites.**

The pattern throughout:

```ts
if (error) return NextResponse.json({ error: error.message }, { status: 500 });
```
— [hpe/intake/route.ts:83](src/app/api/hpe/intake/route.ts#L83), and 40 others.

A Supabase/PostgREST error message carries constraint names, column names, sometimes the
failing value, and the schema shape. WP5 asks that a unique violation become "that username
is taken", not a constraint name. There is no error boundary, no correlation ID, and no
generic-response convention. `src/app/api/account/delete/route.ts:41` interpolates it into a
message that also names the table being purged.

The counter-example that shows the team knows how to do this:
[`src/lib/supabase/auth-errors.ts`](src/lib/supabase/auth-errors.ts) maps GoTrue error codes
to safe human messages. That module is the pattern to generalise, not to invent.

---

#### M2 — Raw auth provider error text is placed in a redirect URL
> **CLOSED `0dd3d55`.** `detail` is now set only in development. The rendered message was already safe — `resolveAuthPageError` gated the render — but the value was in the URL regardless, and browser history, the `Referer` header and any proxy log do not read that guard.
**WP5, WP13 · Evidence: [auth/callback/route.ts:26-27](src/app/auth/callback/route.ts#L26)**

```ts
if (detail) params.set("detail", detail.slice(0, 200));
```

`detail` is the raw Supabase error message. It lands in the query string of a page the user's
browser loads — so it enters browser history, the `Referer` header on any subsequent
outbound request, and any analytics or proxy log in between. The 200-character truncation
limits volume, not sensitivity. Map to a code, as `mapOAuthErrorReason` already does for the
`reason` parameter directly above it.

---

#### M3 — `PremiumGate` blurs the real value in the DOM, with no `aria-hidden`
> **CLOSED `5525455`.** Locked panels render nothing they hide — not blurred, not aria-hidden, absent. A shaped placeholder with fixed bar heights takes its place. Closes WP6.3 and WP12.7 together, as predicted.
**WP6.3, WP12.7 · Evidence: [premium-gate.tsx:27](src/components/analytics/premium-gate.tsx#L27)**

```tsx
<div className="pointer-events-none select-none blur-[2px] opacity-40">{children}</div>
```

No `aria-hidden`. The children render fully into the DOM; the blur is a CSS filter one
devtools toggle away, and a screen reader announces the value normally. This is precisely the
brief's line: a blurred number present in the DOM is not gated, it is decorated. It is also
one rule satisfying two work packages — WP6.3 and WP12.7 want the same change.

[`premium-tease.tsx:38`](src/components/premium/premium-tease.tsx#L38) does carry
`aria-hidden`, so the accessibility half is already right in one of the two components and
wrong in the other — worth noting because it means the fix has a house pattern to copy.

**Mitigating, and the reason this is Medium not Critical:** the analytics *page* already gates
the underlying data server-side. Free accounts get a 7-day history cutoff rather than 365
(`const historyCutoff = isoDaysAgo(premium ? HISTORY_DAYS : 7)`,
[analytics/page.tsx:46](src/app/\(app\)/analytics/page.tsx#L46)) and projections are computed
only when `data.isPremium`. So the payload is genuinely thinner for a free user. What WP6
still needs is the per-panel proof that **every** `PremiumGate` wraps only data the free user
was entitled to receive — that is the test, and it does not exist.

---

#### M4 — Entitlement is centralised in a function, but there is no `getEntitlements` and no matrix test
> **CLOSED `1d6976c`.** `getEntitlements` resolves plan, trial state, premium and admin once, from state only the payment webhooks write. The 21-case matrix (5 account states × 3 protected routes) **passes against the parent commit too** — the pre-existing gating was correct, and the finding was the absence of the test, not a defect. WP6.4's audit entry per admin access WAS missing and is the part with a real before/after. 17 call sites still resolve entitlement themselves; see N8.
**WP6.2, WP6.5 · Evidence: [`src/lib/premium/features.ts`](src/lib/premium/features.ts)**

Better than the brief assumes. `PREMIUM_FEATURES` is a single typed map, `canAccess` /
`canAccessProfile` are the one gate, and the tier is derived from
`profiles.subscription_tier` + `subscription_status`, written only by the Stripe and
RevenueCat webhooks — never from a client field. `isPremiumUser` handles trial state.

The gaps against WP6:
- No single `getEntitlements(userId)` that resolves plan + trial + premium in one server call;
  each route re-queries `profiles` for the two columns and calls `canAccessProfile` itself. It
  works, but the resolution logic is duplicated per route and can drift.
- **No matrix test.** WP6.5 wants free / trialling / premium / expired-premium / admin against
  every protected route. `src/lib/premium/features.test.ts` tests the map, not the routes.

---

#### M5 — Account deletion is correct by accident, non-atomic, and untested
**WP11.3 · Evidence: [account/delete/route.ts](src/app/api/account/delete/route.ts)**

The route hard-codes 19 tables, and the schema has 45. Missing from the list are the entire
HPE surface (`hpe_intake`, `hpe_injury_reports`, `hpe_athlete_profile`, `hpe_plans`,
`hpe_sessions`, `hpe_session_feedback`, `hpe_generation_events`), plus
`hybrid_athlete_reports`, `predicted_benchmarks`, `planned_races`, `sleep_logs`,
`activity_comments` and `activity_reactions`.

**They are nonetheless deleted** — every one of them declares
`user_id ... REFERENCES auth.users(id) ON DELETE CASCADE`, and `admin.auth.admin.deleteUser`
runs last, so the cascade catches them. I verified this per table rather than assuming it.
Deletion is therefore *complete today*.

It is Medium because it is complete for a reason the code does not state and nothing checks:

- The explicit list adds nothing the cascade does not already do, and its incompleteness reads
  as a bug to the next person, who may "fix" it by adding tables rather than deleting the list.
- The loop **returns 500 on the first table error**, before `deleteUser` runs. That leaves a
  half-purged account with a live login — the worst of both outcomes, and unrecoverable
  without operator action.
- No test asserts a deleted user leaves zero rows anywhere, which is the WP11 acceptance
  criterion and the only thing that would keep this true as tables are added. A new table
  without the cascade would break deletion silently.

---

#### M6 — `CRON_SECRET` is accepted from the query string
**WP2, WP7 · Evidence: [cron/leaderboard/route.ts:19-22](src/app/api/cron/leaderboard/route.ts#L19)**

```ts
const secret = searchParams.get("secret") ?? request.headers.get("authorization")?.replace("Bearer ", "");
return secret === process.env.CRON_SECRET && !!process.env.CRON_SECRET;
```

A secret in a URL lands in access logs, proxy logs and any error report that captures the
request URL. `.env.example` documents the Bearer header as the intended mechanism; the query
parameter is the fallback that undoes it. The comparison is also non-constant-time — a
genuinely marginal concern over a network, listed only for completeness. The `&& !!` guard
correctly prevents an unset env var from making the endpoint public, which is the failure that
would actually matter.

Same pattern in `cron/hybrid-reports`.

---

#### M7 — Session lifetime and refresh behaviour are Supabase defaults, not decisions
> **PARTIALLY CLOSED `76b9d6b`.** The intended values are now recorded in `SUPABASE_AUTH_RATE_LIMITS` and `SESSION_MAX_AGE_S` and carried into SECURITY.md as an operator task, so they are reviewable rather than living only in a dashboard. Still open: nothing here can verify GoTrue actually applies them — see N5.
**WP13.2 · Evidence: `grep` finds no session config; `src/lib/supabase/*.ts` uses `@supabase/ssr` defaults.**

§1 specifies `SESSION_MAX_AGE_S`, `REFRESH_ROTATE`, `RESET_TOKEN_TTL_S`, `OTP_TTL_S` and
`OTP_MAX_ATTEMPTS`. None are expressed anywhere in the repository. GoTrue's defaults are
reasonable and refresh rotation is on by default, so this is not a vulnerability — it is an
undocumented, untested dependency on a dashboard setting, which is what WP13.2 means by "set
deliberately, not left at defaults."

Logout does call `supabase.auth.signOut()`, which revokes server-side rather than clearing
local state ([reset-password-form.tsx:55](src/components/auth/reset-password-form.tsx#L55),
and the callback's deliberate sign-out at
[callback/route.ts:136](src/app/auth/callback/route.ts#L136)) — WP13.2's third clause is
satisfied, untested.

---

#### M8 — No HSTS header
**WP14 · Evidence: [next.config.ts:60-75](next.config.ts#L60) — five headers, none of them `Strict-Transport-Security`.**

Present and correct: `Content-Security-Policy`, `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`Permissions-Policy` denying camera, microphone, geolocation and payment. That is most of
WP14 already done.

`Strict-Transport-Security` is absent. Vercel serves HTTPS and redirects, but without HSTS the
first request of a session is downgradeable. The CSP does carry `upgrade-insecure-requests`,
which covers subresources but not the initial navigation.

Capacitor is clean: `cleartext: false` and `allowNavigation` scoped to the three
`splitindex.co.uk` hosts ([capacitor.config.ts:28-30](capacitor.config.ts#L28)) — the
development-cleartext-exception risk WP14 warns about is not present.

---

#### M9 — Production CSP allows `'unsafe-inline'` for scripts
**WP14 · Evidence: [next.config.ts:7](next.config.ts#L7)**

```ts
script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""};
```

`'unsafe-eval'` is correctly dev-only. `'unsafe-inline'` is not conditional, and it is the
clause that does most of the work in blocking injected script. With `dangerouslySetInnerHTML`
in use for JSON-LD (L2) the two findings compound slightly. Next.js supports a nonce-based CSP
through middleware — here, `src/proxy.ts` — which is the shape of the fix.

---

#### M10 — The share card carries a Tier 2-derived value, generated with no per-share opt-in
**WP11.5, D4 · Evidence: [reports/hybrid/card/route.tsx:45](src/app/api/reports/hybrid/card/route.tsx#L45)**

```tsx
const readinessLine = `Readiness ${report.readinessTrend.start} → ${report.readinessTrend.end}`;
```

D4 permits "username, score, tier and the interference finding only" and excludes anything
from a health table; WP11.5 puts readiness output in Tier 2. The card renders a readiness
trend alongside the interference headline.

The card is also generated on a plain `GET` with no preview and no per-share confirmation.
D4 requires sharing to be opt-in per share with the exact content shown first, explicitly
because this product holds Tier 2 data. Correctly done: the route is premium-gated and
authenticated, and it renders only the requesting user's own report.

`src/app/api/interference/report-card/route.tsx` needs the same review; I have not read it in
detail.

---

#### M11 — No central configuration module; no plausibility bounds
> **PARTIALLY CLOSED `4f10902`.** `src/lib/security/config.ts` exists with the bounds, reconciled against the shipped CHECK constraints. Still open: it coexists with the scoring guard's own limits — see N2.
**§1, WP3.2 · Evidence: no `lib/security/config.ts`. Limits are inline literals.**

`WINDOW_MS`/`MAX_REQUESTS_PER_WINDOW` live in `src/proxy.ts`; `HISTORY_DAYS`/`ACTIVITY_DAYS`
in the analytics page; `.limit(400)` and `.limit(1000)` inline in queries. Every §1 constant
is either inline, absent, or delegated to a dashboard.

The plausibility bounds are the substantive half. `BOUND_BODYWEIGHT_KG`, `BOUND_LIFT_LOAD_KG`,
`BOUND_REPS`, `BOUND_HR_BPM`, `BOUND_DISTANCE_M`, `BOUND_DURATION_S` have no equivalent.
Partial coverage exists as database `CHECK` constraints (`avg_heart_rate` 40–230,
`duration_seconds > 0`, `age` 13–120), which is real protection — but it lands as a 500 with a
constraint name (M1) rather than a 400 with a field message, and it does not cover the
scoring engine's own assumptions. WP3 names the specific hazard: bodyweight sits in a
denominator in `relative_strength`, so a zero or near-zero bodyweight is a division problem
before it is a data problem. `CHECK (bodyweight_kg > 0)` prevents zero; nothing prevents 1.

---

#### M12 — Index coverage is good on ownership paths, thin on the two hot reads
**WP8 · Evidence: migration index declarations.**

Already present and well-chosen — the composite indexes WP8 asks for mostly exist:

```
idx_activities_user_started      activities(user_id, started_at DESC)
idx_strength_scores_user_exercise strength_scores(user_id, exercise_name, recorded_at DESC)
idx_workout_scores_user          workout_scores(user_id, created_at DESC)
idx_split_index_user_time        split_index_history(user_id, recorded_at DESC)
idx_leaderboard_period_rank      leaderboard_entries(period, period_start DESC, rank)
```

`idx_strength_scores_user_exercise` is exactly the adaptive-1RM walk pattern WP8 predicts.

The gaps:
- `gym_exercises` has only `(activity_id)`. There is no `(user_id, ...)` path — and no
  `user_id` column at all; ownership is derived through `activities`. Every per-user set
  history read is a join.
- The leaderboard is a **table refreshed by cron**, not a materialised view, and its only
  index is `(period, period_start DESC, rank)`. The bracket leaderboard filters on age band,
  sex and weight band (WP8), none of which are indexed — and none of which are columns on
  `leaderboard_entries`, so bracket filtering happens after a join to `profiles`.

I have run no `EXPLAIN ANALYZE`. WP8 requires plans in the commit message, and that needs a
database. Everything above is a structural reading of DDL, not a measurement.

---

#### M13 — No accessibility statement; no skip link
> **CLOSED `5525455`.** Skip link as the first focusable element, with `tabIndex={-1}` on the main landmark so focus actually moves. Statement at `/accessibility`, linked from the footer, claiming "partially conformant" and naming four specific remaining failures — see N7.
**WP12.5, WP12.8 · Evidence: `grep -rni "skip to\|skip-link"` → zero. No `/accessibility` route.**

WP12.8 wants a statement at a stable URL, linked from the footer and in-app settings, stating
conformance honestly including gaps. Given H8, the honest current wording is "partially
conformant" — and a statement that overclaims is worse than none, so this should be written
after the contrast fix, not before.

No skip link exists on any page.

Genuinely good already, and worth recording so nobody rebuilds it: `prefers-reduced-motion` is
handled in four places in `globals.css` **and** through `useReducedMotion` in the framer-motion
components (WP12.6 substantially done), and `aria-hidden` appears in 34 component files, so
the codebase has an accessibility habit — it is not starting from zero.

---

#### M14 — Username rules are thin against the reserved-word and lookalike requirement
**WP3.3 · Evidence: [`src/lib/utils/username.ts`](src/lib/utils/username.ts)**

Format (`/^[a-zA-Z][a-zA-Z0-9_]{2,19}$/`), a 13-term blocklist, and server-side uniqueness via
`ilike` in the route. The ASCII-only pattern rules out homoglyph attacks by construction,
which is the strongest part.

Against WP3.3: the reserved list covers `admin`, `moderator`, `support` and `splitindex` but
not `root`, `system`, `official`, `staff`, `help`, `billing`, `security`, `api` or `null`. The
`includes()` substring test is deliberately blunt and will reject legitimate names containing
a blocked term — a trade-off the comment owns.

The uniqueness check has a genuine race: `username-check` reads, the user submits, and the
write happens later. `profiles.username` is `UNIQUE` at the database level, so the race
closes as a constraint violation — surfacing as a 500 with Postgres text (M1) instead of "that
username is taken". The two findings should be fixed together.

---

### LOW

- ~~**L1 — `--muted-foreground` at 4.19:1 fails text AA**~~ **CLOSED `5525455`.** Lightened along the same neutral to `#7D7D87`, 4.97:1.
- **L2 — JSON-LD via `dangerouslySetInnerHTML`** (WP3.4).
  [layout.tsx:88](src/app/layout.tsx#L88) and
  [how-scoring-works/page.tsx:97](src/app/how-scoring-works/page.tsx#L97). Both stringify
  static objects with no user input, so there is no injection path today. `JSON.stringify`
  does not escape `</script>`, so this becomes live the moment any user-controlled string
  enters either object.
- ~~**L3 — `SECURITY.md` absent**~~ **CLOSED `8d9096a`.** Keys, blast radius, per-key rotation steps, the eleven elevated call sites with justifications, and a Known Gaps section. Its security contact address is a placeholder that still needs creating.
- **L4 — `Permissions-Policy` denies `geolocation=()`** (WP14). Correct today — GPS is
  Capacitor-native and `navigator.geolocation` is not used anywhere — but it will silently
  break a web GPS path if one ships. Worth a comment in `next.config.ts` so the next person
  finds it in seconds rather than in an afternoon.
- **L5 — `USER_TABLES` in the deletion route is redundant with the cascade** and will drift.
  See M5; listed separately because deleting the list is a different change from making
  deletion atomic.
- **L6 — `challenge_participants` `USING (true)`**
  ([001:377](supabase/migrations/001_initial_schema.sql#L377)). Same shape as C2–C4 but the
  table carries only challenge progress. Fix alongside them since the work is identical.

---


### New findings — raised during remediation, 2026-09-06

These were not visible in Phase 0. Three came out of doing the work; one came
out of a test that was wrong.

#### N1 — Most routes still have no schema at the boundary
**WP3 · Medium · Evidence: 3 of ~40 input-taking routes parse against a schema.**

Schemas applied: `POST /api/activities`, `PATCH /api/hpe/intake`,
`GET /api/social/leaderboard`. Not yet: roughly 17 body-taking routes (draft,
merge, duels, friends, goals, races, squads, session-templates, comments,
reactions, timezone, calibrate, hrv, rollout, checkout, join) and the query
parameters on roughly 20 read routes. Most carry ad-hoc checks; none has a
schema, so none produces field-level messages and none rejects unknown keys.

Medium rather than High because the write paths that reach the scoring engine
are covered and the scoring guard still backstops the rest — but the fuzz sweep
cannot claim "every route" until this is finished, and the brief's acceptance
criterion says every route.

#### N2 — Two sets of plausibility bounds now coexist
**WP3 · Low · Evidence: `src/lib/security/config.ts` and `src/lib/scoring/input-guards.ts`.**

§1 says nothing from the constants list may be hard-coded elsewhere, and the
scoring guard hard-codes overlapping limits. They were deliberately not merged:
the config bounds answer "could an athlete have entered this" at the API
boundary, and the guard's answer "can the engine make sense of this" relative
to bodyweight and leverage. The guard's numbers were tuned against real
sessions, so rewriting them to match would reject workouts that happened.

The fix is to split the guard — flat bounds imported from config, relational
checks kept — not to delete either. Low because both are correct today; it is a
drift risk, not a hole.

#### N3 — `ActivityFormData` does not describe what the client actually sends
**WP3 · Low · Evidence: the GPS flow sends `route`; the handler reads it through a cast.**

Found by `.strict()`: three route-privacy tests went red the moment unknown
keys stopped being accepted, because `route` is absent from the type and the
handler reaches it via `(body as { route?: unknown }).route`. The schema now
declares it. The type still does not, so the next person writing against
`ActivityFormData` has the same incomplete picture.

Worth recording as a pattern, not just an instance: a type used as
documentation, with a cast next to it, is a type that has stopped being true.

#### N4 — The bracket engine had no test coverage before it was refactored
**WP1 · Low · CLOSED `5e70dd8` · Evidence: only `leaderboard-brackets-check.ts`, a script nothing runs.**

Raised because it nearly caused a silent product failure rather than because it
still exists. `resolveBracket` and its widening logic — subtle, ordinal,
boundary-sensitive — had no vitest coverage at the point migration 056 changed
what it is fed. Sixteen tests were added alongside that change, half of them
holding the SQL banding and the TypeScript banding to each other.

The general finding: `*-check.ts` files in `src/lib` look like tests and are not
run by `npm test`. There are several. Each is a piece of logic somebody
considered worth verifying and nothing verifies.

#### N5 — The GoTrue half of WP13 cannot be tested from this repository
**WP13 · Medium · Evidence: `createBrowserClient` calls Supabase directly; this app never sees the credential.**

Expired session rejected, refresh rotation, logout revoking server-side, reset
token single-use, OTP single-use. All five are GoTrue behaviours. Split Index
implements none of them and never handles the token, so there is no code here to
unit test — and a test that mocked Supabase and asserted the mock behaved would
pass just as happily if the real settings were wrong.

Closing this needs an integration test against a live project: sign in, wait out
or force an expiry, assert rejection; use a reset token twice, assert the second
fails. That is a test-infrastructure task, not a code change, and it is the last
thing standing between WP13 and "complete".

#### N6 — `.env.example` is not in the repository
**WP2 · Low · Evidence: `.env*` in .gitignore; `git ls-files` has never listed it.**

It exists on developer machines and drifts with nothing to catch it —
`REVENUECAT_WEBHOOK_SECRET` and `DEMO_ACCOUNT_PASSWORD` were both in use and
absent from it, and the two Upstash variables are new. SECURITY.md now carries
the authoritative list.

Fixable with a `!.env.example` negation, flagged rather than done: it makes a
file that currently cannot be committed committable, and the value of that
depends on trusting nobody ever pastes a real key into it.

#### N7 — Four WCAG 2.2 AA failures remain, and the statement names them
**WP12 · Medium · Evidence: `/accessibility`, "Known issues".**

Closing H8 did not make the app conformant, and the published statement says
"partially conformant" rather than claiming otherwise. What remains:

1. **Charts have no text or table equivalent** exposed to assistive technology.
   Every graph has a plain-English explainer already — WP12.4 asks that it be
   extended into a text equivalent rather than something new being built.
   (WCAG 1.1.1.)
2. **Some states are still signalled by colour alone** — parts of the Lab /
   Engine distinction and some status indicators. (WCAG 1.4.1.)
3. **Form errors are not always programmatically tied to their field**, so a
   screen reader may not announce them on reaching the input. (WCAG 3.3.1.)
4. **No keyboard-only or screen-reader walkthrough has been done.** Automated
   tooling and contrast measurement find roughly a third of real problems; the
   brief asks for a manual pass over onboarding, logging a session, the
   dashboard, the leaderboard, analytics and checkout. Until that exists,
   claiming those journeys are operable without a mouse is a guess.

The statement is only honest while this list is accurate. Update both together.

#### N8 — Seventeen call sites still resolve entitlement themselves
**WP6.2 · Low · Evidence: `grep -rln isPremiumUser src` — 21 sites, 4 migrated.**

They are correct: the matrix says so, and it passes against the pre-migration
code. The finding is duplication, not a defect. Each re-queries `profiles` for
its own columns, which is how two entitlement concepts — `isPremiumUser` and the
card-less `hasSoftTrialAccess` — came to coexist without either knowing about
the other.

Low because nothing is currently wrong, and worth doing because the next
divergence will be silent in exactly the same way.

### Part D — activation and monetisation

Reported as findings for completeness. None is a security or compliance matter, and D0's
honest read applies: for a 25–40 audience the measured invite rate is the point, not the share
button.

- **D1 — cold-start payoff, partial.** `POST /api/onboarding/calibrate` exists and the
  diagnostic fits a per-athlete Riegel exponent, so the highest-value half is built. Missing:
  the CSV import bootstrap is not reachable from onboarding — there is an `import_jobs` table
  but **no import route at all** (`grep -rn "import_jobs" src/` hits only the deletion list),
  and there is no instrumentation of time-to-first-personal-number, which D1.4 identifies as
  the metric the whole work package exists to move.
- **D2 — funnel instrumentation absent.** No event pipeline of any kind; no third-party SDK
  either, which at least means WP11's "no health data off-platform" constraint is not
  currently violated. Every D3/D4/D5 acceptance criterion depends on D2 existing first.
- **D3 — paywall config is code.** `src/lib/pricing/config.ts` and `sku-picker.tsx` are
  hard-coded; changing copy, price presentation or trial timing is a deploy, and after
  Capacitor an app review.
- **D4 — share exists, attribution does not.** `share-image-button.tsx` and two OG card routes
  ship. No signed referral token, no attribution, no invite rate. See M10 for the content
  problem, which should be fixed before this is instrumented rather than after.
- **D5 — single-screen billing page.** Build as a D3 variant when D3 exists, per the brief's
  own caution that the 37% figure is a hypothesis and not a result.
- **DMCC Act 2024 renewal reminders** (WP11.4) are **not implemented** — Stripe handles billing
  mechanics, not notice obligations. This is a legal obligation that doubles as the D5
  trust screen; building it once counts against both.

---

## 4. Triage summary

**As found in Phase 0 (`adb35c5`):**

| Severity | Count |
|---|---|
| Critical | 4 |
| High | 9 |
| Medium | 14 |
| Low | 6 |
| **Total** | **33** |

**Still open as of 2026-09-06**, after WP1, WP11, CI and part of WP3, and
including the four findings raised during remediation:

| Severity | Open | Closed | Note |
|---|---|---|---|
| Critical | **0** | 4 | All four were one defect in four places. |
| High | 3 | 6 | H1, H3, H4, H5, H7, H8 closed; H2 corrected and partially closed. |
| Medium | 10 | 5 | M1, M2, M3, M4, M13 closed; M7 and M11 partially. N1, N5, N7 added. |
| Low | 7 | 4 | L1, L3, L6, N4 closed; N2, N3, N6, N8 added. |
| **Total** | **20** | **20** | 40 findings raised in total. |

All four Criticals are the same defect in four places: a policy written to enable a public
leaderboard exposes the underlying user-owned table instead of a column-scoped projection.
They share one fix — a view, four dropped policies, one test — which is why they are one work
package and not four.

### Recommended order

**Do not start fixing until the two facts I could not establish are established**, because
both change the work:

1. **Run the live `pg_policies` / `pg_tables` enumeration** and reconcile it with C1–C4. All
   RLS findings here are read from migration source. Given migration 049's history, source and
   production have diverged in this project before.
2. **Confirm whether Supabase enforces email confirmation** in the dashboard (H7). If it does,
   H7 becomes "add the assertion"; if it does not, it becomes an open door.

Then:

| # | Work | Closes | Why here |
|---|---|---|---|
| 0 | ~~**CI**~~ **DONE `2c4cefe`** — run vitest on push and PR | H5 | Every step below ends in a test. Without this, none of them is a gate. Cheapest item in the document. |
| 1 | ~~**WP1 — public projections**~~ **DONE `5e70dd8`** | C1, C2, C3, C4, L6 | Four Criticals, one fix. Bodyweight, readiness and Stripe IDs stop being world-readable. |
| 2 | ~~**WP11 Article 9 consent**~~ **DONE `604a095`** | H1 | Special category data is being collected right now with no lawful basis we can evidence. Every day it runs adds records. |
| 3 | **WP3 — validation at the boundary** — PARTIAL `4f10902` | H2 (corrected), M11 partly; M14 **not** started | Precondition for the WP3 fuzz sweep and for the §1 config module everything else references. |
| 4 | ~~**WP2 build gate + `server-only`**~~ **DONE `8d9096a`** | H4, L3 | Small, and it stops the one mistake with no recovery short of rotation. Needs step 0. |
| 5 | ~~**WP5 error boundary**~~ **DONE `c467470`, `0dd3d55`** | M1, M2 (M14 **not** started) | Mechanical, 23 files, one house pattern (`auth-errors.ts`) already exists to copy. |
| 6 | ~~**WP13 + WP4 auth hardening**~~ **DONE `76b9d6b`** | H3, H7; M7 partly (M6 **not** started) | Per-account and per-IP limits must be designed together, per WP13.5. Needs a shared store. |
| 7 | ~~**WP12 contrast + gating**~~ **DONE `5525455`** | H8, M3, M13, L1 (N7 opened) | M3 satisfies WP6.3 and WP12.7 at once. Statement written last, after the fix, so it is honest. |
| 8 | ~~**WP6 entitlement matrix**~~ **DONE `1d6976c`** | M4 (M3 already closed by WP12); N8 opened | The matrix test is the deliverable; `features.ts` mostly stands. |
| 9 | **WP7 logging** | H6 | Build the redaction rule in from the first line, not after. |
| 10 | **WP14 headers, WP11 deletion test, WP8 plans** | M5, M8, M9, M12, L2, L4, L5 | Independent, parallelisable, none blocking. |
| 11 | **H9 — DPIA + ICO** | H9 | Stephen's, not code. Should start now and run alongside; it does not block engineering. |
| 12 | **Part D** | D1–D5 | After the brief's own gate: WP1, WP2, WP6 and WP13 complete before any growth push. |

**Still outstanding from the two blockers above:** the live `pg_policies`
enumeration has still not been run, and the Supabase email-confirmation setting
has still not been checked. Neither blocked the work done so far — WP1 fixed
migration source, which is where the defect was — but C1–C4 cannot be called
verifiably closed against production until the first is done, and H7 cannot be
sized until the second is.

### What I am waiting on

The Phase 0 questions here — which columns the public projection should expose,
and whether to deploy the fix before sign-off — were answered and acted on; the
column set was agreed before migration 056 was written. What is outstanding now
is different.

**Needs a database, not a decision:**

- **Run `pg_policies` and `pg_tables` against production** and reconcile with
  C1–C4 and migration 056. Everything in Part A is still read from migration
  source. Migration 049 exists because source and production diverged in this
  project before, so this is a demonstrated failure mode rather than a
  hypothetical one.
- **Apply migrations 056 and 057 before deploying the code that reads them.**
  056's views do not exist until it runs, and the social and leaderboard pages
  will 404 their queries without them. 057 fails closed, so the Hybrid Plan
  switches itself off rather than misbehaving — safe, but degraded.
- **Check the Supabase email-confirmation setting** (H7). It decides whether
  that finding is "add an assertion" or "an open door".

**Needs Stephen, not code:**

- **The DPIA** (H9). Large-scale health-data processing with profiling makes one
  effectively mandatory. Half the drafting now exists — the Tier 1 / Tier 2
  reasoning is written into `src/lib/consent/article9.ts` and the privacy policy
  — but the document does not.
- **ICO registration and the data protection fee** (H9).
- **The EU question** (WP11): whether to sell into the EU and take on EU GDPR
  and the European Accessibility Act, or geo-block until it is worth handling.
  The brief is explicit that this is a decision to flag, not to implement either
  way.
- **Two judgement calls made during WP11**, either of which is a one-line change
  if read differently: the injury Risk Index is gated by consent despite reading
  no intake data (it states a conclusion about physical condition from Tier 1
  input), and withdrawal deletes health answers but **not** `hpe_plans` — a plan
  prescribes sessions rather than characterising health, and deleting weeks of
  someone's programme as a side effect of a privacy choice would punish the
  choice.

**Next in the recommended order:** step 9, WP7 — security and audit logging.
`admin_access_log` (migration 059) is the first structured log in the codebase
and the pattern to extend: auth successes and failures, rate-limit trips,
entitlement denials, payment webhook events and 5xx. Build the redaction rule in
from the first line rather than retrofitting it — WP7's other half is that no
log line may contain a value drawn from a health table, and `sanitiseDetail` in
`lib/auth/admin-audit.ts` is the shape to reuse.

**Four operator items outstanding:**

1. Create the security contact address in SECURITY.md. It is a placeholder, and
   a bouncing vulnerability report is worse than no address at all.
2. Confirm Vercel's Preview environment does not carry production secrets. Not
   visible from the repository, and the most common way a production key ends up
   somewhere it should not be.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel, or the
   per-user rate limits are advisory and only the per-instance burst guard
   applies.
4. Set the GoTrue rate limits and confirm email confirmation is enabled — the
   table is in SECURITY.md. **Run the impact query at the top of migration 058
   before applying it**; it can otherwise stop every athlete logging.
5. Create `accessibility@splitindex.co.uk`, the contact on the published
   accessibility statement, which promises a reply within 5 working days.
