# Handshake / Contract Audit

Scope: every point where two independently-changeable parties agree on a shape or a
sequence. This is **not** a feature audit — a contract can be "broken" here while the
feature demos perfectly, because the break only shows up when the two sides are
deployed, retried, reordered, or version-skewed apart.

Method: read of all 52 route files under `src/app/api/**`, every `fetch("/api/…")` call
site, `src/lib/supabase/{server,client,admin,proxy}.ts` + `src/proxy.ts`, all of
`src/lib/native/*`, the Swift plugin/widget sources under `ios/App/**`, and all 56
migrations in `supabase/migrations/`. `npx tsc --noEmit` **passes** (exit 0) and
`npx vitest run` **passes** (exit 0) — neither catches anything below, which is the
point: every break here is across a boundary the compiler cannot see.

Snapshot caveat: the working tree changed underneath this audit (other pre-launch work
running in parallel). Findings describe the tree as read; where a fix landed mid-audit
it is called out inline (see §2.1). No source file was modified by this audit.

Note on version skew (brief item 6): `capacitor.config.ts` points the WebView at the
live production URL (`server.url`), so **there is no stale web bundle**. All
version-skew risk is native-binary-vs-server, i.e. the Capacitor plugin contracts and
the App Group JSON only.

---

## 1. Contract inventory

Legend — **V** verified both sides agree; **B** broken; **U** untested/unenforced
(contract holds today only by convention or by a policy nobody re-checks).

### 1.1 Client ↔ API

