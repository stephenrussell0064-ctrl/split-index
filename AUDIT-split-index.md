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
| H6 no structured security logging | **CLOSED** | `4d55a69` |
| M7 session/refresh left at defaults | **PARTIAL** — values recorded and made an operator task; GoTrue behaviour still unverifiable from here | `76b9d6b` |
| H2 no boundary validation | **PARTIAL** — 3 routes of ~40; **and materially corrected, see the finding** | `4f10902` |
| M11 no central config / bounds | **PARTIAL** — module exists; a second set of bounds still lives in the scoring guard | `4f10902` |
| L2 JSON-LD via `dangerouslySetInnerHTML` | **CLOSED** | `f84b4eb` |
| M5 account deletion non-atomic | **CLOSED** | `25ad889` |
| L5 `USER_TABLES` redundant with the cascade | **CLOSED** | `25ad889` |
| M8 no HSTS | **CLOSED** | `6b6aebf` |
| L4 `geolocation=()` undocumented | **CLOSED** | `6b6aebf` |
| M12 index gaps | **OPEN — deliberately.** No index added, because no query plan could be produced. Diagnostic shipped instead; needs an operator to run it | `7893c0c` |
| M9 CSP allows `'unsafe-inline'` | **CLOSED on the authenticated surface** — public pages keep it, deliberately; see the finding | `3e8994d` |
| N10 email addresses in an anon-readable column | **CLOSED** by a peer session's migration 064, which masks the column in both views rather than scrubbing rows — a better fix than my 061, which never landed | `ff0ab52` |
| M6 `CRON_SECRET` accepted from the query string | **CLOSED** | see finding |
| N11 `REVOKE FROM PUBLIC` leaves anon's direct grant | **OPEN — High.** 067 written, not applied; `prune_security_events` is the one with teeth | `067` |
| M10 share card content and per-share consent | **CLOSED** — and the finding's "Tier 2" claim corrected; see the finding | see finding |
| M14 username reserved words and lookalikes | **CLOSED** | see finding |
| Everything else | **OPEN** | — |

Zero Critical findings remain open. The brief's gate for a growth push is WP1,
WP2, WP6 and WP13 complete: **all four are done** — WP1 `5e70dd8`, WP2 `8d9096a`,
WP6 `1d6976c`, WP13 `76b9d6b`. (This line previously read "WP6 open, WP13 open"
and was stale; corrected rather than silently updated, since the gate being met
is the thing the brief keys the growth push to.)

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
> **CLOSED `4d55a69`.** One typed event union, one JSON line per event, wired into 5xx, rate-limit trips, entitlement denials, Stripe webhook events and the auth callback. Migration 060 persists the alertable subset with §1's two retention periods enforced by `prune_security_events()`.
> The finding's own warning — that the absence of a logger was the only thing keeping health values out of logs — is answered by coupling the redaction deny-list to `TIER2_INTAKE_FIELDS`, so a question added to the health screen becomes un-loggable the same day. Proven by removing deny-list entries and watching the Tier 2 assertion fail.
> **Not covered, structurally:** client-side auth failures never reach this origin. Same limit as WP4's auth rate limiting.
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

**CLOSED `25ad889` (with L5).** The nineteen-table loop is one
`admin.auth.admin.deleteUser` call. Half-purged-with-a-live-login is now unreachable: either
the cascade ran or it did not.

The WP11.3 acceptance criterion — "test that a deleted user cannot be reconstructed" — is met
in a different form than it is written, and the substitution is deliberate rather than
convenient. There is no database here, so there is no row to delete and nothing to query
afterwards; an end-to-end deletion test would have to fake the database, and would then be
asserting that my own stub forgets what I told it to forget. What is tested instead is the
property the route now rests on: `account-deletion.test.ts` parses every migration, walks each
`CREATE TABLE` to its matching paren, and fails on any user-bearing column that does not
cascade. That is stronger than one deletion, because it also covers the table added next month.

Three columns deliberately survive, as a named allowlist with a reason each rather than a
pattern — `admin_access_log.admin_user_id`, `security_events.user_id`, `challenges.created_by`.
The test's failure message says that adding to that list is a decision about somebody's right
to erasure.

**Still unverified from here:** that the cascade actually fires in the deployed database. The
test reads DDL. Only an operator running a deletion against a real account can close that gap.

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

**CLOSED.** Both routes now call one shared
[verifyCronRequest](src/lib/security/cron-auth.ts), which reads the `Authorization`
header and nothing else. The query parameter is gone rather than validated harder — the
value being correct is precisely why it worked, so tightening it was never the fix.

Removing it is safe because nothing ever asked for it, which was checked rather than
assumed: `vercel.json` schedules only `hybrid-reports` and Vercel Cron sends the Bearer
header unprompted; `/api/cron/leaderboard` is scheduled nowhere at all; and `?secret=`
appears in no config, script, workflow or document in the repository. `.env.example:32`
and `README.md:265` both document the header and only the header.

**A caller still using it gets a 401 and a log line, not silence.** A scheduled job that
stops running looks like nothing until somebody notices a stale leaderboard, so a request
carrying `?secret=` is recorded as an `auth.failure` naming the parameter and what to send
instead. The value is never read — logging it would put the secret in the log this change
exists to keep it out of, and there is a test asserting the secret does not appear in the
output.

The `&& !!process.env.CRON_SECRET` guard is preserved as an explicit early return with its
own test. It is the one branch where a refactor is catastrophic rather than merely wrong:
an unset variable must not make a job that walks every athlete's row public.

**A correction to this finding, and to my own first draft of the fix.** The finding called
the comparison "non-constant-time … listed only for completeness", and that was fair. What
it did not mention, and what I initially wrote up as a second security weakness, is the
`.replace("Bearer ", "")` substring replace. Measured, it is **not** a bypass:
`xBearer <token>` becomes `x<token>` and is refused. Its entire effect was rejecting
requests it should have accepted — a lowercase `bearer`, which HTTP explicitly permits
since the scheme token is case-insensitive, and `Bearer  <token>` with two spaces. That is
a correctness fix wearing security clothing, and it is recorded that way in the module
rather than left implying a hole that was never there.

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

**CLOSED `6b6aebf` (with L4).** `max-age=63072000; includeSubDomains`, deliberately without
`preload`. Preload is a one-way door — submission is easy, removal takes months to reach users
through browser release cycles, and every future subdomain must then serve valid TLS forever.
That is an operator's commitment to make, so the header comment records what enabling it would
cost rather than the change making that commitment on Stephen's behalf.

