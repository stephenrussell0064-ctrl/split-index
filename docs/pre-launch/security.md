# Split Index — pre-submission security and privacy audit

**Scope:** whole repository, not a diff. Branch `hybrid-plan-engine` @ `adb35c5`.
**Method:** read of all 47 route handlers under `src/app/api/**`, all 20 server components
under `src/app/(app)/**`, all 55 files in `supabase/migrations/`, the social/scoring/GPS
libraries, `next.config.ts`, `src/proxy.ts`, `capacitor.config.ts`, `ios/App/App/Info.plist`,
`.env.example`, and a pickaxe scan of all 331 commits.
**No source file was modified.** This document is the only artefact.

> **Scope limit, stated up front.** Every RLS finding is read from *migration source*, not
> from the live database. I have no production credentials from this environment, so I could
> not enumerate `pg_policies` / `pg_tables` against the real project. Migration source and a
> live database can disagree — migration `049` exists precisely because a version-number
> collision meant a privacy fix silently never applied. **Run the enumeration against
> production and reconcile before signing anything off.** If the live database is worse than
> the source, these findings get worse.

---

## Verdict

**Do not submit.** Three Critical findings each independently expose every user's data or the
paywall, and all three are reachable by anyone holding the `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
which ships inside the iOS and Android bundles (`src/lib/supabase/client.ts:5`; the Capacitor
build loads the live site over `server.url` in `capacitor.config.ts:28`, so the key is in the
JS payload either way). Extracting it takes a proxy and five minutes.

The application layer is genuinely good — every API route authenticates, every activity query
scopes by `user_id`, the admin surface is correctly gated. The problem is underneath it: the
database is doing far less filtering than the routes assume, and PostgREST is directly
reachable with the anon key, so the routes are not the boundary.

---

## Findings

### CRITICAL

---

#### C1 — Any user can grant themselves Premium by writing to their own profile row

**File:** `supabase/migrations/002_scoring_reference_and_leaderboards.sql:231-233`
(re-asserted `supabase/migrations/002b_apply_missing.sql:235-238`)

```sql
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
```

The policy is row-scoped and correct as far as it goes — you cannot write someone else's row.
But Postgres RLS has no notion of columns, and there is no compensating column-level `GRANT`,
no `REVOKE`, and no `BEFORE UPDATE` trigger anywhere in the 55 migrations. So an authenticated
user may write **every column of their own row**, including `subscription_tier`,
`subscription_status`, `subscription_sku`, `subscription_source`, `stripe_customer_id` and
`current_split_index`.

Every paid gate in the product reads exactly those two columns:
`isPremiumUser(tier, status)` at `src/lib/retention/trial.ts:19-24`, consumed by
`src/lib/premium/features.ts:27-46`, `src/app/api/export/activities/route.ts:42`,
`src/app/api/social/leaderboard/detail/route.ts:23-29`,
`src/app/api/reports/hybrid/card/route.tsx:27`, `src/app/api/activities/route.ts:836`, and the
dashboard/analytics surfaces. Stripe and RevenueCat write those same columns
(`src/app/api/stripe/webhook/route.ts:47-52`, `src/app/api/revenuecat/webhook/route.ts:73-81`)
— so the client and the payment processors have equal authority over the entitlement.

**Exploit.** Sign up for a free account in the App Store build. Read the anon key out of the
bundle and the access token out of the app's storage, then:

```bash
curl -X PATCH "$SUPABASE_URL/rest/v1/profiles?user_id=eq.$MY_UID" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $MY_JWT" \
  -H "Content-Type: application/json" \
  -d '{"subscription_tier":"premium","subscription_status":"active"}'
```

Full Premium — AI coaching, data export, global leaderboards, hybrid reports, leaderboard
detail cards — for £0, permanently, with no Stripe or StoreKit involvement. Nothing reconciles
the column against the processors, so it is never noticed.

The same write sets `current_split_index` to 999. `src/app/api/cron/leaderboard/route.ts:31-38`
reads `profiles.current_split_index` verbatim and ranks on it, so the attacker takes rank 1 on
every global leaderboard with no activity logged. (The `sync_profile_current_index` trigger at
`054_profile_index_follows_latest_session.sql:96` only fires on `split_index_history` writes,
so a direct profile write is never corrected.)

Writing another user's `stripe_customer_id` into your own row is also possible; the column is
`UNIQUE`, so it permanently breaks that victim's checkout (`src/app/api/stripe/checkout/route.ts:63-66`).

**Fix.** RLS cannot do this; column privileges can, and PostgREST honours them:

```sql
REVOKE UPDATE ON public.profiles FROM authenticated, anon;
GRANT UPDATE (username, display_name, avatar_url, bio, country, date_of_birth, age,
              height_cm, weight_kg, max_hr, gender, experience, training_history_years,
              goals, preferred_sports, onboarding_completed, timezone, scoring_basis,
              training_split, injury_status, primary_motivation, split_endurance_weight,
              share_activities_with_friends)
  ON public.profiles TO authenticated;