| Party A | Party B | Contract | Status | Evidence |
|---|---|---|---|---|
| `activity-form.tsx:453` / `gps-run/page.tsx:667` | `POST /api/activities` | `ActivityFormData` body → `{activity, score, sportIndex, splitIndex, …, premium_required}` | **U** | Route casts `await request.json()` straight to `ActivityFormData` with **no zod/runtime schema** (`route.ts:159-162`); only `assertScoringInput` validates the scoring subset. Response keys read by both callers all exist. |
| `submit-activity.ts` offline queue | `POST /api/activities` (replay) | at-most-once delivery | **B** | No idempotency key; non-2xx retried forever. See §2.4. |
| `activity-form.tsx:453` | `PATCH /api/activities/[id]` | same body, `{activity, score, …}` | **V** | `route.ts:102-380`, scoped `.eq("user_id", user.id)` at :122. |
| `delete-activity-modal.tsx:32` | `DELETE /api/activities/[id]` | `{success:true}` | **V** | `route.ts:416`. |
| `use-autosave.ts:39` | `PUT /api/activities/draft` | `{sport, formData}` → `{draft}` | **V** | `draft/route.ts:14`. Caller ignores body, reads only `res.ok`. |
| `activity-form.tsx:512` | `DELETE /api/activities/draft?sport=` | `{ok:true}` | **V** | `draft/route.ts:78-92`. |
| `log-quick-actions.tsx:144`, `gym-form.tsx:1428` | `GET /api/activities/recent` | `{workouts:[{activityId,startedAt,title,exerciseNames,formState}]}` | **V** | `recent/route.ts:68-82`. |
| `logbook-feed.tsx:185` | `GET /api/activities/logbook` | `fetchLogbookPage` page object | **V** | `logbook/route.ts:38-46`. |
| `merge-activities-modal.tsx:105,132` | `POST /api/activities/merge` | `{activityIds, dryRun?}` → `{preview}` \| `{activity, score, mergedActivityId, absorbedActivityIds, preview, …}` | **V** | `merge/route.ts:151`, `:286-296`, `previewOf` at `:64-75`. Both branches read by the modal. |
| `merged-session-banner.tsx:47` | `POST /api/activities/[id]/unmerge` | `{…}` | **V** | `unmerge/route.ts:247`. |
| `settings/page.tsx:164` | `POST /api/activities/recompute` | `{recomputed,total,failed,rebuildFailures}` | **V** | `recompute-user.ts` result; caller reads all four (`settings/page.tsx:175-181`). |
| `feed-panel.tsx:97` | `POST /api/activities/[id]/reactions` | `{score:1..10}` → `{reaction}` \| 403 `{error:<raw PG msg>}` | **B** | Error shape is a raw Postgres string (`reactions/route.ts:41`) and the caller drops it entirely (`feed-panel.tsx:104` `if (!res.ok) return;`). |
| `feed-panel.tsx:162,176,186` | `GET/POST /api/activities/[id]/comments` | `{body}` → `{comment}` / `{comments:[…]}` | **B** | Same: 403 carries a raw PG message (`comments/route.ts:87`), caller silently no-ops (`feed-panel.tsx:177`). |
| `feed-panel.tsx:398,414` | `GET /api/social/feed` | page \| 503 `{error}` | **V** | `feed/route.ts:25-30` — deliberate, documented. |
| `leaderboard-panel.tsx:235` | `GET /api/social/leaderboard` | 200 `{rows,bracket}` **or** 403 `{error,premium_required,rows,bracket}` | **V** | Asymmetric on purpose; caller handles it explicitly (`leaderboard-panel.tsx:236` `if (res.ok \|\| data.rows)`). |
| `leaderboard-panel.tsx:217` | `GET /api/social/leaderboard/detail` | detail \| 403 | **V** (API) / **B** (DB) | Route gates on premium (`detail/route.ts:27`) but the underlying tables are world-readable — see §2.1. |
| `leaderboard-panel.tsx:266` | `GET /api/social/leaderboard/dimension` | `{rows}` | **V** | `dimension/route.ts:37`. |
| `compare-modal.tsx:46` | `GET /api/social/compare` | `{series}` | **V** | `compare/route.ts:55`. |
| `friends-panel.tsx:35,48,65,74` | `GET/POST/PATCH/DELETE /api/friends` | `{friends,incoming,outgoing}` / `{request}` / `{ok,status}` | **V** | `friends/route.ts:16,83,127,158`. |
| `squads-panel.tsx:98,108,129,146` | `/api/squads`, `/api/squads/join`, `/api/squads/[id]` | `{squads}` / `{squad}` / `{ok}` | **V** | `squads/route.ts:19,…`; join/delete scoped by `user_id`. |
| `duels-panel.tsx:145,155,171` | `/api/duels`, `/api/duels/[id]` | `{duels}` / `{duel}` | **V** | `duels/route.ts`, `duels/[id]/route.ts`. |
| `challenges-panel.tsx:23` | `POST /api/challenges/[id]/join` | `{ok}` \| 409 `{error:"Already joined"}` | **V** | `join/route.ts:36,50`. |
| `goals-card.tsx:104,128,147,218,413` | `POST/PATCH/DELETE /api/goals` | `{goal}` / `{ok}` | **V** | `goals/route.ts:81,153,182`. |
| `upcoming-races-panel.tsx:201,248` | `GET/POST /api/races` | `{races:[…]}` / created race | **V** | `races/route.ts:267,358`. |
| `injury-risk-panel.tsx:114` | `POST /api/recovery/hrv` | `{hrvMs}` → `{hrvMs}` | **V** | `hrv/route.ts:83`. |
| `score-reveal.tsx:133` | `POST /api/onboarding/calibrate` | calibration result | **V** | `calibrate/route.ts:282`. |
| `onboarding-flow.tsx:104` | `GET /api/profile/username-check?u=` | `{available, reason?}` | **U** | 500 path returns `{error}` with **no `available` key** (`username-check/route.ts:30`); caller has no branch for it. Also `.ilike().maybeSingle()` throws PGRST116 if two rows differ only in case. |
| `onboarding-flow.tsx:258` | `POST /api/profile/ensure` | `{ok}` \| 500 `{error,code}` | **V** | `ensure/route.ts:18,21`. |
| `client-bootstrap.tsx:11` | `POST /api/profile/timezone` | `{timezone}` | **V** | fire-and-forget. |
| `gym-form.tsx:168` | `GET /api/gym-exercises/history?name=` | `{lastSet,personalRecord}` | **V** | `history/route.ts:69-84`. |
| `activity-form.tsx:422`, `log-quick-actions.tsx:147`, `gym-quick-start.tsx:23` | `/api/session-templates` | `{templates}` / `{template}` | **V** | `session-templates/route.ts:34,76`. |
| `hybrid-plan-screen.tsx:235` | `GET /api/hpe/plan` | `PlanResponse` | **B** | A **GET with side effects** — generates, persists, supersedes, writes telemetry. See §2.7. |
| `intake-wizard.tsx:180,255`, `goals-panel.tsx:168,217` | `GET/PATCH /api/hpe/intake` | `{intake,prefilled,sections}` / `{ok,intake}` | **V** | `intake/route.ts:39-43,89`; per-section field allowlist at `:61-65`. |
| `intake-wizard.tsx:195` | `GET /api/hpe/intake/exercises` | `{exercises}` | **V** | `exercises/route.ts:58,102`. |
| `monitoring-dashboard.tsx:59` | `GET /api/hpe/monitoring` | `{snapshot,scope,scopeNote,rollout}` | **U** | Queries carry **no `.eq("user_id")`** (`monitoring/route.ts:34-49`) — scoping is 100% RLS. RLS is correct today (`040:132-141`, `039:187-201`) but the route's own contract is unenforced. |
| `fleet-dashboard.tsx:73,93` | `GET /api/hpe/admin/fleet`, `POST /api/hpe/admin/rollout` | admin payload / `{ok,enabled,percentage}` \| 404 \| 403 \| 409 | **V** | `fleet/route.ts:61-68`, `rollout/route.ts:26-35,72-77`; caller handles 404/401 at `fleet-dashboard.tsx:74`. |
| `start-checkout.ts:11` | `POST /api/stripe/checkout` | `{sku}` → `{url}` \| 503/500 `{error}` | **V** | `checkout/route.ts:99,104`. |
| `hybrid-report-view.tsx:88` (`<a href>`) | `GET /api/reports/hybrid/card` | PNG \| **text/plain** 401/404 | **B** | Error body is a bare string, not `{error}`; opens as raw text in a new tab. |
| `interference-radar-card.tsx:62`, `interference-detail.tsx:190` | `GET /api/interference/report-card` | PNG \| text/plain 401/404 | **U** | `report-card/route.tsx:24,42`; `ShareImageButton` falls back to `window.open(href)` on `!res.ok`, so the user sees the raw string. |
| *(nobody)* | `GET /api/export/activities` | premium CSV/JSON | **U** | **Dead route** — no caller anywhere in `src/`. Ships an authenticated, premium-gated export surface with zero UI and zero test coverage. |