**No test, and none is claimed.** `headers()` is a build-time config value with no runtime seam
a unit test can reach; asserting that `next.config.ts` contains a string I just typed is a
tautology dressed as coverage. The verification that means anything is a response header on a
deployed URL — an operator check, listed as one.

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

**OPEN — needs a decision from Stephen, not a commit from me.** I costed the fix rather than
taking it, because the cheapest version of it changes how the marketing site is served.

`node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md:38` is unambiguous:
"you **must use dynamic rendering** to add nonces", and at line 391, "**all pages must be
dynamically rendered**" — static optimisation and ISR disabled, "pages cannot be cached by CDNs
without additional configuration", PPR incompatible.

Measured against a real `npm run build` on this branch, **13 routes are prerendered static**:

```
/                      /_not-found            /accessibility         /cardio/gps-run
/email-confirmed       /forgot-password       /privacy               /reset-password
/robots.txt            /settings              /settings/billing      /sitemap.xml
/terms
```

The first one is the cost. `/` is the marketing landing page; `/privacy`, `/terms` and
`/accessibility` are the pages a regulator or an app store reviewer reads. Nonces move all of
them to server-rendered-on-demand.

Three options, and the third only surfaced on re-reading the bundled doc:

1. **Nonce CSP** (docs §"Adding a nonce with Proxy"). Strongest. Costs static rendering and CDN
   caching on all 13, including the landing page.
2. **Leave `'unsafe-inline'`.** Free. Keeps the weakest clause in the policy — though note the
   realistic injection paths are narrow: L2 is now closed, and boundary validation covers the
   parsed routes.
3. **`experimental.sri`** (docs:455). Hash-based CSP that "allows you to maintain static
   generation while still having a strict CSP". Keeps all 13 static. Two caveats the doc states
   and one it does not: it is **experimental**, it is **build-time only**, and SRI adds
   `integrity` to *file* scripts — it does not cover **inline** ones, so dropping
   `'unsafe-inline'` under this option would block both `application/ld+json` blocks and lose
   the structured data on exactly the pages that need it, unless their hashes are added to the
   policy by hand and kept in step.

4. **Scope the strict policy to the routes that are already dynamic.** The 13 static routes are
   the marketing and legal surface plus three app pages; everything holding athlete data —
   `/dashboard`, `/activities`, `/social`, `/gym`, `/cardio`, `/hybrid-plan`, `/profile`, every
   `/api/*` — is already `ƒ` server-rendered on demand and can therefore carry a nonce at no
   cost. `headers()` takes a `source` pattern and `src/proxy.ts` can branch on pathname, so the
   nonce policy can apply where the data is and the current policy stay where the marketing is.
   `/settings`, `/settings/billing` and `/cardio/gps-run` are the three static pages that would
   want the strict policy; opting those three into dynamic rendering costs nothing anyone
   notices, unlike `/`.

   **Unverified.** This is a reading of the docs and the build output, not a spike. The failure
   mode to check first is the proxy setting a CSP on a *static* response, whose scripts have no
   nonce — that would break the page rather than harden it.

Not decided here. A change that makes the landing page dynamic, or that puts an experimental
flag in the production build, is a product call. Option 4 looks like it gets most of the
security benefit for none of the rendering cost, and is where I would spend the time.

**CLOSED `695c2d3`, on `main` as `3e8994d` — option 4, chosen by Stephen.** The authenticated surface gets a
per-request nonce with `'strict-dynamic'`; the public surface keeps the previous policy and
stays static. Static routes went from 13 to 10, and the three that moved — `/settings`,
`/settings/billing`, `/cardio/gps-run` — are behind a login. `/`, `/privacy`, `/terms` and
`/accessibility` are untouched.

**Not fully closed as a security matter, and the finding should be read that way.** The public
pages still carry `'unsafe-inline'`. An injection into the landing page would still execute.
The judgement is that those pages render no user-controlled data, so the residual risk is
small — but "M9 closed" means the policy is now strict where athlete data is, not that
`'unsafe-inline'` is gone from the application. `style-src` keeps it in both policies; nonce-ing
styles is a separate change and was not smuggled in here.

**Three things the spike caught that would otherwise have shipped broken**, recorded because
each is the same shape — a change that looks correct, returns 200, and silently does nothing:

1. `export const dynamic = "force-dynamic"` is inert from a `"use client"` module. It was the
   first thing tried on all three pages; the build still reported them prerendered. Route
   segment config no longer lists `dynamic` at all in Next 16. Only the build output revealed
   it. Each page is now a server shell awaiting `connection()`.
2. The Organization JSON-LD was in the **root layout**, so it rendered on every authenticated
   route, where a nonce policy would have dropped it. Nonce-ing it means reading headers in the
   root layout, which makes every route dynamic and defeats the split entirely. It moved to `/`.
3. Two `Content-Security-Policy` headers on one response are enforced as their **intersection**.
   Keeping the header in `next.config.ts` alongside the new one would have blocked the very
   inline blocks the public policy exists to permit.

**A build gate, not just tests:** `scripts/check-csp-routes.mjs` runs inside `npm run build` and
fails if any prerendered route sits under a nonce prefix. The invariant is "this route is
server-rendered", which only a build knows — a route can go static because somebody removed a
line three components down, with nothing in the diff that looks like a rendering change. It
cannot run in CI, which has no build job by design; the same is already true of WP2's bundle
scanner, and `ci.yml` makes that argument.

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

**CLOSED — and the finding was half wrong, which is recorded because the wrong half would
have sent the next person hunting the wrong thing.**

**The correction first.** "A Tier 2-derived value" is false. Readiness on that card comes
from `computeReadiness(params.sessions, …)`, which derives an acute:chronic workload ratio
from training load. It reads no health table, no PAR-Q answer, no HRV row and no sleep row
— traced from `hybrid-report.ts:65` through `readiness.ts:61`. It is **Tier 1 training
data held on contract necessity**, not Article 9 special category data. I wrote the
finding from the word "readiness" rather than from the call graph.

**It came off the card anyway**, for the reason that survives the correction: D4 permits
the username, the score, the tier and the interference finding, and readiness is outside
that list. A readiness figure printed beside somebody's name on an image built to be posted
publicly is an inference about their physical condition, and the allowlist exists precisely
so that judgement is not made field by field by whoever is adding a line to a PNG.