```

Add a regression test that asserts an authenticated PATCH of `subscription_tier` returns 403.

---

#### C2 — The entire `profiles` table is readable with the anon key, unauthenticated

**File:** `supabase/migrations/001_initial_schema.sql:338`

```sql
CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (username IS NOT NULL);
```

There is no `TO` clause on this policy — nor on any policy in any of the 55 migrations
(`grep -n "TO authenticated" supabase/migrations/*.sql` returns nothing). A policy with no
`TO` applies to role `public`, which includes **`anon`**. So the predicate is the *whole*
access control: have a username, be readable by the world.

`profiles` is not a display table. Its columns (`001_initial_schema.sql:45-68` plus
`008/016/017/026/044/045/053`) include `date_of_birth`, `gender`, `weight_kg`, `height_cm`,
`max_hr`, `injury_status`, `country`, `timezone`, `primary_motivation`, `stripe_customer_id`,
`subscription_tier`, `subscription_status`, `current_split_index`.

**Exploit.** No account needed:

```bash
curl "$SUPABASE_URL/rest/v1/profiles?select=*&limit=1000" -H "apikey: $ANON_KEY"
```

That is the date of birth, sex, bodyweight, height, max heart rate, current injury and country
of every registered athlete, in one paginated request, from an unauthenticated attacker. Under
UK GDPR Art. 9 that is special-category health data, and this is a reportable personal data
breach the moment it is exercised. It also hands an attacker a clean deanonymisation join key
(`stripe_customer_id`) and a subscriber list.

Note that the application code is already careful here — `fetchFriendsData`
(`src/lib/social/queries.ts:65-71`) deliberately avoids `select("*")` for exactly this reason
and says so in a comment. The comment is right; the policy underneath it is what fails.

**Fix.** Drop the policy. Expose only what the social surfaces actually read, through a view:

```sql
DROP POLICY "Public profiles readable" ON profiles;

CREATE VIEW public_profiles WITH (security_invoker = false) AS
  SELECT user_id, username, display_name, avatar_url, bio, country,
         preferred_sports, current_split_index, current_endurance_index,
         current_strength_index, injury_status, created_at
  FROM profiles
  WHERE username IS NOT NULL AND share_activities_with_friends = true;

GRANT SELECT ON public_profiles TO anon, authenticated;
```

Then repoint `fetchPublicProfile`, `fetchFriendsData`, `fetchSquads`, `fetchDuels`,
`fetchCompareHistory` and the feed's author lookup (`src/lib/social/feed.ts:278`) at the view.
Note the `share_activities_with_friends` predicate — it also closes **H1**.

---

#### C3 — Every user's scores, 1RMs and bodyweight history are readable with the anon key

**Files:**
`supabase/migrations/001_initial_schema.sql:352` — `workout_scores FOR SELECT USING (true)`
`supabase/migrations/001_initial_schema.sql:356` — `split_index_history FOR SELECT USING (true)`
`supabase/migrations/012_public_read_strength_scores.sql:7` — `strength_scores FOR SELECT USING (true)`
`supabase/migrations/002_scoring_reference_and_leaderboards.sql:214` — `leaderboard_entries FOR SELECT USING (true)`

Same root cause as C2: `USING (true)`, no `TO` clause, therefore anon. These are not
aggregates — they are the raw per-user rows.

- `strength_scores` (`002:43-58`) carries `user_id`, `exercise_name`, `estimated_1rm_kg`,
  **`bodyweight_kg`**, `relative_strength`, `recorded_at`. That is a longitudinal bodyweight
  time series for every athlete, public.
- `workout_scores` (`001:127-139`) carries `user_id` and `score_breakdown JSONB`, which holds
  `cardio_activity` (VO2max, HR efficiency, decoupling, race predictions) and `per_lift` — see
  `src/lib/social/feed.ts:169-184`, which exists specifically to *avoid* showing a friend the
  full blob, and `src/lib/scoring/presentation.ts`'s `serializeScoreBreakdown`, which
  premium-gates it. Both are cosmetic: the whole object is one anon HTTP request away.
- `split_index_history` (`001:144-155`) carries `fatigue_score`, `recovery_score`,
  `predicted_index_7d` per day per user.

**Exploit.**

```bash
curl "$SUPABASE_URL/rest/v1/strength_scores?select=user_id,exercise_name,estimated_1rm_kg,bodyweight_kg,recorded_at" \
  -H "apikey: $ANON_KEY"
```

Join on C2's `profiles` dump and you have named athletes with their sex, date of birth,
bodyweight trajectory and cardiovascular fitness metrics. This is the highest-value single
finding in the audit and it needs no credentials at all.

Worse, it makes the premium gating decorative: `fetchLeaderboardDetail`
(`src/lib/social/queries.ts:527-548`) is carefully gated behind a Premium check in
`src/app/api/social/leaderboard/detail/route.ts:23-29`, and reads `workout_scores` — which
anyone can read directly.

**Fix.** These policies exist to make leaderboards work (the migration comments say so
explicitly). Leaderboards need aggregates, not rows. Replace each with:

1. `DROP POLICY` on all four.
2. A `leaderboard_public` view exposing only `user_id, username, split_index, endurance_index,
   strength_index, rank, period` for profiles that have not gone private, granted to
   `authenticated` only (a leaderboard behind login is normal and costs nothing).
3. Keep the per-user `FOR ALL USING (auth.uid() = user_id)` policies for own-data reads.
4. Repoint `src/lib/social/leaderboard.ts`, `src/lib/social/dimension-leaderboards.ts` and
   `fetchLeaderboardDetail` at the view.

---

### HIGH

---

#### H1 — "Private account" does not make the public profile, compare or leaderboard-detail private

**Files:**
`src/lib/social/queries.ts:355-432` (`fetchPublicProfile`)
`src/app/(app)/social/profile/[username]/page.tsx:10-25`
`src/lib/supabase/proxy.ts:39-41` (route deliberately exempted from the auth redirect)
`src/app/api/social/compare/route.ts:26-53`
`src/app/api/social/leaderboard/detail/route.ts:31-37`

Migration `049` is explicit that `share_activities_with_friends` governs *activities*. Nothing
extends it to the profile page. `fetchPublicProfile` does `select("*")` and never reads the
flag, and the page is one of exactly two paths `proxy.ts` lets through unauthenticated.

So an athlete who toggles "Private account" in Settings still has
`splitindex.co.uk/social/profile/<username>` serving their display name, avatar, bio, country,
current Split Index, endurance/strength indices, 30-day activity count, training streak and
**injury status** to anyone with the URL — and to search engines, since the page emits
`generateMetadata` and has no `noindex`.

`/api/social/compare` accepts an arbitrary `username` or `userId` and charts that user's
`split_index_history` with no friendship check and no privacy check. `/api/social/leaderboard/detail`
accepts an arbitrary `userId` and returns their top four lifts and race predictions to any
Premium requester, again with no privacy check. Both are IDOR by design rather than by
accident — the ids are meant to be arbitrary — but neither consults the setting the user
believes protects them.

**Exploit.** Target sets their account private after a public falling-out. Attacker opens
`/social/profile/target` in a logged-out browser and reads their index, streak and current
injury; then, from any Premium account, `GET /api/social/leaderboard/detail?userId=<target>`
for their squat, bench and deadlift 1RMs.

**Fix.** In `fetchPublicProfile`, select `share_activities_with_friends` and return `null`
(→ `notFound()`) when it is `false` and the viewer is not the owner. In `/api/social/compare`
and `/api/social/leaderboard/detail`, require either an accepted friendship or
`share_activities_with_friends = true` on the target. C2's view predicate does most of this
for free.

---

#### H2 — The privacy policy does not mention location, health-sensor or in-app-purchase data

**Files:** `src/app/privacy/page.tsx:52-96` (§2 "What data we collect"), `:150-180` (§5
processors) vs. `ios/App/App/Info.plist:69-85`.

The iOS bundle declares:

| Key | Purpose string present |
|---|---|
| `NSLocationWhenInUseUsageDescription` | yes |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | yes — **background** location |
| `NSHealthShareUsageDescription` | yes — reads heart rate from Apple Health |
| `NSHealthUpdateUsageDescription` | yes |
| `NSBluetoothAlwaysUsageDescription` | yes — HR straps, Concept2 |
| `NSMotionUsageDescription` | yes |

The privacy policy's §2 lists no location category at all, no HealthKit, no Bluetooth sensor
data, no motion data. §5 lists Supabase, Vercel, Stripe, Google and OpenAI — but not
RevenueCat (`src/app/api/revenuecat/webhook/route.ts`), Apple, Google Play, or the CARTO
basemap tile CDN that every rendered route map contacts (`src/components/activities/route-map.tsx:41-44`,
which leaks the fact and rough time of a map view to a third party).

This is an App Review blocker independently of the security findings: App Store Review
Guideline 5.1.1 requires the privacy label and policy to match what is collected, and 5.1.3
requires HealthKit apps to have a privacy policy that specifically describes health data
handling. A background-location entitlement with no location clause in the policy is a
predictable rejection.

**Fix.** Add to §2: precise location and GPS route data (noting the 200 m privacy-zone
truncation as a mitigation), heart rate from Apple Health and Bluetooth sensors, and motion
and step data. Add RevenueCat, Apple and Google to §5, and disclose the map tile provider.
Add a location-retention line to §9. Also revisit §12: the policy says "under 13" while the
UK GDPR age of consent is 13–16 depending on jurisdiction, and `profiles.age` has
`CHECK (age >= 13)`.

---

#### H3 — GPS routes stored before 19 Aug 2026 may still start at the athlete's front door

**Files:** `src/lib/scoring/gps-track.ts:704-845` (`applyRoutePrivacyZone`),
`src/app/api/activities/route.ts:76-81` (`sanitizeRoute`, the only caller),
`scripts/backfill-route-privacy-zone.ts`

The design is right, and unusually well reasoned: the first and last 200 m of every route are
removed **at the write boundary**, before persistence, measured along the path rather than as a
radius, because `activities.metadata` is handed to an accepted friend in full by RLS. All new
writes are covered.

What is not covered is the back catalogue. Routes have been stored since 2026-08-09; the
privacy zone shipped 2026-08-19 (the script's own header states both dates). The remediation
is `scripts/backfill-route-privacy-zone.ts`, a hand-run one-off requiring
`SUPABASE_SERVICE_ROLE_KEY` and `--apply`. **There is nothing in the repository that records
whether it has ever been run** — no migration, no CI step, no test asserting zero unstamped
rows. Ten days of routes may still be in the database with untrimmed endpoints.

Also unguarded: `PATCH /api/activities/[id]` rebuilds metadata through `buildActivityMetadata`
(`src/app/api/activities/[id]/route.ts:22-42`), which spreads existing metadata and never
re-sanitises `route`; and `POST /api/activities/[id]/unmerge` (`:32-44`) restores raw metadata
snapshots verbatim. Neither can *create* an untrimmed route today, but both will faithfully
preserve a legacy one.

**Exploit.** Attacker sends a friend request to the target and gets accepted — a low bar on a
social fitness app. RLS then grants every column of every visible activity row, so:

```bash
curl "$SUPABASE_URL/rest/v1/activities?user_id=eq.$TARGET&select=metadata,started_at" \
  -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ATTACKER_JWT" \
  | jq '.[].metadata.route[0]'
```

The first coordinate of a pre-19-August run is, for most athletes, their home address —
correlated with a timestamp that says when they leave it.

**Fix.** Before submission: run the backfill with `--apply`, then verify
`SELECT count(*) FROM activities WHERE metadata ? 'route' AND NOT (metadata ? 'route_privacy_backfilled_at')`
is 0 for rows created before the cutover, and record the result here. Add that assertion as a
CI check so it cannot silently regress.

---

#### H4 — Rate limiting is per-instance and in-memory; the OpenAI path is unbounded

**File:** `src/proxy.ts:8-52`

```ts
const hits = new Map<string, { count: number; resetAt: number }>();
```

A module-level `Map` in a serverless function. On Vercel each concurrent lambda instance holds
its own copy, so the effective ceiling is 60/min **multiplied by instance count**, and it
resets on every cold start. The key is `x-forwarded-for`'s first hop
(`src/proxy.ts:14-18`) — trustworthy behind Vercel's proxy, but the fallback is the literal
string `"unknown"`, so every request without the header shares one bucket.

The consequential path: `POST /api/activities` calls `generateCoachFeedback`
(`src/app/api/activities/route.ts:836-858`) → `src/lib/openai/coach.ts` → a paid OpenAI
completion, once per logged activity, with no per-user quota anywhere. There is no daily cap,
no cost ceiling, and no `ai_feedback` row-count check before the call.

Auth is not covered at all: `/login` and `/signup` talk to Supabase GoTrue directly from the
browser, so the only throttle is GoTrue's, and the comment at `src/proxy.ts:4-7` accepts this
explicitly. Credential stuffing against the project is therefore bounded only by Supabase's
own limits.

**Exploit.** One authenticated account, a loop POSTing minimal valid gym activities from a
handful of IPs. Each is a full scoring pass plus an OpenAI call. Burns the OpenAI budget and
the Supabase compute quota; the 60/min limiter is bypassed simply by concurrency spreading
across instances.

**Fix.** Move the limiter to durable storage (Upstash Redis, or a Postgres table with a
`window_start` unique key) and key AI paths on `user.id`, not IP. Add a hard per-user daily cap
on `generateCoachFeedback` and fall back to `generateRulesBasedSnippet` past it.

---

### MEDIUM

---

#### M1 — `CRON_SECRET` is accepted as a URL query parameter, on routes that write

**Files:** `src/app/api/cron/leaderboard/route.ts:16-22`,
`src/app/api/cron/hybrid-reports/route.ts:7-13`

```ts
const secret = searchParams.get("secret") ?? request.headers.get("authorization")?.replace("Bearer ", "");
```

A secret in a query string lands in Vercel access logs, any intermediary log, browser history
and `Referer` headers. Both handlers are `GET` and both mutate — the leaderboard route upserts
the entire `leaderboard_entries` table; the reports route iterates every premium user and
generates reports. Whoever recovers the secret from a log can trigger both at will.
`.env.example:18-21` documents the query-param form, so it is intentional rather than vestigial.

**Fix.** Header only; delete the `searchParams` branch. Change both to `POST`. Compare with
`crypto.timingSafeEqual`. Rotate `CRON_SECRET` before launch on the assumption it is already
in a log somewhere.

---

#### M2 — Stripe webhook has no idempotency or replay ledger

**File:** `src/app/api/stripe/webhook/route.ts:14-97`

Signature verification is correct (`constructEvent` at `:26-30`, raw body read as text at
`:15`, fail-closed 400 at `:31-33`). What is missing is a record of which `event.id` values
have been processed. Stripe's own signature tolerance is five minutes, which bounds the window,
and the writes are idempotent set-operations rather than increments — so this is Medium, not
High. But within that window a captured `customer.subscription.deleted` body-plus-signature
pair replays cleanly and downgrades the user; and Stripe's documented at-least-once delivery
means out-of-order retries of `created`/`deleted` can leave the tier wrong with no way to
detect it.

**Fix.**

```sql
CREATE TABLE stripe_events (id TEXT PRIMARY KEY, received_at TIMESTAMPTZ DEFAULT NOW());
```

Insert `event.id` first; on `23505` return 200 without processing. Ignore events whose
`created` predates the profile's last subscription write.

---

#### M3 — RevenueCat webhook trusts a client-supplied user id behind a static bearer token

**File:** `src/app/api/revenuecat/webhook/route.ts:43-96`

```ts
function verifySecret(request: Request): boolean {
  const auth = request.headers.get("authorization");
  const secret = process.env.REVENUECAT_WEBHOOK_SECRET;
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}
```

Fails closed on a missing secret — good. But: the comparison is non-constant-time; there is no
signature over the payload, so anyone who learns the secret can forge grants; `event.app_user_id`
is used verbatim as a Supabase `user_id` (`:69`, `:81`) with no UUID validation and no
cross-check against RevenueCat's REST API to confirm the entitlement is real; and
`app_user_id` is whatever the mobile client passed to `Purchases.logIn()`, so a purchaser can
attribute their purchase to an arbitrary account id.

The revoke path is better than the grant path — it correctly scopes on
`.eq("subscription_source", "revenuecat")` (`:95`) so a native expiry cannot clobber a live
Stripe subscription. The grant path has no equivalent guard.

**Fix.** Validate `app_user_id` against a UUID regex before use. Use
`crypto.timingSafeEqual` for the secret. Before granting, call RevenueCat's
`GET /v1/subscribers/{app_user_id}` with the server API key and confirm the entitlement is
active — the webhook becomes a trigger rather than the authority.

---

#### M4 — Unvalidated body values interpolated into PostgREST `.or()` filter strings

**Files:** `src/app/api/duels/route.ts:62-68` and `:74-81`

```ts
const opponentId = String(body.friendId ?? "");
...
.or(`and(user_id.eq.${user.id},friend_id.eq.${opponentId}),and(user_id.eq.${opponentId},friend_id.eq.${user.id})`)
```

`opponentId` is attacker-controlled and goes straight into a PostgREST filter expression, where
`,` `.` `(` `)` are all syntax. A crafted value alters the predicate the friendship check runs
against, so the route-level "you may only duel an accepted friend" gate at `:70-72` can be
confused.

**Impact is contained**, which is why this is Medium: the `duels` INSERT policy
(`020_friend_duels.sql:40-51`) independently re-checks the accepted friendship in the database,
so a bypassed route check still cannot create the row. This is exactly the defence-in-depth the
migration comment claims, and it holds. The pattern is nonetheless a latent injection that
will become exploitable the first time it is copied to a table without that policy.

`src/lib/social/feed.ts:152-156` and `src/lib/social/queries.ts:45,191` use the same
construction but interpolate `userId` from `auth.getUser()`, and
`src/app/api/friends/route.ts:55-57` interpolates a value read back from the database — all
safe today.

**Fix.** Assert `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i` on
`opponentId` before it reaches a filter, and adopt that as the house rule for any interpolated
`.or()`/`.filter()` argument.

---

#### M5 — Third-party OAuth tokens are stored in plaintext and readable by the client

**File:** `supabase/migrations/003_integrations.sql:17-25`, `:71-73`

```sql
CREATE TABLE integration_connections (
  ..., access_token TEXT, refresh_token TEXT, ...);

CREATE POLICY "Users manage own integration connections"
  ON integration_connections FOR ALL USING (auth.uid() = user_id);
```

Strava, Garmin, Polar, Coros and Fitbit access and refresh tokens, unencrypted, in a table the
user's own browser can `SELECT` with the anon key. A refresh token is a long-lived credential
to a *different* service holding the same athlete's full location history — including the
untruncated one Split Index deliberately declines to store (see H3). Any XSS on the app, any
malicious browser extension, or any compromised session exfiltrates them; and they sit in
plaintext in every database backup.

**Fix.** These tokens have no client-side reader. Drop the policy so the table is
service-role-only, and encrypt the columns with `pgsodium`/Supabase Vault. Confirm no client
component selects from `integration_connections` before dropping it.

---

#### M6 — No request-body validation on any API route

`zod` is a dependency (`package.json`) but is imported in exactly one file:
`src/components/activities/form-state.ts` — client-side form state. Not one of the 47 route
handlers validates a body against a schema. The prevailing pattern is destructure-and-cast:

- `src/app/api/activities/draft/route.ts:14` — `const { sport, formData } = await request.json();`
  then `formData` is written straight to a JSONB column with no shape or size check.
- `src/app/api/session-templates/route.ts:47-52` — `template_data?: Record<string, unknown>`,
  presence-checked only, stored verbatim.
- `src/app/api/profile/timezone/route.ts:16-19` — any non-empty string is written to
  `profiles.timezone`.
- `src/app/api/activities/route.ts:162` — the whole scoring body destructured from raw JSON.

The scoring path is partly rescued by `assertScoringInput`
(`src/lib/scoring/input-guards.ts`, called at `src/app/api/activities/[id]/route.ts:146`), and
several routes do validate individual fields well — `reactions` bounds the score 1-10
(`[id]/reactions/route.ts:25`), `hrv` bounds rMSSD (`recovery/hrv/route.ts:39`), `duels`
allow-lists metric and sport (`duels/route.ts:49-53`), `logbook` matches sport against the
catalogue (`activities/logbook/route.ts:36`). It is inconsistent rather than absent.

**Fix.** One `zod` schema per route, parsed before any database call, with explicit size caps
on the JSONB fields.

---

#### M7 — Any user can create a global challenge

**Files:** `supabase/migrations/001_initial_schema.sql:390`,
`supabase/migrations/002_scoring_reference_and_leaderboards.sql:236-237`

```sql
CREATE POLICY "Anyone can view challenges" ON challenges FOR SELECT USING (true);
CREATE POLICY "Users can create challenges" ON challenges FOR INSERT
  WITH CHECK (auth.uid() = created_by);
```

`is_global` is unconstrained by the `WITH CHECK`, and `fetchChallenges`
(`src/lib/social/queries.ts:122-127`) lists every row with `is_global = true`. So any
authenticated user can insert arbitrary attacker-authored `title` and `description` text into
the challenge list that every user sees. Rendered through React (`src/components/social/…`), so
not XSS — but it is an unmoderated broadcast channel for abuse or spam, shipped in a consumer
app, with no delete policy to remove it afterwards.

**Fix.** `WITH CHECK (auth.uid() = created_by AND is_global = false)`, and create global
challenges through the service role only. Add a DELETE policy for the creator.

---

#### M8 — Service-role fan-out over other athletes' rows inside a user-facing GET

**File:** `src/app/api/races/route.ts:53-125` (`computeCrowdDifficulty`), invoked per race at `:342`

`GET /api/races` creates a service-role client (`:307`) and, for each of the caller's upcoming
races, reads **all** `planned_races` rows (`:63-65`), then for each name-matching plan reads
that user's `activities` and `predicted_benchmarks` (`:79-110`). RLS is bypassed throughout.

The output is aggregated and `MIN_CROWD_SAMPLE_SIZE = 2` (`:62`) — but k=2 is a weak
k-anonymity threshold. Enter a rare event name that exactly two other athletes have logged and
the returned `averageDeltaPct` is a tight aggregate over two identifiable people's race
performance. It is also an unbounded query fan-out per request: N+2 service-role queries where
N is the number of matching plans across the whole user base, on a route reachable 60×/minute.

**Fix.** Precompute the crowd aggregate on a schedule into its own table and read it with the
user's client; raise the threshold to 5; drop the admin client from the request path entirely.

---

#### M9 — Account deletion depends on an unverified manual table list

**File:** `src/app/api/account/delete/route.ts:5-25`

`USER_TABLES` names 19 tables and omits `sleep_logs`, `predicted_benchmarks`, `planned_races`,
`hybrid_athlete_reports`, `hpe_athlete_profile`, `hpe_findings`, `hpe_plans`, `hpe_sessions`,
`hpe_intake`, `hpe_generation_events`, `hpe_session_feedback`, `hpe_injury_reports`,
`activity_reactions`, `activity_comments` and `gym_exercises`.

I verified each of those has `REFERENCES auth.users(id) ON DELETE CASCADE` (or cascades from
`activities`), so `admin.auth.admin.deleteUser` at `:62` does in fact remove them and deletion
is complete **today**. The finding is that this is an invariant held only by a coincidence
between a hand-maintained array and 55 migration files, with no test. The next table added
without a cascade silently leaves health data behind after a deletion the user was told
completed — a GDPR Art. 17 failure and an App Store account-deletion requirement failure.

**Fix.** Replace the array with a schema-driven test that fails if any table with a `user_id`
column is neither in `USER_TABLES` nor cascade-linked to `auth.users`.

---

### LOW

---

#### L1 — CSP allows `'unsafe-inline'` scripts

`next.config.ts:8` — `script-src 'self' 'unsafe-inline'`. With inline script allowed and no
nonce, the CSP provides essentially no XSS mitigation. `img-src 'self' data: https:` is also
wide open. The rest of the header set is good: `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, HSTS via `upgrade-insecure-requests`, plus
`X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy` and a `Permissions-Policy` that denies
camera/mic/geolocation/payment (`:53-68`). Move to a nonce-based `script-src` when convenient.

#### L2 — Raw PostgREST error messages returned to production clients

`src/app/api/activities/[id]/route.ts:210-212`, `src/app/api/squads/route.ts:51`,
`src/app/api/session-templates/route.ts:73`, `src/app/api/friends/route.ts:80,124` and roughly
a dozen others return `error.message` verbatim with no `NODE_ENV` guard, disclosing column,
constraint and policy names. The correct pattern already exists in the codebase —
`src/lib/supabase/errors.ts:9-15` and `src/lib/social/feed.ts:126-131` gate detail on
`NODE_ENV === "development"`. Apply it consistently.

#### L3 — Squad membership can be self-inserted without the invite code

`supabase/migrations/024_squads.sql:43-44` — `WITH CHECK (user_id = auth.uid())` checks who is
joining but not *what* they are joining. Anyone holding a squad's UUID can insert themselves
and then read every member's profile and Split Index via `fetchSquads`
(`src/lib/social/queries.ts:268-326`). Squad ids are UUIDv4 so this is not remotely
brute-forceable, and `POST /api/squads/join` correctly requires the code
(`src/app/api/squads/join/route.ts:26-39`) — but the database does not enforce what the route
promises. Add the invite-code check to the policy or route joins exclusively through the
service role.

#### L4 — AI prompt injection from user-supplied activity text

`activities.notes` and `activities.title` reach the OpenAI prompt via
`src/lib/openai/coach.ts` with no delimiting or escaping. Output is rendered only back to the
same user, so the blast radius is self-inflicted; worth noting only because the coach output is
also written to `ai_feedback` and could surface elsewhere later.

#### L5 — `hpe_feature_flags` readable by every signed-in user

`supabase/migrations/040_hpe_monitoring_and_rollout.sql:129-130` exposes `rollout_percentage`
and the operator's free-text `note` (which the rollout endpoint fills with the change *reason*,
`src/app/api/hpe/admin/rollout/route.ts:84`) to any authenticated user. Informational leak of
internal operational commentary. Narrow the select to `key, enabled, rollout_percentage`.

---

## Every table and its RLS status

Read from migration source. `public` role = reachable with the anon key, **unauthenticated**.

| Table | RLS | Policy | Verdict |
|---|---|---|---|
| `profiles` | on | own SELECT/UPDATE/INSERT + `Public profiles readable USING (username IS NOT NULL)` | **BLOCKER — C1, C2** |
| `workout_scores` | on | own FOR ALL + `Public leaderboard scores USING (true)` | **BLOCKER — C3** |
| `split_index_history` | on | own FOR ALL + `Public leaderboard index USING (true)` | **BLOCKER — C3** |
| `strength_scores` | on | own FOR ALL + `Public leaderboard strength scores USING (true)` | **BLOCKER — C3** |
| `leaderboard_entries` | on | `Anyone can view leaderboards USING (true)` — carries `user_id` | **BLOCKER — C3** |
| `activities` | on | own FOR ALL + `Friends view shared activities` via `activity_is_visible_to()` | OK (see H3 for stored route contents) |
| `activity_reactions` | on | SELECT/INSERT gated on `activity_is_visible_to()`; UPDATE/DELETE own | OK |
| `activity_comments` | on | SELECT/INSERT gated on `activity_is_visible_to()`; DELETE own | OK |
| `gym_exercises` | on | own, via `EXISTS` on parent activity | OK |
| `body_metrics` | on | own FOR ALL | OK |
| `personal_records` | on | own FOR ALL | OK |
| `goals` | on | own FOR ALL | OK |
| `recovery_snapshots` | on | own FOR ALL | OK |
| `ai_feedback` | on | own FOR ALL | OK |
| `sleep_logs` | on | own FOR ALL | OK |
| `workout_drafts` | on | own FOR ALL | OK |
| `notifications` | on | own FOR ALL | OK |
| `user_achievements` | on | own FOR ALL | OK |
| `session_templates` | on | own FOR ALL | OK |
| `predicted_benchmarks` | on | own FOR ALL | OK |
| `planned_races` | on | own FOR ALL | OK |
| `hybrid_athlete_reports` | on | own SELECT only; writes via service role | OK |
| `friends` | on | SELECT either party; INSERT own + `status='pending'`; UPDATE recipient; DELETE either | OK |
| `duels` | on | SELECT participants; INSERT re-checks accepted friendship in SQL; UPDATE role-and-state constrained | OK — exemplary |
| `squads` | on | SELECT members only; INSERT `created_by = auth.uid()` | OK |
| `squad_members` | on | SELECT fellow members; INSERT `user_id = auth.uid()`; DELETE own | Weak — L3 |
| `challenges` | on | SELECT `USING (true)`; INSERT any user, `is_global` unguarded | Weak — M7 |
| `challenge_participants` | on | own FOR ALL + `Public challenge progress USING (true)` | Weak — exposes participation graph to anon |
| `integration_connections` | on | own FOR ALL — plaintext OAuth tokens client-readable | Weak — M5 |
| `import_jobs` | on | own FOR ALL | OK |
| `sports` | on | `USING (true)` — static reference data | OK |
| `reference_values` | on | `USING (true)` — static scoring standards | OK |
| `achievements` | on (enabled in `002:224`) | `USING (true)` — badge catalogue | OK |
| `hpe_athlete_profile` | on | own FOR ALL | OK |
| `hpe_findings` | on | own FOR ALL | OK |
| `hpe_plans` | on | own FOR ALL | OK |
| `hpe_sessions` | on | own FOR ALL | OK |
| `hpe_intake` | on | own FOR ALL | OK |
| `hpe_generation_events` | on | own SELECT + own INSERT | OK |
| `hpe_session_feedback` | on | own FOR ALL | OK |
| `hpe_injury_reports` | on | own FOR ALL | OK |
| `hpe_feature_flags` | on | any signed-in SELECT; no write policy | OK — L5 |
| `admin_users` | on | SELECT own row only; **no INSERT/UPDATE/DELETE policy at all** | OK — exemplary |
| `hpe_rollout_audit` | on | **no policies** — service role only | OK — exemplary |
| `storage.objects` (`avatars`) | bucket `public = true` | public SELECT; INSERT/UPDATE/DELETE gated on `foldername[1] = auth.uid()` | OK — avatars are intentionally public by URL |
| `training_goals` | — | dropped in `055` | n/a |
| `training_goal_progress` | — | dropped in `055` | n/a |

**No table with user data is missing `ENABLE ROW LEVEL SECURITY`.** Every blocker above is a
policy that is enabled and too permissive, not a policy that is absent — a meaningfully better
starting position, since all five fixes are one migration.

---

## What is already right

Recorded deliberately, because it is most of the codebase and it should not be re-litigated.

**Authorization.** All 47 route handlers call `supabase.auth.getUser()` and 401 before any
work. Every activity route scopes on `.eq("user_id", user.id)` in addition to RLS —
`[id]/route.ts:63,122,401`, `[id]/unmerge/route.ts:97`, `recent/route.ts:41`,
`export/activities/route.ts:57`, `gym-exercises/history/route.ts:31`. `POST /api/activities/recompute`
takes no parameters at all so no request shape can target another user
(`recompute/route.ts:15-17`). All 20 server components under `src/app/(app)/**` redirect to
`/login`, the single exception being the intentionally public social profile. **I found no
IDOR that RLS does not also stop** — the compare and leaderboard-detail routes accept arbitrary
ids by design, and their gap is privacy (H1), not ownership.

**Admin surface.** `resolveAdminRole` (`src/lib/auth/admin-role.ts:26-45`) reads `admin_users`
through the service role rather than the caller's RLS-scoped client, fails closed on a missing
key (`:30`), and has no `grantAdmin` function; `admin_users` has no INSERT policy, so the role
cannot be reached through any application path. The fleet route returns 404 rather than 403
(`hpe/admin/fleet/route.ts:66-69`), enforces aggregate-only output with a runtime UUID and
email assertion rather than a comment (`:45-54`), and the page gates independently
(`admin/hpe-fleet/page.tsx:21-22`). Rollout changes are operator-only, require a reason,
are gated on a recorded clean fleet review, and are audited — and de-escalation is
deliberately never gated. This is the strongest part of the codebase.

**Secrets.** `.env*` is gitignored; a full 331-commit pickaxe for `sk_live_`, `sk_test_`,
`whsec_`, `service_role` and JWT prefixes found no committed credential. The service-role key
is referenced only server-side (`src/lib/supabase/admin.ts` and two hand-run scripts) and never
from a `"use client"` file. The five `NEXT_PUBLIC_*` variables — Supabase URL and anon key, app
URL, and the two RevenueCat public SDK keys — are all correctly public.

**GPS privacy zone.** Applied server-side at the write boundary with the explicit reasoning
that a client-side trim is unenforceable, measured along the path rather than as a radius,
storing nothing at all rather than a bracketable stub for sub-400 m sessions
(`gps-track.ts:704-845`). The design is better than most commercial implementations; only the
back-catalogue (H3) is outstanding.

**Stripe.** Signature verified against the raw body before any parsing, fail-closed on missing
or invalid signature, webhook secret server-side only.

**XSS.** `dangerouslySetInnerHTML` appears twice, both with app-authored JSON-LD
(`src/app/layout.tsx:88`, `src/app/how-scoring-works/page.tsx:97`). No user string reaches it.
The two share-card routes render through `next/og` (`ImageResponse`), which rasterises text
nodes via satori — display names cannot inject. Both are self-scoped and one is premium-gated.
`parseInjuryStatus` (`src/lib/social/queries.ts:30,426`) parses rather than casts a free-text
column before it is rendered next to another athlete's name. No SQL injection is possible: the
codebase uses PostgREST exclusively and contains no raw SQL string construction.

---

## Recommended order of work before submission

1. **One migration** closing C1, C2, C3 (column grants on `profiles`; drop four over-broad
   SELECT policies; add the `public_profiles` and `leaderboard_public` views; repoint the
   readers in `src/lib/social/`). This is the whole blocker set.
2. **H3** — run the route backfill with `--apply`, verify zero unstamped legacy rows, record
   the number here.
3. **H1** — apply `share_activities_with_friends` to the public profile page, `/api/social/compare`
   and `/api/social/leaderboard/detail`. Largely free once (1) lands.
4. **H2** — rewrite privacy policy §2, §5 and §9. Required for App Review regardless of (1).
5. **H4, M1, M2, M3** — durable rate limiting and per-user AI cap; cron secret to header-only
   and rotate; Stripe event ledger; RevenueCat entitlement verification.
6. **M4–M9, L1–L5** — as capacity allows; none is a launch blocker.

**Then re-run this audit against the live database**, not the migration source, and reconcile.