### 1.2 Auth handshake

| Party A | Party B | Contract | Status | Evidence |
|---|---|---|---|---|
| Browser cookies | `src/proxy.ts` → `updateSession` | refresh on every matched request, re-emit rotated cookies | **V** | `proxy.ts:52-58`, `supabase/proxy.ts:20-33`. Matcher covers `/api/*`. |
| `proxy.ts` | Route handlers | who redirects an unauthenticated caller | **B** | `supabase/proxy.ts:44-60` redirects **page** routes only; `/api/*` gets a 401 JSON that **no client code handles globally**. See §2.5. |
| Concurrent requests | Supabase refresh-token rotation | one refresh wins, others reuse | **B** | Both `proxy.ts` and each route's `createClient()` hold a refreshing client; parallel fetches (e.g. `log-quick-actions.tsx:144-148` `Promise.all`) can double-spend an expired refresh token. See §2.5. |
| Every API route | `auth.getUser()` + `user_id` scoping | no cross-user reads | **V** (routes) | All 50 authenticated routes call `getUser()` and 401. Direct table reads are `.eq("user_id", user.id)` except `hpe/monitoring` (RLS-only), `activity_comments`/`activity_reactions` (RLS-only, correct policies at `031`/`051`), and the deliberate service-role aggregates. |
| Supabase anon key (public) | RLS policies | privacy / premium gating | **B** (fix landed mid-audit, unapplied/unverified) | `001:338,352,356,377`, `012:7` are world-readable; `056_public_projections.sql` replaces them with column-named views. See §2.1. |
| `sidebar-account.tsx` sign-out | native widgets + RevenueCat | clear on sign-out | **B** | Only one of three sign-out paths clears. See §2.6. |
| Native OAuth (`oauth.ts`) | `/auth/callback` | custom scheme → same-origin PKCE exchange | **V** | `oauth.ts:36-47`, `auth/callback/route.ts:88-102`. |

### 1.3 Web ↔ Native

| Party A | Party B | Contract | Status | Evidence |
|---|---|---|---|---|
| `race-predictions.ts` | `RacePredictionsPlugin.swift` / `RacePredictionStore.swift` | App Group JSON: `status`, `headline{label,seconds}`, `ladder[]`, `sampleCount`, `samplesNeeded`, `strength{status,lifts[{label,kg}],totalKg,liftsLogged}` | **V** | Key-for-key match: TS `race-predictions.ts:69-90` ↔ Swift `RacePredictionsPlugin.swift:47-72,145-193`. Additive-sibling rule honoured (`strength` optional both sides, `RacePredictionStore.swift:120-126`). Storage key `racePredictions.v1`, group `group.co.uk.splitindex.app`. Covered by `race-predictions.test.ts`. |
| `daily-training.ts` | `DailyTrainingPlugin.swift` / `DailyTrainingStore.swift` | `status`, `days[{date,isRest,restReason,weekLabel,totalMinutes,sessions[{title,detail,slot,domain,minutes,isQuality}]}]`, `headline`, `message` | **V** | TS `daily-training.ts:39-79` ↔ Swift `DailyTrainingPlugin.swift:33-129`. Every field read optionally; `ready`-with-no-days degrades to `noPlan`. Key `dailyTraining.v1`. |
| `live-activity.ts` | `LiveActivityPlugin.swift` | `start/update/end/getState` over a running Activity | **B** | Native holds `private var session: Any?` (`LiveActivityPlugin.swift:31`) and never re-adopts via `Activity.activities`. See §2.3. |
| `gps-tracking.ts` | `@capacitor-community/background-geolocation` | start → fixes → stop; recover/rejoin after kill | **B** | Recovery clears storage before the user has decided (`gps-tracking.ts:353-371`); `attachWatcher` overwrites the watcher id without detaching (`:166`). See §2.8. |
| `heart-rate.ts` | `@capacitor-community/bluetooth-le` | connect → notify → disconnect | **V** | `heart-rate.ts:48-90`; `parseHeartRateMeasurement` unit-tested. |
| `airpods-heart-rate.ts` | `HeartRateWorkoutPlugin.swift` | `isAvailable/start{activityType}/stop` + `heartRate`/`error` listeners | **V** | Shapes match; iOS-guarded at `:34-36`. |
| `step-cadence.ts` | `StepCadencePlugin.swift` | `isAvailable/start/stop` + `cadence{spm}` | **V** | iOS-guarded at `:25-27`. |
| `platform.ts` | Capacitor | `isNativePlatform` / `getNativePlatform` | **V** | Every iOS-only plugin gates on `getNativePlatform() === "ios"`; no Android plugin is ever called. |
| `billing.ts` | RevenueCat SDK + `/api/revenuecat/webhook` | purchase → entitlement → `profiles.subscription_*` | **B** | Purchase resolves `{ok:true}` with no entitlement check and no reconciliation. See §2.2. |