**The per-share opt-in is now real.** D4 asks for opt-in per share with the exact content
shown first. Neither path did that:

- The Hybrid report was a bare `<a href="/api/reports/hybrid/card" target="_blank">`, so
  the card was generated and opened before the athlete had seen anything. That is
  disclosure, not consent.
- The Interference path went through `ShareImageButton`, which fetched the PNG and handed
  it straight to the OS share sheet. The sheet's thumbnail appears *after* the decision and
  is the size of a stamp, and the desktop fallback had no preview at all.

Both now fetch the image, render **the actual PNG** at a readable size in a focus-trapped
dialog with a plain-English line naming what is on it, and share nothing until the athlete
presses Share there. Cancel discards the blob and revokes the object URL. `contentSummary`
is a required prop, so a new card cannot be wired up without someone writing down what it
carries.

One thing that looks like a risk and is the opposite: `navigator.share` needs transient
activation, and the old code spent the click's activation on a `fetch` before calling it.
The confirm press is a fresh gesture, so sharing is now more reliable, not less.

**A judgement call, stated rather than buried.** `targetPaceLabel` is also outside D4's
literal allowlist and is **kept**. It is a training target the athlete set for themselves,
carries no inference about their physical condition, and reads as the kind of thing the
feature exists to let people post. If that reading is wrong it is one line to remove — but
removing it silently under cover of a privacy fix would be the wrong way to decide it.

**What is NOT verified:** the dialog has not been exercised in a browser. Reaching it needs
a signed-in premium account with a generated report, which is not available from here. The
tests assert the source — that the preview renders the fetched blob, that `nav.share` is
reachable only from the confirm handler, that no raw link to a card route remains — and
that is weaker than clicking it. Worth ten minutes on the deployed app.

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

**STILL OPEN — and deliberately so `7893c0c`.** No index was added, because none could be
justified. WP8's rule is that every index is justified by a plan in the commit message; with no
reachable database there is no plan, so an index added here would be added on the strength of it
looking right, which is the thing the rule exists to stop. On write-heavy tables an unneeded
index is a tax on every session an athlete logs, permanently.

What was shipped instead is the measurement, runnable:
[wp8_hot_query_plans.sql](supabase/diagnostics/wp8_hot_query_plans.sql) — the ten hottest
queries wrapped in `EXPLAIN (ANALYZE, BUFFERS)`, plus the `pg_stat_user_indexes` sweep for
indexes nobody reads, which is the half of WP8 that usually gets skipped. It carries the
conditions under which its output means anything (real data, a heavy user, fresh `ANALYZE`),
because a plan taken against an empty development database is fiction.

**A finding against my own earlier fix.** Migration 056 added
`idx_profiles_bracket_keys (country, weight_kg, age)` to serve the bracket board. It probably
does nothing. The index is on raw columns, but `leaderboard_profiles` exposes *bands* computed
by `CASE` expressions over them — and `age_band` is computed not from `profiles.age` but from a
`LATERAL` that prefers `date_part('year', age(date_of_birth))` whenever a date of birth is set.
Filtering on `age_band` therefore cannot use that index, and for any athlete with a date of
birth the indexed column is not even the input. Query 9 in the script settles it. If the plan
does not name the index, the two honest outcomes are to drop it or rebuild it as an expression
index matching the view's `CASE` arms; keeping it because it was well-intentioned is the option
WP8 rules out.

**Operator task:** run the script against production, paste the plans, then decide. Until then
this finding stays open, because a diagnostic is not a fix.

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

**CLOSED.** Three parts, and the first one had to happen before the second or the second
would have made things worse.

**The lists are split.** Profanity stays substring-matched (a shipped decision, kept:
for slurs a false positive is the better error). Impersonation terms move to
`RESERVED_NAMES`, matched as a WHOLE username and by WORD in a display name — never as a
substring of a word.

That was not a tidy-up. The old rule was refusing real names, demonstrated before changing
anything: `badminton`, `grapes`, `scunthorpe`, `shitake` and the surname `Rapetti` could not
be registered. Adding WP3.3's list to a substring test would have added `rapid`,
`therapist`, `capital`, `rooted`, `staffordshire` and `Rapinoe` to that. A short exception
list covers the demonstrated innocent words; the general Scunthorpe problem has no fix and
is not claimed to have one.

**All nine reserved words WP3.3 named are added**, plus `administrator`, `sysadmin`,
`helpdesk`, `team`, `payments`, `noreply`, `webmaster` and `abuse`. `admin7`, `ad_min`,
`adm1n` and `4dm1n` are refused; `badminton` is not.

**A lookalike hole the finding did not know about**, because it predates
`validateDisplayText`. The finding credits the ASCII-only username pattern with ruling out
homoglyphs "by construction", and it does — for usernames. Display names permit unicode and
are what appears beside a score on a leaderboard, and `Аdmin` with a Cyrillic А matched
nothing at all. Confusables are now folded before the reserved check.

**The race is closed at the message, which is the only place it can be closed.**
`username-check` reads and the write happens later, so two athletes can pass the check and
one loses at the constraint — no amount of checking harder changes that. What was wrong is
what the loser was told: `profiles_username_key` was mapped on the server, but onboarding
writes with the BROWSER client, so it surfaced as "Could not save your profile. Please try
again." That is not merely vague, it is wrong advice — trying again with the same username
fails identically. The map moved to
[unique-violations.ts](src/lib/api/unique-violations.ts), dependency-free so both paths
share it and cannot drift, and the browser now says "That username is taken." without ever
repeating the conflicting value, which belongs to somebody else.

**A bug I introduced and caught before committing**, recorded because the interaction is
not obvious: folding digits to letters (`7`→`t`) before stripping trailing digits turned
`admin7` into `admint`, which matches nothing — so the folding I added to catch `adm1n`
silently broke every case the trailing-digit strip existed to catch. `admin7`, `admin1`,
`adm1n` and `4dm1n` all slipped through. The two rules need opposite treatments of a digit,
so the implementation generates candidate spellings and checks them all rather than
computing one canonical form. There is a test named for exactly that.

---

### LOW

- ~~**L1 — `--muted-foreground` at 4.19:1 fails text AA**~~ **CLOSED `5525455`.** Lightened along the same neutral to `#7D7D87`, 4.97:1.
- ~~**L2 — JSON-LD via `dangerouslySetInnerHTML`** (WP3.4)~~ **CLOSED `f84b4eb`.**
  `jsonLdScript()` escapes `<`, `&` and U+2028/U+2029 — all standard JSON escapes, so the
  representation changes and the data does not, which a round-trip test asserts. The escaping
  test alone would have passed against the old code, since the old code was never called with
  anything hostile; the test that matters is the scanner over every `dangerouslySetInnerHTML`
  in `src`, which fails against a *future* commit that adds a username to one of those objects.
  Recorded as closing a latent defect, not an exploitable one.