### 1.4 Webhooks

| Party A | Party B | Contract | Status | Evidence |
|---|---|---|---|---|
| Stripe | `POST /api/stripe/webhook` | signature verification | **V** | `webhook/route.ts:19-33`, raw `request.text()`. |
| Stripe | same | idempotency / ordering / full event coverage / DB write success | **B** | No event store, no `event.created` ordering, `past_due`/`unpaid`/`paused` unhandled, all `update()` errors discarded. See §2.2. |
| RevenueCat | `POST /api/revenuecat/webhook` | shared-secret auth | **U** | `revenuecat/webhook/route.ts:43-48` — non-constant-time `===`, and the route is **not** in `UNTHROTTLED_API_PREFIXES` (`proxy.ts:10`). |
| RevenueCat | same | idempotency / ordering / TRANSFER / write success | **B** | See §2.2. |
| Vercel Cron | `GET /api/cron/{hybrid-reports,leaderboard}` | `CRON_SECRET` in query or Bearer | **V** | `hybrid-reports/route.ts:7-13`, `leaderboard/route.ts:16-22`; exempted from the rate limiter (`proxy.ts:10`). |
| Cron | `profiles` table | processes *all* users | **B** | Unpaginated `.select()` — PostgREST caps at 1000 rows. See §2.9. |

### 1.5 DB ↔ code types

| DB | `src/types/index.ts` | Status | Evidence |
|---|---|---|---|
| `sport_type` enum (9 values incl. `outdoor_cycling`) | `SportType` (9) | **V** | `001:8-11` + `021:14`. |
| `session_type` enum (9 incl. `fartlek`) | `SessionType` (9) | **V** | `001:13-16` + `015:14`. |
| `gender_type`, `experience_level`, `training_goal` | matching unions | **V** | `001:18-29`. |
| `subscription_status` enum (5) | `SubscriptionStatus` (5) | **V** as a type, **B** in use | `001:38-40` — Stripe can send 3 values the enum lacks. See §2.2. |
| `activity_source` enum (10 values) | `Activity.source: "manual" \| "gps"` | **B** | `001:31-34` + `005:24` + `027:14`; TS at `types/index.ts:167`. See §2.10. |
| `profiles.subscription_tier` nullable | `subscription_tier: SubscriptionTier` (non-null) | **B** | `001:63` vs `types/index.ts:123`. |
| `profiles.goals`, `preferred_sports` nullable | non-null arrays | **B** | `001:60-61` vs `types/index.ts:114-115`; code already defends (`api/activities/route.ts:828-829`). |
| `profiles.onboarding_completed`, `created_at`, `updated_at` nullable | non-null | **B** | `001:62,67-68` vs `types/index.ts:116`. |
| `activities.source`, `is_draft`, `metadata`, `created_at`, `updated_at` nullable | non-null | **B** | `001:100-105` vs `types/index.ts:167-172`. |
| `profiles.injury_status` (053) | *absent from `Profile`* | **B** | `053:61`; no TS field. |
| numeric precision (`NUMERIC(5,1)` weight, `(10,1)` distance, `(6,2)` gym weight, `(3,1)` rpe) | plain `number` | **U** | Silent server-side rounding on write; no client-side guard. |
| `activities.avg_heart_rate CHECK 40..230` | `number \| null` | **U** | A 39 bpm strap glitch fails the INSERT and surfaces as a raw PG string (`api/activities/route.ts:347`). |

---

## 2. Broken contracts, severity-ordered

### 2.1 CRITICAL — RLS grants world-read on data the API charges for and the privacy switch hides

> **Status update — a fix landed mid-audit.** `supabase/migrations/056_public_projections.sql`
> appeared in the working tree while this audit was being written (untracked; alongside
> `src/lib/social/public-projections.test.ts`). It drops all six offending policies
> (`056:83-88`) and replaces them with column-named views
> (`public_profiles`, `leaderboard_profiles`, `public_strength_scores`,
> `public_workout_scores`, `public_index_history`, `public_challenge_participation`,
> `public_leaderboard_entries`) plus explicit `REVOKE … FROM anon, authenticated`
> before each grant (`056:417-441`). **The finding below therefore describes the
> pre-056 tree.** Two things still need confirming: (a) 056 is applied to the live
> database — 049's own header documents a duplicate-version incident where a privacy
> migration was silently skipped on every database that had already taken the colliding
> number; and (b) the premium-gating asymmetry in point 2 below is genuinely closed,
> i.e. the new `leaderboard_profiles` / `public_workout_scores` views do not re-expose
> the derived scores that `/api/social/leaderboard/detail` charges for.

`supabase/migrations/001_initial_schema.sql:338`
```sql
CREATE POLICY "Public profiles readable" ON profiles FOR SELECT USING (username IS NOT NULL);
```
plus `001:352` (`workout_scores` `USING (true)`), `001:356` (`split_index_history`),
`001:377` (`challenge_participants`), and `012_public_read_strength_scores.sql:7`
(`strength_scores`).

None carries `TO authenticated`. Supabase grants `SELECT` on `public` tables to the
`anon` role by default, and the anon key is shipped in the client bundle
(`NEXT_PUBLIC_SUPABASE_ANON_KEY`).

**Failure scenario.** Anyone with the public anon key — no account needed — runs
`GET /rest/v1/profiles?select=*` and receives every athlete's `date_of_birth`,
`weight_kg`, `height_cm`, `max_hr`, `resting_hr`, `country`, `stripe_customer_id`,
`subscription_tier` and `subscription_status`, plus every `workout_scores`,
`split_index_history` and `strength_scores` row for every user.

Three contracts break at once:
1. **Privacy.** `049_private_account_visibility.sql` builds `activity_is_visible_to()`
   to keep a private athlete's *activities* behind an accepted friendship, but the
   profile row and every derived score sit outside that predicate. "Private account"
   does not make the account private.
2. **Premium.** `/api/social/leaderboard/detail/route.ts:27-29` returns 403 "Premium
   required" for another user's derived scores; the same rows are readable directly
   from PostgREST. `/api/social/leaderboard/route.ts:36-56` gates global scope the
   same way, to the same effect.
3. **PII.** `stripe_customer_id` and `date_of_birth` are exposed to unauthenticated
   readers.