- ~~**L3 — `SECURITY.md` absent**~~ **CLOSED `8d9096a`.** Keys, blast radius, per-key rotation steps, the eleven elevated call sites with justifications, and a Known Gaps section. Its security contact address is a placeholder that still needs creating.
- ~~**L4 — `Permissions-Policy` denies `geolocation=()`** (WP14)~~ **CLOSED `6b6aebf`.** The
  comment now names the mechanism the app actually uses (imported files and the Capacitor
  native layer, neither of which touches the browser permission this header governs) and what
  to change when web GPS ships. A policy-denied request is denied *silently*, so the failure
  mode is a feature that does not work with no prompt and no error.
- ~~**L5 — `USER_TABLES` in the deletion route is redundant with the cascade**~~
  **CLOSED `25ad889`.** The list is gone; see M5.
- ~~**L6 — `challenge_participants` `USING (true)`**~~ **CLOSED `5e70dd8`.**
  ([001:377](supabase/migrations/001_initial_schema.sql#L377)). Same shape as C2–C4 but the
  table carries only challenge progress. Fixed alongside them, as predicted — the work was
  identical. (The status table has recorded this as closed since `5e70dd8`; this bullet was
  missed at the time and is struck through now.)

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

**PARTIALLY CLOSED — 7 routes done, 14 body-taking routes remain.** Measured rather than
estimated: at the start of this pass 6 of 52 route files validated anything; 12 do now.
Body-taking routes with no schema went from 20 to 14.

Done: `activities/[id]/comments`, `squads`, `squads/join`, `duels`, `recovery/hrv`,
`profile/timezone` — plus the three that already parsed, and three a peer session added
(`hpe/session-feedback`, `social/report`, `social/block`).

**None of these routes was unguarded, and the finding's phrasing "no schema" was fair but
undersold what was there.** What the ad-hoc guards actually got wrong, each now a named
test case:

- `String(body.name ?? "")` coerces an object to `"[object Object]"` and an array to its
  comma-joined contents. Both are non-empty, both passed the length check, and both were
  stored as somebody's comment.
- `.slice(0, MAX_NAME_LENGTH)` silently truncated a squad name. The athlete got a shorter
  name back with nothing saying so.
- `duels` clamped and defaulted: an out-of-range `days` became 30, an unknown `metric`
  became `"sessions"`, an unknown `sport` became null. A malformed request produced a
  working duel nobody asked for, so a client bug looked like a feature.

Absent is still distinguished from invalid — a missing `metric` still means "sessions", so
the defaults survive and only present-but-wrong values are refused.

**A mistake worth recording, because it would have created N2 out of the fix for N1.** The
first draft of the schema module invented its own limits — 500 characters for a comment,
50 for a squad name — against the 1000 and 40 the routes were using. That is precisely
"two sets of bounds coexisting". The constants moved into the schema module instead, the
routes import them, and a test asserts both values so the next person cannot drift them
apart. `hrvSchema` is asserted against `BOUND_HRV_MS` from the central config rather than
against a literal, for the same reason.

**Still to do (14):** `activities/[id]`, `activities/[id]/reactions`, `activities/draft`,
`activities/merge`, `consent/article9`, `duels/[id]`, `friends`, `goals`,
`hpe/admin/rollout`, `onboarding/calibrate`, `races`, `revenuecat/webhook`,
`session-templates`, `stripe/checkout`. Plus the query parameters on roughly 19 read
routes, which are untouched.

Two of the remainder need a decision rather than a schema. `onboarding/calibrate` currently
FILTERS invalid lifts and proceeds with whatever is left, so a typo in one lift is silently
dropped from a calibration the athlete thinks completed; refusing instead is better but is
a behaviour change on the onboarding path. `revenuecat/webhook` and `stripe/checkout` are
signature-verified, which is a different kind of guard and may make a body schema redundant
rather than absent.

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

**Checked against a peer session's accessibility work on `main`, 2026-09-07.** That
session landed nav landmarks, `aria-expanded` on three disclosures, `role="alert"` on
form errors, two icon-button labels, and ten touch targets raised to 44pt, and asked
whether any of these four could be closed. Verified against `origin/main`: **none of
the four closes, and item 3 improves without closing.**

- **Item 3 is now partially addressed.** `role="alert"` is on all three error slots in
  [input.tsx](src/components/ui/input.tsx) (lines 56, 112, 145) — so an error is
  announced *at the moment it appears*, which is a real improvement. But the finding is
  about the error being **programmatically tied to its field**, and `grep` for
  `aria-describedby`, `aria-errormessage` and `aria-invalid` across `src/components/ui`
  returns nothing. A screen-reader user who tabs back to the input afterwards, or
  arrives at it with the error already rendered, still gets no association between the
  two. That is precisely the case a live region does not cover. (WCAG 3.3.1.)
- **Items 1, 2 and 4 are untouched** by that work: chart text equivalents, colour-alone
  state, and the manual keyboard/screen-reader walkthrough. Item 4 cannot be closed by
  code at all — it is a human pass, and until someone does it, claiming those journeys
  are operable without a mouse remains a guess.

The published statement therefore stays accurate as written and needs no edit. Recorded
in full because "we did some accessibility work, can the finding close" is a question
that will be asked again, and the answer needs to be checkable rather than remembered.

**CORRECTION to item 1, 2026-09-07 — measured, after a peer session reported a ~1-in-10
rate of audit findings that were wrong or misdirected on measurement rather than on
reading.** They named four of their own. I re-measured mine, since the published
accessibility statement names these four and a wrong finding here is a public one.

Item 1 said charts have "no text or table equivalent **exposed to assistive
technology**". That phrasing is wrong, and wrong in the direction that misdirects the
work. Measured on `9a1ac02`, there are two distinct populations:

- **Eight chart surfaces already carry `role="img"` with a descriptive `aria-label`** —
  the three in [analytics/charts.tsx](src/components/analytics/charts.tsx) (line, index
  trend, sport-balance radar), [engine-lab-trend-card.tsx](src/components/dashboard/engine-lab-trend-card.tsx),
  the three in [interference-detail.tsx](src/components/analytics/interference-detail.tsx),
  and [acwr-trend-chart.tsx](src/components/analytics/acwr-trend-chart.tsx). Something
  *is* exposed.
- **Eight have nothing at all**: `compare-chart`, `moving-average-chart`, `volume-chart`,
  `training-zones-chart`, `trend-panel`, `fatigue-recovery-chart`, `projection-chart`,
  `intensity-distribution`.
- **None of the sixteen has a data equivalent.** No `<table>`, no `sr-only` value list,
  anywhere among them.

So the *published statement* — "Charts do not yet have a text equivalent" — is accurate
and needs no edit: `aria-label="Index trend chart showing split, endurance and strength
over 20 data points"` announces that a chart exists and what it is about, and conveys
none of what it says. A label is not an equivalent, and WCAG 1.1.1 asks for one that
serves the equivalent purpose.

The *finding* was the imprecise thing, and the imprecision has a cost: it describes one
undifferentiated problem where there are two, with different fixes. Half need a data
equivalent added alongside a label that already exists; the other half need the label
first. Anyone working from the finding as written would do the same work in both places.

Items 2, 3 and 4 re-checked at the same time and all three stand:

- **Item 2 confirmed.** [engine-lab-trend-card.tsx:69-71](src/components/dashboard/engine-lab-trend-card.tsx#L69)
  ties each legend entry to its line with a coloured dot and no second cue — no dash
  pattern, no marker shape. The series *names* are in text, so this is narrower than
  "signalled by colour alone" implies, but the legend-to-line mapping is colour-only and
  that is the 1.4.1 failure.
- **Item 3 confirmed** (see the entry above): `role="alert"` present, `aria-describedby`
  / `aria-errormessage` / `aria-invalid` absent.
- **Item 4 is not falsifiable from code** — it asserts that no manual walkthrough has been
  done, and no walkthrough has been done.

One of four needed correcting, and it was a precision error rather than a false claim.
Recorded anyway: this document is used to decide what to build, and a finding that sends
someone to do unnecessary work costs the same whether it is wrong or merely vague.

**ITEM 1 — EIGHT CHART SURFACES NOW CARRY THEIR DATA. Not closed; the remainder is named.**

[ChartFigure](src/components/analytics/chart-figure.tsx) renders two siblings: the chart in
a `role="img"` wrapper with its name, and an `sr-only` region holding a one-sentence summary
and a real `<table>` of the values, with `<caption>`, `scope="col"` headers and the first
cell of each row as `scope="row"` so a reader hears "week 3, load 412" rather than a bare
number.

**Siblings and not nested, which is the whole trick.** `role="img"` makes its subtree
presentational, so a table inside it is invisible to a screen reader — the fix would render,
look correct in the DOM, and do nothing. There is a test asserting the table appears after
the `role="img"` element closes.

The summary is a required prop rather than something derived, because
[describeSeries](src/lib/a11y/describe-series.ts) cannot know which number matters: "Split
Index rose from 412 to 448" and "your acute:chronic ratio stayed in the optimal band" are
the same shape of data and different sentences. It is a pure function with real tests —
one point is reported as a reading and not a trend, a flat line is "unchanged" without
dividing by a zero delta, and the range clause appears only when the line moved and came
back, which is the case where endpoints alone are true and useless.

**Long series are capped at 40 rows** with the table saying so. A year of daily points is
365 rows, and handing a screen-reader user that is a worse problem than the one being fixed;
at that length the summary is what carries the meaning, which is also what a sighted reader
takes from the shape of the line.

**Covered (8):** the three in [charts.tsx](src/components/analytics/charts.tsx) — index
trend, split/endurance/strength trend, sport-balance radar — plus `trend-panel`,
`moving-average-chart`, `volume-chart`, `fatigue-recovery-chart` and `projection-chart`.

**The remaining five time series are now done too.** `acwr-trend-chart`, the three in
`interference-detail`, and `engine-lab-trend-card`. **Thirteen chart surfaces carry their
data, and no chart anywhere is left with a bare `role="img"`** — there is a test asserting
that, because reverting one to a label-only wrapper looks entirely reasonable in a diff and
is exactly the state this finding describes.

Two of the five needed a sentence `describeSeries` could not have written, which is the
argument for the summary being a required prop rather than derived:

- **ACWR** is not about the shape of the line but which *band* the ratio sits in — the plot
  draws optimal (0.8–1.3) and danger (>1.5) as shaded regions. The summary names the band
  in words and the table carries a Zone column, so "1.12, in the optimal band" survives
  instead of "up from 0.94 to 1.12", which reports the movement and loses the meaning.
- **The interference charts** are categorical comparisons — weeks with a strength session
  against weeks without, efficiency by days since the last one — so each got its own
  sentence naming both sides.

Writing them surfaced a small pre-existing inaccuracy: `cardioToStrength`'s two averages are
`number | null` and were passed straight to recharts, which renders a gap. The table now
says "no reading", which is the same gap said out loud.

**STILL NOT COVERED — three charts, named with reasons in the test's allowlist.**
`training-zones-chart` (a heart-rate zone histogram), `intensity-distribution` (two donuts
side by side) and `compare-chart` (two athletes rather than one series over time). All three
are categorical, so `describeSeries` does not fit and each needs a sentence written for it —
the same reason the interference charts needed theirs, without the same shape to copy.
`recovery-gauge` and `progress-ring` are single-value indicators rather than charts, and
`hero-split`, `product-showcase` and `oauth-icons` are decoration.

So "Charts do not yet have a text equivalent" is still true of three surfaces, and the
published statement stays as written. Checked before leaving it, rather than closing the
finding from the register.

**ITEM 3 — MOSTLY CLOSED, and deliberately not claimed as closed.**

Every input that lives inside a `Field` or one of the `components/ui` controls now points
at its own error with `aria-describedby`, and carries `aria-invalid` when it has one.
`role="alert"` stays: announcing the error when it appears and being reachable from the
field afterwards are two different requirements, and the app now meets both.

Covered: **78 `<Field>` call sites** — the whole activity-logging surface, through a
`FieldErrorContext` that gives the message an id and hands the reference to `GlassInput`,
`UnitInput` and `HeroInput` — plus `Input`, `Select` and `Textarea` in
[components/ui/input.tsx](src/components/ui/input.tsx).

`aria-describedby` rather than `aria-errormessage`, deliberately. `aria-errormessage` is
the semantically precise answer and reads better on paper; support is materially worse,
and a user on one of the pairings that ignores it gets nothing at all — which is the state
being left behind. Revisit when support catches up: one line in each component.

**NOT covered, which is why the published statement is unchanged.** Nine `<FieldError>`
render at *block* level rather than beside a field — four in
[interval-blocks.tsx](src/components/activities/interval-blocks.tsx) and five in
[gym-form.tsx](src/components/activities/gym-form.tsx). `errors["ex.<id>.sets"]` describes
a control somewhere inside a repeated row and is drawn after the whole row, so there is no
single element to attach it to without restructuring how those forms report. That is a
real piece of work, not an oversight, and until it is done the statement's wording — "Form
errors are **not always** tied to their field" — is exactly true, so it stays as written.

Three further `role="alert"` sites were checked and are correctly out of scope:
`article9-consent-card`, `goals-panel` and `upcoming-races-panel` render *form-level*
failures ("that save did not work"), which belong to no field and have nothing to be tied
to.

The testable half is a real unit test rather than a source scan:
[field-describedby.ts](src/lib/a11y/field-describedby.ts) exists as its own module so the
merging rules can be executed — that a caller's existing `aria-describedby` is preserved
and read first, that the hint reference is dropped while the error is showing (the
components swap one for the other, so pointing at the hint would dangle), and that both
attributes are omitted rather than emitted empty or `false`. The component wiring is
checked by reading the source, which is weaker and is labelled as such in the file: this
project has no React testing library, which is the reason the logic worth testing was
moved out of the component to begin with.

#### N8 — Seventeen call sites still resolve entitlement themselves
**WP6.2 · Low · Evidence: `grep -rln isPremiumUser src` — 21 sites, 4 migrated.**

They are correct: the matrix says so, and it passes against the pre-migration
code. The finding is duplication, not a defect. Each re-queries `profiles` for
its own columns, which is how two entitlement concepts — `isPremiumUser` and the
card-less `hasSoftTrialAccess` — came to coexist without either knowing about
the other.

Low because nothing is currently wrong, and worth doing because the next
divergence will be silent in exactly the same way.

#### N9 — `elevated_query` has an event type and ten missing call sites
**WP7 · Low · Evidence: `createAdminClient` is called in 12 places; 2 record it.**

The service-role client bypasses row level security entirely, and WP7 lists
elevated-credential queries among the events to record. The two admin routes log
their access; the other ten — both webhooks, both crons, account deletion, the
races catalogue, squad join, profile creation, admin-role resolution and the
audit writer itself — do not.

Worth doing with the N8 entitlement migration rather than separately: both are
the same sweep through overlapping call sites, and doing them together means
reading each one once.

#### N10 — Email addresses sit in a column the anon key can read

**WP1 / WP11 · High · Raised 2026-09-07, from a peer session's fix. Evidence below.**

A concurrent session found and fixed this on `main` (`8623658`): onboarding wrote
`user.email` into `profiles.display_name` whenever the identity provider returned no
name — every ordinary email/password signup — and `display_name` is the athlete's
public name on the leaderboards, the feed, the friends list and both share cards.
The fix is right and the reasoning is right. **It is also application-layer only, and
two gaps remain that keep the data readable.** Verified here rather than taken on
trust, because the commit message says "That fixes new accounts."

**Gap 1 — the database trigger still writes the address.** `handle_new_user()`, as
last set by [007:14-18](supabase/migrations/007_signup_trigger_bulletproof.sql#L14),
is unchanged and still reads:

```sql
INSERT INTO public.profiles (user_id, display_name)
VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email))
```

It fires on `auth.users` INSERT — at signup, **before** onboarding runs. So every new
email/password signup still gets an email address written into `display_name` at the
database layer. Onboarding now overwrites it with null, which closes the case for
anyone who reaches that step; it does nothing for anyone who abandons onboarding, and
it leaves a window for everyone else. The same expression appears in that migration's
backfill at line 54.

**Gap 2 — `public_profiles` publishes the column to `anon`, and PostgREST does not run
TypeScript.** This one is mine. Migration 056 — WP1, the fix for C1–C4 — created the
view with `display_name` among its twelve columns and
[056:446-447](supabase/migrations/056_public_projections.sql#L446)
`GRANT SELECT ON public_profiles TO anon`. `publicDisplayName` guards the render sites
in our code; it cannot guard `GET /rest/v1/public_profiles?select=display_name`, which
anyone can issue with the anon key that ships in the client bundle by design.

I wrote in that migration: *"Do not add a column here without asking whether a
logged-out stranger should have it."* I added `display_name` and did not ask whether it
could contain an email address. Had this been caught in Phase 0 it would have sat with
C1–C4 as a Critical; it is High only because the exposed population is narrower.

**Who is actually exposed.** The view is `WHERE p.username IS NOT NULL`, so athletes
who abandoned onboarding are excluded — their address stays in the table but out of the
view until they pick a username. The exposed set is **existing athletes who completed
onboarding before `8623658` and whose `display_name` still holds an address**. That is
readable from the internet right now.

**CLOSED `ff0ab52` — migration
[064_display_name_is_never_an_email.sql](supabase/migrations/064_display_name_is_never_an_email.sql),
by a peer session, and by a better route than the one I proposed.**

It does two things. `handle_new_user()` stops writing the address — a provider-supplied
name is still used, and absent one the column stays NULL, which every render site
already falls back from. That covers Gap 1, including the abandoned-onboarding case.
And **both** views mask an address that is already stored:

```sql
CASE WHEN p.display_name LIKE '%@%' THEN NULL ELSE p.display_name END
```

**Where my own proposal was worse, recorded because the reasoning is the useful part.**
I wrote migration 061 (on `venture/b1-b2-iap-routing`, now dead and never landed) to fix
the trigger and then *scrub* the stored rows with an `UPDATE`. I explicitly rejected
masking at the view, on the grounds that it would overrule a self-chosen disclosure —
citing 056's own line about `injury_status`, that "self-chosen disclosure is a different
thing from inferred health data". That was too clever for the situation. The column was
full of addresses **nobody chose**; the self-disclosure case was the rare one, and I let
it drive the design for the common one.

Masking is strictly better here on two counts:

1. **It is not destructive.** The exposure closes while the value stays intact and
   recoverable, so the `UPDATE` stops being load-bearing for privacy and becomes a
   separate question — whether the app should hold the address in that column at all.
   That decision can now be made with numbers and without pressure; the impact query and
   the `UPDATE` are in 064 as comments.
2. **It covers `leaderboard_profiles`, which my 061 did not touch at all.** I scoped to
   `public_profiles` because `anon` was the headline, and missed that the same column is
   served to every authenticated athlete. Smaller blast radius than the internet, still
   every athlete on the platform reading every other athlete's address. That is a
   straightforward miss on my part and the second one in this finding.

**A history hazard this created, which the tree does not show.** 064 landed as two
commits. `da224f7` added it as `062`, rebuilt from 056 — which silently dropped
`AND u.email_confirmed_at IS NOT NULL` and would have re-exposed every unverified
account, a worse leak than the one being closed. `ff0ab52` renamed it to 064 and
regenerated it from 061 with the gate intact. Both went up in one push, so main's tip was
never in the flawed state and Vercel only ever built the good one. Verified here:
`git show da224f7:supabase/migrations/062_display_name_is_never_an_email.sql | grep -c
email_confirmed_at` returns **0**; main's current 064 returns **3**. That tree also
carried a duplicate `062`, since `062_admin_access_log.sql` already existed.

The practical consequence is narrow but sharp: **`git revert ff0ab52` restores the flawed
migration**, and so does cherry-picking `da224f7` onto another branch. Anyone undoing the
rename must undo both commits or neither. If those views are ever rebuilt, rebuild from
064 — never from 056.

**Still outstanding, and no longer urgent:**

1. Decide whether to run the `UPDATE` in 064's comments. This is now data minimisation
   under the storage-limitation principle, not exposure — the addresses are masked either
   way. Run the impact query first for the count.
2. Re-ask the WP1 question about every remaining column in `public_profiles`, since the
   process failure was mine and column-by-column is the only way to find another. `bio` is
   the next one to look at: also free text, also published to `anon`, and nothing has ever
   audited what people put in it.

A CHECK constraint was considered and rejected by both sessions independently: it would be
evaluated inside the trigger's INSERT, so one unexpected provider payload would fail signup
entirely — a privacy defect traded for an outage.
A CHECK constraint on `display_name` was considered and rejected: it would make the
signup trigger's INSERT fail, turning a privacy defect into a total signup outage.

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

#### N11 — `REVOKE ... FROM PUBLIC` does not revoke from `anon`

**WP1 / WP7 · High · Raised 2026-09-07, from a peer session's probe against production.**

A Supabase project bootstraps with `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON
FUNCTIONS TO anon, authenticated, service_role`. Every function created afterwards is
therefore granted to `anon` **by name**, at creation. `REVOKE ALL ON FUNCTION f() FROM
PUBLIC` removes only the implicit PUBLIC grant and leaves that direct one standing.

Found twice on the same day, from opposite directions, and neither was visible in review
because both lines look exactly like the correct thing:

- A peer's 065 wrote `GRANT ... TO authenticated, service_role` believing it restricted.
  It added. Fixed in their 066.
- My 060, 061 and 063 each wrote `REVOKE ... FROM PUBLIC` believing it removed. It removed
  half.

**Which of mine actually mattered, measured rather than assumed.** The peer flagged
`withdraw_article9_health_data` — an unauthenticated caller reaching a function whose job
is to purge Article 9 health data, which sounds like the worst of them. It is not
exploitable, and the reason is worth stating precisely: it is SECURITY DEFINER, so it can
reach the tables, but every statement is scoped `WHERE user_id = auth.uid()`, and an anon
JWT carries no `sub` claim, so `auth.uid()` is NULL. `user_id = NULL` is NULL, never TRUE.
Zero rows updated, zero deleted. A no-op by construction rather than by permission.

**The one that matters is `prune_security_events`, which nobody was looking at.** Also
SECURITY DEFINER, and it selects rows **by date** — there is no `auth.uid()` in it, so
there is no NULL to save it. If `anon` holds EXECUTE, an unauthenticated request can make
the security and audit log prune itself on demand. The blast radius today is small because
it deletes only rows already past 90 or 365 days and this database is young — but that is
an accident of the calendar, not a property of the design.

**ADDRESSED `067`, not applied.**
[067_revoke_execute_from_anon.sql](supabase/migrations/067_revoke_execute_from_anon.sql)
revokes `PUBLIC, anon` explicitly on all four functions the audit introduced, keeps
`authenticated` on the Article 9 withdrawal path (removing it would swap a permissions
defect for a compliance one), and carries a `pg_proc.proacl` query to run before and after.
Checked before writing that revoking cannot break an anonymous read: `caller_email_verified`
is referenced only in the `WITH CHECK` of three RESTRICTIVE **INSERT** policies, and anon
does not insert.

**Three pre-existing functions are deliberately left alone**, recorded in
`function-grants.test.ts` as a named allowlist with reasons rather than silently skipped.
`sync_profile_current_index` and `update_updated_at` both `RETURNS TRIGGER`, which Postgres
refuses to invoke directly and PostgREST does not expose. `activity_is_visible_to` is
referenced by a SELECT policy on `activities`, so revoking EXECUTE could turn "returns no
rows" into "the query errors" for an anonymous reader — that needs a database to settle and
was not guessed at with a submission pending.

**APPLIED AND VERIFIED 2026-09-07.** A peer session probed production with the anon key
after Stephen applied 067 and 068. `prune_security_events`,
`withdraw_article9_health_data`, `caller_email_verified` and `replace_personal_records` all
return 42501 permission denied; `handle_new_user` returns 404, because PostgREST does not
expose trigger functions. What must still work does: `service_role` still reaches
`replace_personal_records`, and an anonymous read of `public_profiles` still returns 200, so
the logged-out profile page is intact. (A trap for whoever repeats this: PostgREST maps
42501 to **401**, not 403 — easy to misread as the anon key itself being broken.)

**`activity_is_visible_to` is now SETTLED, and the answer is do not revoke.** I had left it
in the allowlist as "needs a database to settle"; a peer settled it. The four policies in
031 that call it carry no `TO` clause, so they apply to PUBLIC — which includes anon — and
an anonymous `SELECT` on `activities` returns 200 with an empty array today, which proves
the policy is evaluated and the function called as anon. Revoking EXECUTE would turn that
empty result into a permission error on a table the app reads while logged out. Closing it
properly means re-scoping those policies `TO authenticated` first, which is a behaviour
change and belongs in its own migration.

**A FIFTH FUNCTION, AND A FLAW IN MY OWN GUARD.** `latest_strength_scores(p_user_id UUID)`
from migration 019 was also executable by anon. Measured with a real user id lifted from
the anon-readable view: anon reaches it and gets zero rows, `service_role` gets the row —
SECURITY INVOKER with RLS doing the work, so no exposure, same wrong grant. Fixed by a peer
in 069.

`function-grants.test.ts` did not catch it, and the reason is worth recording because the
test looked right. It filtered to SECURITY DEFINER functions, and **that is the wrong
axis**: the grant defect is independent of the security mode. INVOKER limits the damage —
RLS still applies — it does not make the grant intended, and a function flipped from INVOKER
to DEFINER later gains its privileges with no grant statement in the diff to review. The
test now checks **every** function any migration defines. Verified it fails, naming
`latest_strength_scores` and `replace_personal_records`, against the tree my earlier version
passed.

**The generalisable finding, now three for three.** The defect is not in any one migration.
It is that on Supabase neither `GRANT ... TO authenticated` nor `REVOKE ... FROM PUBLIC`
means what it reads as, and both failure modes are invisible in review because both lines
look exactly like the correct thing. None of the three was found in the migration its author
was writing at the time. The only reliable check is enumerating `CREATE FUNCTION` across
**all** migrations and probing each with the anon key — not auditing the file in front of
you.

**Outstanding:** apply 069; then re-scope the 031 policies `TO authenticated` if
`activity_is_visible_to` is to be closed.

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

**Still open as of 2026-09-07**, after WP1, WP2, WP3 (part), WP4, WP5, WP6, WP7,
WP11, WP12, WP13, WP14 (part) and CI, and including the nine findings raised
during remediation:

| Severity | Open | Partial | Closed | Total | Which |
|---|---|---|---|---|---|
| Critical | **0** | 0 | 4 | 4 | All four were one defect in four places. |
| High | 2 | 1 | 8 | 11 | Closed H1, H3–H8 and N10. Partial H2. Open H9 (DPIA — Stephen's) and N11. |
| Medium | 4 | 2 | 11 | 17 | Closed M1–M6, M8, M9, M10, M13, M14. Partial M7, M11. Open M12, N1, N5, N7. |
| Low | 5 | 0 | 7 | 12 | Closed L1–L6, N4. Open N2, N3, N6, N8, N9. |
| **Total** | **11** | **3** | **30** | **44** | |

**Correction to this table's arithmetic.** Earlier revisions reported "41 findings
raised" and columns that did not sum to it: partially-closed findings were counted
in neither the open nor the closed column, so the rows silently lost them. Counted
by hand off the headings — C1–C4 (4), H1–H9 (9), M1–M14 (14), L1–L6 (6), N1–N11 (11)
— the total is **44**, and partials now have a column of their own so the rows add
up. The finding text was always right; only the summary was wrong.

One of the thirteen is open on purpose rather than for want of effort: **M12**
— no index was added, because no query plan could be produced. Named here so a
later reader does not mistake it for something quietly dropped.

**M9 is marked closed with a caveat worth reading.** The strict policy now
covers every route holding athlete data. The public marketing and legal pages
keep `'unsafe-inline'`, deliberately, so that they stay statically rendered.
That residual is stated in the finding rather than counted as fixed.

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
| 9 | ~~**WP7 logging**~~ **DONE `4d55a69`** | H6; N9 opened | Build the redaction rule in from the first line, not after. |
| 10 | ~~**WP14 headers, WP11 deletion test, WP8 plans**~~ **DONE** `f84b4eb`, `25ad889`, `6b6aebf`, `7893c0c`, `695c2d3` | M5, M8, M9, L2, L4, L5 closed. **M12 stays open** — no query plan was obtainable, so no index was added | Independent, parallelisable, none blocking. |
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

**Step 10 is done.** M5, M8, M9, L2, L4 and L5 are closed (`f84b4eb`,
`25ad889`, `6b6aebf`, `695c2d3`). M12 is open
by design — WP8 forbids an index without a query plan and no database was
reachable, so the measurement shipped instead of a guess (`7893c0c`). M9 is
closed on the authenticated surface (`695c2d3`): the strict nonce policy went
where the athlete data is, and the marketing and legal pages kept the previous
policy so they could stay static — 10 prerendered routes rather than 0.

What remains needs a live database (N5's GoTrue integration tests, M12's query
plans, the erasure cascade check), a decision from Stephen (H9's DPIA, the EU
question), or a sweep through call sites (N1, N8, N9). No open finding is now
blocked on engineering judgement alone.

**Remaining High findings:** H2 (most routes still unparsed — N1) and M7/N5
(GoTrue session behaviour unverifiable without an integration environment), both
partially addressed and neither closable from here alone. **N10 is closed** — see
the finding; it was raised and closed on the same day, by two sessions, and the
version that landed was not mine.

**Eight operator items outstanding** (this heading read "Four" while listing
five; corrected, and two more added by the WP8/WP11 batch):

1. Create the security contact address in SECURITY.md. It is a placeholder, and
   a bouncing vulnerability report is worse than no address at all.
2. Confirm Vercel's Preview environment does not carry production secrets. Not
   visible from the repository, and the most common way a production key ends up
   somewhere it should not be.
3. Set `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` in Vercel, or the
   per-user rate limits are advisory and only the per-instance burst guard
   applies.
4. Set the GoTrue rate limits and confirm email confirmation is enabled — the
   table is in SECURITY.md. **Run the impact query at the top of migration 061
   before applying it**; it can otherwise stop every athlete logging.
5. Create `accessibility@splitindex.co.uk`, the contact on the published
   accessibility statement, which promises a reply within 5 working days.
6. **Decide whether to run the `UPDATE` in migration 064's comments** (N10).
   No longer urgent and no longer about exposure: 064 masks the column in both
   views, so the addresses are already private. What remains is whether the app
   should still be storing them at all — data minimisation under the
   storage-limitation principle. Run the impact query in that file first, so the
   decision is made with a count rather than a guess.
7. Run [wp8_hot_query_plans.sql](supabase/diagnostics/wp8_hot_query_plans.sql)
   against production or a restored copy, with a heavy user substituted for
   `ATHLETE_UUID`. Ten plans and an unused-index sweep. M12 cannot close without
   them, and no index should be added before them.
8. Delete one real throwaway account and confirm the cascade actually fires in
   the deployed database. The test in `account-deletion.test.ts` reads migration
   DDL; it proves the schema declares the cascade, not that production has it.
   Given migration 049's history, source and production have diverged here before.