The comment in `src/lib/social/queries.ts:63-64` ("Not `select("*")` either: that would
drag every other athlete's date of birth, weight, subscription and Stripe id into this
process") shows the team already knows the profile row is over-readable — the fix was
applied at the query, not at the policy.

### 2.2 CRITICAL — Money in, entitlement not out: neither billing webhook is idempotent, ordered, complete, or checked

**Stripe** (`src/app/api/stripe/webhook/route.ts`):

* **Every DB write is unchecked.** `:45-53`, `:62-70`, `:83-91` all `await
  supabaseAdmin.from("profiles").update(...)` and discard the result. The route then
  returns `{received:true}` 200 at `:97` unconditionally. A failed update tells Stripe
  the event was applied. **Stripe will never retry it.**
* **The status cast is a lie.** `:49` — `subscription.status as "active" | "trialing"`.
  Stripe's real union also contains `incomplete_expired`, `unpaid` and `paused`. The
  `subscription_status` column is a Postgres **enum** with exactly
  `trialing|active|past_due|canceled|incomplete` (`001:38-40`). Writing `unpaid` or
  `paused` raises `invalid input value for enum` — which, per the previous point, is
  swallowed and reported as success.
* **Failure scenario (free premium forever).** A Stripe account configured with "mark
  subscription unpaid" rather than "cancel" at the end of dunning: the subscription
  goes `past_due` → `unpaid` and **never** emits `customer.subscription.deleted`. The
  `unpaid` update throws on the enum, is swallowed, and the profile stays
  `premium/active` permanently.
* **No idempotency and no ordering.** No `stripe_events` table; `event.id` and
  `event.created` are never read. Stripe does not guarantee order. A `deleted` followed
  by a late `updated` re-grants premium.
* **No reconciliation for a missed webhook.** `success_url` is
  `/settings/billing?success=true` (`checkout/route.ts:86`) — a static query param. If
  the webhook never lands, the athlete has paid and the app shows them as free, with no
  path back other than contacting support.

**RevenueCat** (`src/app/api/revenuecat/webhook/route.ts`):

* Same unchecked-update / always-200 pattern (`:73-81`, `:86-95`, `:102`).
* No idempotency, no `event_timestamp_ms` ordering. An out-of-order `EXPIRATION` after
  a `RENEWAL` revokes an active subscription.
* `TRANSFER` is an explicit no-op (`:97-100`) — a subscription moved between accounts
  leaves the *old* account premium indefinitely.
* Asymmetric guard: revoke checks `.eq("subscription_source","revenuecat")` (`:95`),
  grant does not (`:73-81`). A native renewal overwrites an active Stripe user's
  `subscription_source`, so the next Stripe `deleted` downgrades them.
* **The route is rate-limited.** `src/proxy.ts:10` exempts only `/api/stripe/webhook`
  and `/api/cron`. A monthly-renewal burst from one RevenueCat egress IP hits the
  60/min limiter and gets `429` — self-inflicted billing loss.
* `verifySecret` at `:47` uses `===` on a secret (non-constant-time).

**Native purchase client** (`src/lib/native/billing.ts:78-101`,
`src/components/pricing/sku-picker.tsx:75-79`):

```ts
await Purchases.purchasePackage({ aPackage: pkg });
return { ok: true };            // billing.ts:88-89
...
if (result.ok) { window.location.reload(); return; }   // sku-picker.tsx:76-79
```
The `CustomerInfo` that `purchasePackage` resolves with — which carries the actual
entitlement — is thrown away. The reload re-renders from `profiles`, which the webhook
has almost certainly not reached yet.

**Failure scenario.** Athlete taps Buy → Apple charges them → page reloads → paywall
still there. They tap Buy again → StoreKit reports "already purchased" → the catch at
`:90-100` shows "Purchase failed. Please try again." `restoreNativePurchases`
(`:104-110`) has the same defect: it returns `{ok:true}` without checking that anything
was actually restored, then reloads to the same paywall.

### 2.3 HIGH — A Live Activity that outlives the app process can never be read or ended

`ios/App/App/LiveActivityPlugin.swift:31` stores the running Activity in
`private var session: Any?`. `end` (`:73-76`) and `getState` (`:95-99`) both guard on
that in-memory reference:

```swift
guard #available(iOS 16.2, *), let activeSession = session as? LiveActivitySession else {
    call.resolve(["ended": true])     // ← says it ended. It did not.
    return
}
```

Nothing calls `Activity<SplitIndexActivityAttributes>.activities` in the app target —
only the widget extension does (`ios/App/SplitIndexWidgets/GymTimerIntents.swift:25`).

This directly contradicts the fix documented in `src/lib/native/live-activity.ts:69-85`,
which removed the JS-side `active` gate on the grounds that "the native plugin already
handles 'nothing is running' gracefully on its own". The native side has the *same*
gate, one layer down, and it lies about the outcome.

**Failure scenario.** Athlete starts a gym session → lock-screen card appears → iOS
kills the app (or they force-quit it) → they reopen and finish the workout. On
successful save, `activity-form.tsx:484` calls `endLiveActivity()`; the plugin's
`session` is nil, it resolves `{ended:true}`, and the card stays on the lock screen
counting up until the system's own multi-hour timeout. Starting a new gym timer then
calls `Activity.request` again, producing **two** cards — despite
`LiveActivityPlugin.swift:9-11` claiming "starting a new one implicitly replaces
whatever was running before".

### 2.4 HIGH — The offline activity queue can duplicate a workout, wedge forever, and cross accounts

`src/lib/activities/offline-queue.ts`:

* **No idempotency key** (`:33-43`). `submit-activity.ts:28-30` enqueues on *any*
  network-shaped failure. If the POST actually reached the server and only the
  *response* was lost, the workout is written server-side **and** queued for replay →
  a duplicate activity, duplicate score, duplicate `split_index_history` row.
  `POST /api/activities` has no dedupe (the `UNIQUE(user_id, source, external_id)` key
  at `001:106` is never populated by this path).
* **Non-2xx is retried forever** (`:70-73`): `if (!res.ok) { failed += 1; continue; }`.
  A 400 (invalid payload), 401 (expired session), 404 (PATCH target deleted) or 429
  (rate limiter) leaves the item in `localStorage` permanently, re-fired on every
  `online` event and every page load (`client-bootstrap.tsx:17-24`).
* **The queue key is device-global**, not per-user (`:1`). Combined with the point
  above: athlete A logs a workout offline → the flush 401s → A signs out → B signs in
  on the same phone → `ClientBootstrap` flushes → **A's workout is written into B's
  logbook and scored against B's profile.**
* `submit-activity.ts:23` does `await res.json()` unguarded — an HTML 500 or an empty
  body throws a `SyntaxError` that `isNetworkFailure` (`:84-94`) does not recognise, so
  the athlete is shown "Unexpected end of JSON input" as the reason their workout did
  not save.

Related asymmetry: `gps-run/page.tsx:667` posts to the same endpoint with **no queue at
all** — the run most likely to be recorded out of signal is the one with no offline
path.

### 2.5 HIGH — No global 401 handling; and the refresh can be double-spent

**No 401 handler.** `src/lib/supabase/proxy.ts:44-60` only redirects *page* navigations
(`isAppRoute`). API routes return `{error:"Unauthorized"}` 401, and there is no
interceptor, no `onAuthStateChange` listener, and no shared fetch wrapper anywhere in
`src/`. A search for `401` across `src/components` and `src/lib` finds exactly one
handler — `fleet-dashboard.tsx:74`.

**Failure scenario (native, the common one).** The WebView sits on `/gym/log` for days
while the app is backgrounded; iOS suspends the JS refresh timer. The refresh token
finally expires. The athlete comes back and logs a session:
* `use-autosave.ts:44-47` flips the draft indicator to "error" and stays there — no
  redirect, no explanation;
* `submitActivityRequest` surfaces the literal word "Unauthorized" as the save error;
* the queue flush counts it `failed` and keeps the item (see §2.4);
* `feed-panel.tsx:104,177` silently do nothing.

Nothing routes them to `/login`. The app appears broken rather than signed out.

**Refresh-token race.** Both `src/proxy.ts` (via `updateSession`) and each route's
`createClient()` (`src/lib/supabase/server.ts:4-28`) instantiate a client that will
refresh an expired token. Multiple API calls fired in parallel — e.g.
`log-quick-actions.tsx:144-148` (`Promise.all` of two) and every simultaneous panel
load on the dashboard — each present the same expired refresh token. With rotation on,
the first rotates it and the rest get `refresh_token_already_used` → 401 → and, per the
above, no recovery.

**Mid-form-submit expiry** is the worst case: the POST body is the whole workout, the
401 discards it, and (on the non-GPS path) the offline queue does not trigger because
`fetch` resolved rather than threw.

### 2.6 HIGH — Two of three sign-out paths leave the previous athlete on the home screen

`src/components/layout/sidebar-account.tsx:66-84` carefully clears both widgets before
signing out, with a comment explaining exactly why. Neither of the other two paths does:

* `src/app/(app)/settings/page.tsx:154-157` — plain sign-out, no widget clear.
* `src/app/(app)/settings/page.tsx:198-205` — **account deletion**, no widget clear.

Neither file imports `clearRacePredictions` or `clearDailyTraining` at all.

**Failure scenario.** An athlete deletes their account from Settings. Every row is
purged server-side (`account/delete/route.ts`) — and their predicted 5K time and their
named training block ("Week 3 · Build", with the exact sessions) stay on the iOS home
screen indefinitely, because the App Group container is never touched and nothing will
ever publish to it again. On a shared or resold phone that is the exact leak
`RacePredictionStore.swift:228-230` was written to prevent.

No path calls `Purchases.logOut()` either, so the RevenueCat SDK keeps the previous
`appUserID`; a purchase made by the next signed-in user can be attributed to the
previous athlete's Supabase id, which is what the webhook keys `profiles` on
(`billing.ts:50`).

### 2.7 MEDIUM — `GET /api/hpe/plan` is a GET with side effects

`src/app/api/hpe/plan/route.ts:80` — a `GET` that runs the engine, calls `savePlan` and
`supersedePlans` (`:9`), and inserts a `hpe_generation_events` telemetry row (`:44-58`).
`src/components/dashboard/todays-session-data.ts:10-14` documents this explicitly as the
reason the dashboard refuses to call it.

**Failure scenario.** Any GET retry — a browser reload, a double navigation, the
WebView being re-created, a prefetch, a proxy retry — supersedes the athlete's current
block and generates a new one. The plan they were training changes underneath them with
no user action and no confirmation. The client fires it on every mount
(`hybrid-plan-screen.tsx:235`).

### 2.8 MEDIUM — GPS recovery has a window where an interrupted run is only in React state

`src/lib/native/gps-tracking.ts:353-371`: `recoverOrphanedSession` detaches the watcher
and **clears the persisted session** (`:364-365`) before returning it. The caller holds
the result in component state (`gps-run/page.tsx:201-204`) and renders a banner offering
"Continue run" / "Save as partial" / "Discard".

**Failure scenario.** iOS kills the app mid-run → athlete reopens → banner appears →
they lock the phone / switch apps before deciding → iOS re-creates the WebView → the
run is gone. Storage was cleared; nothing wrote it back. The second recovery attempt
returns `null`. This is precisely the loss recovery exists to prevent, and the window
is user-paced (however long the banner sits unanswered).

Two smaller sequence defects in the same file:
* `attachWatcher` (`:124-167`) overwrites `WATCHER_ID_KEY` at `:166` without detaching
  whatever id was there. Any path that reaches `startGpsSession`/`rejoinGpsSession`
  while a watcher is live **leaks that watcher permanently** — its id is lost, so
  `removeWatcher` can never be called, and it keeps the location subscription (and its
  battery cost) alive until the process dies. The UI guards this today
  (`gps-run/page.tsx:396` `starting` flag, phase state), but the module contract does
  not.
* `stopGpsSession` with no session (`:255-257`) returns a zero-distance summary with
  `endedCleanly: true` rather than signalling "there was nothing to stop" — a
  stop-before-start is indistinguishable from a genuine zero-metre run.
* `recoverOrphanedSession` clears storage and *then* returns `null` for a session with
  zero fixes (`:371`) — a run killed before its first fix is discarded silently.

### 2.9 MEDIUM — Both cron jobs silently process only the first 1000 profiles

`src/app/api/cron/hybrid-reports/route.ts:30-32` and
`src/app/api/cron/leaderboard/route.ts:31-38` both do an unpaginated
`admin.from("profiles").select(...)`. PostgREST applies a default max-rows limit
(1000 on Supabase).

**Failure scenario.** At 1001 profiles, the monthly Hybrid Athlete Report silently stops
generating for everyone past the cut — including paying premium users — and the
leaderboard ranks only the first 1000 rows returned. Both routes then report success
(`{ok:true, generated:N}`) with a number that looks plausible. There is no pagination
loop and no assertion that the page was full.

### 2.10 MEDIUM — TypeScript claims non-null and narrow unions the database does not enforce

`src/types/index.ts` vs `supabase/migrations/001_initial_schema.sql:44-107`:

| Declared | Actual column |
|---|---|
| `Profile.subscription_tier: SubscriptionTier` (`:123`) | `subscription_tier DEFAULT 'free'` — **nullable** (`001:63`) |
| `Profile.goals: TrainingGoal[]` (`:114`) | `training_goal[] DEFAULT '{}'` — nullable (`001:60`) |
| `Profile.preferred_sports: SportType[]` (`:115`) | nullable (`001:61`) |
| `Profile.onboarding_completed: boolean` (`:116`) | nullable (`001:62`) |
| `Activity.is_draft: boolean` (`:169`) | nullable (`001:102`) |
| `Activity.metadata: Record<string, unknown>` (`:170`) | nullable (`001:103`) |
| `Activity.created_at/updated_at: string` | nullable (`001:104-105`) |

The codebase already defends against these at the call sites — `profile.goals ?? []`
and `profile.preferred_sports ?? []` at `api/activities/route.ts:828-829` — which is the
tell that the type is wrong rather than the data.

**`Activity.source` is narrower than its column.** `types/index.ts:167` declares
`"manual" | "gps"`; the `activity_source` enum holds ten values
(`001:31-34` + `005:24` `file` + `027:14` `gps`). `003_integrations.sql:44` gives
`import_jobs` a `source activity_source NOT NULL` column, so an imported activity can
legitimately carry `strava`/`garmin`/`apple_health`/`file` and be read back as a type
that says it cannot exist. Any `switch (activity.source)` the compiler believes is
exhaustive is not.

**`profiles.injury_status`** (`053_profile_injury_status.sql:61`) has no field on the
`Profile` interface at all.

### 2.11 LOW — Raw Postgres error messages are returned to clients, under invented status codes

`api/activities/[id]/reactions/route.ts:41` and `[id]/comments/route.ts:87` map *any*
Supabase error to **403** with `error.message` verbatim — so a transient connection
failure reads as a permission denial, and the athlete (if the caller ever displayed it,
which it does not) would see a Postgres policy string. `api/activities/route.ts:347`,
`goals/route.ts:78,150,179`, `session-templates/route.ts:31,73,103`,
`draft/route.ts:31,59,89` and others return `error.message` on 500.

### 2.12 LOW — Assorted contract asymmetries

* **`POST /api/activities` has no request schema.** `route.ts:159-162` casts the parsed
  body directly. `zod` is a dependency and is used elsewhere; this, the largest and
  most side-effectful endpoint in the app, does not use it. A malformed body throws out
  of `request.json()` into an unhandled 500.
* **`body_metrics` is written before the activity insert** (`route.ts:216-222` vs the
  insert at `:285` and its failure branch at `:345`) and is not part of
  `rollbackActivity` (`:104-126`). A gym log that fails to save still records a
  bodyweight entry.
* **`GET /api/export/activities` has no caller.** A premium-gated data-export surface
  with no UI, no tests, and no route in the nav.
* **Image-card routes break the error-shape convention.** `interference/report-card/
  route.tsx:24,42` and `reports/hybrid/card/route.tsx` return `new Response("…")` —
  `text/plain` bodies where every other route returns `{error}` JSON. `ShareImageButton`
  falls back to `window.open(href)` (`share-image-button.tsx:44`), so the athlete gets a
  tab containing the words "Not enough paired training data yet".
* **`ShareImageButton`'s blob fallback is dead inside the WebView.**
  `share-image-button.tsx:58-59` does `window.open(URL.createObjectURL(blob))`; a
  `blob:` top-level navigation does not open in a Capacitor WKWebView.
* **`username-check` has no `available` key on its error path** (`route.ts:29-31`) and
  uses `.ilike().maybeSingle()`, which raises PGRST116 if two profiles collide only by
  case.
* **`resolveAdminRole` fails closed** on a missing service-role key
  (`admin-role.ts:30`) — correct, noted as verified.

---

## 3. What was checked and found sound

Worth recording so it does not get re-audited: the two App Group JSON contracts
(race predictions, daily training) are the strongest handshakes in the codebase —
key-for-key matched, every native read optional, `ready`-without-payload degraded to the
honest empty state on both sides, versioned storage keys, an explicit additive-sibling
rule (`race-predictions.ts:79-89`, `daily-training.ts:29-36`), a real sandbox-level
reachability probe rather than a same-process read-back
(`RacePredictionStore.swift:183-187`), and test coverage. Both survive an old native
binary against a new server, which is exactly what the deployment model demands.

Auth scoping at the route layer is likewise sound: all 50 authenticated routes call
`auth.getUser()` and 401, and every direct table access is `.eq("user_id", user.id)`.
The gap is one layer down, in the RLS policies those routes lean on (§2.1).
