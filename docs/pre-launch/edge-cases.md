# Edge-case & destructive test report

**Date:** 2026-09-06 · **Branch:** `hybrid-plan-engine` · **Method:** code read + throwaway `npx tsx` probes run against the real pure functions in `src/lib/**` and `src/components/activities/form-state.ts`. No file under `src/` or `supabase/` was modified.

**Baseline:** `npx vitest run` — **98 files, 1348 tests, all passing, 31.5s.** Every finding below is therefore something the existing suite does not cover.

Severity key: **S1** crash or silent data loss · **S2** wrong data persisted / user blocked · **S3** wrong output shown · **S4** latent.

---

## S1 — Crashes and silent data loss

### 1.1 Billing webhooks discard the database error and always answer 200

**Code path:** `src/app/api/stripe/webhook/route.ts:42-90`, `src/app/api/revenuecat/webhook/route.ts:70-90`

Every profile write in both webhooks is a bare `await`:

```ts
await supabaseAdmin
  .from("profiles")
  .update({ subscription_tier: "premium", ... })
  .eq("user_id", userId);
break;                       // error never read
...
return NextResponse.json({ received: true });   // always 200
```

**Sequence:** user pays → Stripe/RevenueCat POSTs the grant event → the Supabase update fails (transient 5xx, connection reset, RLS/role change, `userId` not a UUID) → the route returns `{received:true}` → the provider marks the event delivered and never retries → **the user has paid and is permanently on the free tier.** There is no reconciliation job.

The same shape revokes access: an `EXPIRATION` whose update fails leaves a lapsed user premium forever.

**Also:** neither webhook dedupes on `event.id`, and neither guards ordering. Stripe does not guarantee order, so a retried `customer.subscription.updated` arriving after `customer.subscription.deleted` re-grants premium to a cancelled account. `revenuecat/webhook/route.ts:44-48` compares the shared secret with `auth === \`Bearer ${secret}\`` — not constant-time.

**Fix:** read the error on every write; return a non-2xx so the provider retries; add a `billing_events(event_id PRIMARY KEY)` table written in the same statement as the profile update, and ignore an event whose id is already present. Reject a grant/revoke whose event timestamp is older than `profiles.subscription_updated_at`.

---

### 1.2 Any string can be written to `profiles.timezone`, and it 500s the dashboard

**Code path:** `src/app/api/profile/timezone/route.ts:16-19` → `src/lib/utils/timezone.ts:10-13,32-39` → `src/app/(app)/dashboard/page.tsx:131,397,460` and `src/components/analytics/utils.ts:450,522,543`

The route accepts *any* non-empty string:

```ts
const timezone =
  typeof body.timezone === "string" && body.timezone.trim()
    ? body.timezone.trim()
    : detectBrowserTimezone();
```

`resolveTimezone` only trims — it never validates against the IANA set — and `localDateKeyInTz` hands the value straight to `new Intl.DateTimeFormat(...)`.

**Input:** `POST /api/profile/timezone` with `{"timezone":"Not/AZone"}` (or `"UTC+5"`, `"Etc/GMT+14"`, `"'; DROP TABLE--"`, 300 × `"A"`).

**Observed:**

```
=== Invalid / hostile timezone strings ===
  tz="Not/AZone"      -> THREW RangeError: Invalid time zone specified: Not/AZone
  tz="UTC+5"          -> THREW RangeError: Invalid time zone specified: UTC+5
  tz="Etc/GMT+14"     -> THREW RangeError: Invalid time zone specified: Etc/GMT+14
  tz="'; DROP TABLE--"-> THREW RangeError: Invalid time zone specified: '; DROP TABLE--
  tz="AAAA…"(300)     -> THREW RangeError: Invalid time zone specified: AAAA…

  computeStreak(tz='Mars/Olympus') -> THREW RangeError: Invalid time zone specified: Mars/Olympus
```

`computeStreakMetrics` at `dashboard/page.tsx:397` is not wrapped in a `try` — the RangeError escapes the server component and `/dashboard` returns 500 on every load. `/analytics` fails the same way through `computeStreak`/`computeHitRate`.

Note this does **not** require malice: `detectBrowserTimezone()` returns `Intl.DateTimeFormat().resolvedOptions().timeZone` verbatim, and any engine that reports a non-round-trippable value (some Android WebViews report offset strings) bricks that user's dashboard. Recovery only happens if they load some *other* page, because `ClientBootstrap` re-posts the timezone — and `ClientBootstrap` never runs on a page that 500s during server render.

Related: `localDateKeyInTz("garbage","UTC")` → `RangeError: Invalid time value`, and `startOfLocalDayInTz("garbage","UTC")` throws the same. Neither is guarded.

**Fix:** validate in the route with `Intl.supportedValuesOf("timeZone")` (or a `try { new Intl.DateTimeFormat("en-CA",{timeZone}) } catch { 400 }`), add a length cap, and make `resolveTimezone` fall back to `"UTC"` on an unparseable stored value instead of trusting it.

---

### 1.3 The offline queue duplicates activities, and never gives up on a poisoned item

**Code path:** `src/lib/activities/submit-activity.ts:12-44` → `src/lib/activities/offline-queue.ts:49-79`

```ts
} catch (err) {
  if (!navigator.onLine || isNetworkFailure(err)) {
    const item = enqueueActivitySubmit({ url, method, payload });
```

`isNetworkFailure` returns true for any `TypeError` / `"failed to fetch"` / `"load failed"`. That is exactly what `fetch` rejects with when **the request reached the server and the response was lost** — the ordinary mobile case of a phone dropping cell coverage mid-POST.

**Sequence:** log a workout on a train → server writes `activities` + `workout_scores` + `split_index_history` + `body_metrics` + PRs → tunnel → `fetch` rejects → payload enqueued → `ClientBootstrap`'s `online` handler flushes → **a second identical activity, second score, second index-history row, second bodyweight row, and a second run at the personal records.** `POST /api/activities` has no idempotency key and no duplicate detection.

Second defect in the same function:

```ts
if (!res.ok) { failed += 1; continue; }   // item stays in the queue
```

A queued `PATCH` for an activity the user has since deleted returns 404 forever; a payload the server now rejects with 400 returns 400 forever. Neither is ever removed, there is no attempt cap, and `getPendingActivityCount()` never reaches zero — so the "pending sync" indicator is stuck and every flush re-POSTs.

Third: `flushActivityQueue` is called from both the `online` listener and the mount path (`client-bootstrap.tsx:18,23`) with no in-flight guard. Both read the queue array up front, so a double-fire posts the same item twice.

**Fix:** have the client generate a `client_submission_id` (UUID) per submit, store it in `activities`, make it `UNIQUE(user_id, client_submission_id)`, and have `POST /api/activities` return the existing row on conflict. Drop a queued item on any 4xx, cap retries, and hold a module-level flush lock.

---

### 1.4 Deleting an activity leaves an unbeatable ghost personal record

**Code path:** `src/app/api/activities/[id]/route.ts:383-417` vs `supabase/migrations/001_initial_schema.sql:167`

```sql
activity_id UUID REFERENCES activities(id) ON DELETE SET NULL,
```

`DELETE /api/activities/[id]` explicitly cleans `split_index_history` (line 408) and nothing else. `personal_records` is left behind with `activity_id = NULL`, still holding the athlete's claimed best 5k / best squat from a session that no longer exists. Because `upsertPersonalRecordsIfBetter` only replaces a record when the new value is *better*, and the `UNIQUE(user_id, sport, metric)` row still occupies the slot, **the ghost record can never be displaced by real training.** The only escape is a full `POST /api/activities/recompute`.

`merge/route.ts:317-322` already documents and fixes exactly this ("a record set on half a run is not a record"), and `unmerge/route.ts:164` does too — the plain delete route is the one that was missed.

**Fix:** in `DELETE`, delete `personal_records` where `activity_id = id` before deleting the activity, mirroring `deleteAbsorbed`.

---

### 1.5 `body_metrics` rows are written before the activity and never rolled back

**Code path:** `src/app/api/activities/route.ts:216-222` (write) vs `104-126` (`rollbackActivity`) and `624-627`

```ts
if (bodyweightKg && body.sport === "gym") {
  await supabase.from("body_metrics").insert({ user_id, weight_kg, recorded_at: body.started_at });
}
```

This runs **before** the `activities` insert. Every failure path afterwards — the scoring 400 at line 624, `failAndRollback` for `gym_exercises` / `workout_scores` / `split_index_history` — unwinds the activity but leaves the bodyweight row. `rollbackActivity` touches only `split_index_history` and `activities`.

A user who fat-fingers a weight, gets a 400, corrects it and resubmits has written **two** `body_metrics` rows — one of them the wrong weight — and the weight-trend chart shows both.

Compounding: `PATCH /api/activities/[id]:265-271` inserts a *new* `body_metrics` row on every single edit, all at the same `recorded_at`. Editing one gym session five times produces five bodyweight readings for that instant.

**Fix:** move the `body_metrics` insert after the activity insert, add it to `rollbackActivity`, and make the PATCH path an upsert keyed on `(user_id, recorded_at)`.

---

## S2 — Wrong data persisted, or the user is blocked

### 2.1 Rowing / ski erg cannot be logged at most distances — dead-end submit

**Code path:** `src/components/activities/form-state.ts:1084-1088` (derive) and `:987` (`duration_seconds: z.number().int().positive()`)

`createDefaultState` sets `rowInputMode: "distance"` (line 517), so `derivesTime` is the **default** path for rowing and ski erg. Duration is then derived as a float and handed to a schema that demands an integer:

```ts
duration = avgSplit != null && distanceMeters != null ? (avgSplit / 500) * distanceMeters : 0;
...
duration_seconds: duration,      // never rounded
```

**Observed** (`validateAndBuildPayload("rowing", …)`):

```
  2000m @ 1:52 (split 112s) derived=448      -> payload=OK dur=448 errors={}
  1234m @ 1:52 (split 112s) derived=276.416  -> payload=NULL errors={"form":"Something looks off — double-check the highlighted fields"}
  750m  @ 1:53 (split 113s) derived=169.5    -> payload=NULL errors={"form":"Something looks off — double-check the highlighted fields"}
  1000m @ 2:03 (split 123s) derived=246      -> payload=OK dur=246 errors={}
  6000m @ 1:57 (split 117s) derived=1404     -> payload=OK dur=1404 errors={}
```

Any distance that is not a multiple of 500 (or that pairs with a split of the wrong parity) fails. The error is the generic `form` key — **no field is highlighted**, so the athlete has no way to work out what to change and no combination of edits to that distance will ever succeed.

**Fix:** `duration = Math.round((avgSplit / 500) * distanceMeters)`. Separately, the `payloadSchema.safeParse` fallback should never be the *only* thing that fires — a structural failure with no field key is a bug, not a user error, and should be logged.

---

### 2.2 Ordinary beginner sessions score exactly **0**

**Code path:** `src/lib/scoring/service.ts:113` → `scoreActivityWithEngines`; `clampIndexScore` (`input-guards.ts`) enforces `[MIN_INDEX=1, MAX_INDEX=999]` but is not applied to `sportIndex` on this path.

**Observed** (30-year-old male, default profile):

```
  5 km in 25:00 (fit)              -> sportIndex=627
  5 km in 45:00 (jog)              -> sportIndex=173
  5 km in 60:00 (slow)             -> sportIndex=0
  5 km in 90:00 (walk pace)        -> sportIndex=0
  marathon in 4:00                 -> sportIndex=657
  marathon in 8:00                 -> sportIndex=137
  marathon in 12:00 (ultra walk)   -> sportIndex=0
  1 km in 30:00 (rehab walk)       -> sportIndex=0
  100 m in 30:00                   -> sportIndex=0
  no distance, 25 min              -> sportIndex=0

  walking 5000m in 3600s -> 300
  walking 5000m in 5400s -> 0
  walking 1000m in 1800s -> 0
  swimming 1000m in 3600s -> 0
  rowing  2000m in 1800s -> 0
```

A couch-to-5k beginner's first parkrun (5 km in an hour), a 90-minute 5 km walk, a 12-hour marathon and a 1 km post-surgery walk all persist `sport_index = 0` into `workout_scores` and `split_index_history`. Zero is outside the engine's own declared range, it drags every trend average and moving-average toward zero, and it is the worst possible first impression for exactly the cohort most likely to churn.

**Fix:** route every `sportIndex` through `clampIndexScore` before it is returned or persisted, and give the slow end of each benchmark curve a real floor rather than letting it fall off. If a session genuinely cannot be scored, that is a distinct state, not the number 0.

---

### 2.3 Age, sex and bodyweight are self-declared and multiply the score directly

**Code path:** `src/lib/utils/age.ts:24` (`age >= 0 && age <= 150`), `src/lib/scoring/adapters.ts:56-67`, `src/lib/activities/bodyweight.ts:39-56`

**Observed** — identical 5 km in 25:00, only the profile changes:

```
=== AGE GAMING ===
  age 20 -> 627     age 60 -> 805     age 100 -> 988
  age 30 -> 627     age 70 -> 906     age 120 -> 988
  age 40 -> 649     age 80 -> 988     age 150 -> 988
  age 50 -> 710     age 90 -> 988

=== SEX GAMING ===
  gender=male   -> 627
  gender=female -> 727
  gender=null   -> 627   (DEFAULT_SCORING_BASIS, isDefault:true)
  gender=other  -> 627
```

`date_of_birth` and `scoring_basis` are ordinary editable profile fields. Editing DOB to 1946 moves the same run from 627 to 988 — 60% of the way up the remaining range — and the leaderboards read `sport_index` directly. `ageFromDateOfBirth("1900-01-01")` returns **126** and is accepted.

`resolveScoringBasis` is correct and never throws (verified: `{}`, `null`, `"other"`, `"prefer_not_to_say"`, `"banana"`, `"MALE"` all resolve to the flagged default) — the problem is not the resolution, it is that nothing downstream distinguishes a self-declared age of 90 from a verified one.

**Fix:** cap the age-grading factor at a plausible ceiling (~85), record `profiles.date_of_birth_changed_at`, and exclude from public leaderboards any athlete whose DOB or scoring basis changed inside the ranking window. `ageFromDateOfBirth` should cap at ~110, not 150.

---

### 2.4 Gym scoring saturates at 999, and any invented exercise name reaches it

**Code path:** `src/lib/scoring/split-strength-engine.ts` via `scoreActivity`

**Observed** (80 kg lifter, one exercise):

```
=== Gym score vs load ===
   20 kg x 5 -> 412      100 kg x 5 -> 999
   40 kg x 5 -> 675      140 kg x 5 -> 999
   60 kg x 5 -> 829      200 kg x 5 -> 999
   80 kg x 5 -> 939      400 kg x 5 -> 999
                         500 kg x 5 -> THREW …implausible for the recorded bodyweight

=== Degenerate sets that pass every guard ===
  0 kg x 1 (bodyweight)          -> 1
  0 kg x 1000000 reps            -> 1
  unknown 500-char exercise name -> 999
  emoji exercise name "🏋️‍♂️💀"    -> 999
  RTL exercise name "‮بنش برس"   -> 999
  newline name "squat\n\n\nDROP TABLE" -> 999
```

Two problems. First, the curve tops out at 1.25 × bodyweight — a 100 kg squat for an 80 kg lifter is an intermediate lift, and everyone from there upward is indistinguishable at 999, which makes the strength half of the Split Index useless for the target user. Second, a **free-text exercise name is scored on the same curve as a known barbell lift**, so typing any string with `100 kg × 5` yields a perfect strength score. There is no allowlist gate.

Also: a genuine bodyweight-only session (`0 kg × N`) scores **1**, the floor.

**Fix:** extend the strength curve well past 2 × BW before it saturates; score unrecognised exercise names on a conservative/accessory curve or exclude them from the index entirely (`isMachineAnchoredLift` already shows the per-exercise-metadata pattern); handle `weight_entry_mode` for bodyweight movements rather than treating 0 kg as no load.

---

### 2.5 DST transitions mis-count the streak in both directions

**Code path:** `src/lib/retention/streak-utils.ts:28-49`

```ts
const probe = new Date(referenceDate.getTime() - i * DAY_MS);   // DAY_MS = 86400000
```

Subtracting a fixed 86 400 000 ms from a fixed instant, then reading the *local* calendar day, skips a day across a 23-hour day and repeats one across a 25-hour day.

**Observed** (5 consecutive training days logged in every case):

```
=== DST spring-forward: Europe/London, 2025-03-30 (23h day) ===
  ref=31 Mar 00:30 local -> streak=4 (expected 5) weeklySessions=4 (expected 5)
  ref=31 Mar 01:30 local -> streak=5                weeklySessions=5
  ref=31 Mar 12:30 local -> streak=5                weeklySessions=5

=== DST fall-back: Europe/London, 2025-10-26 (25h day) ===
  ref=27 Oct 23:30 UTC   -> streak=6 (expected 5) weekly=6 (expected 5)

=== America/Santiago (midnight transition), 6 consecutive days logged ===
  America/Santiago       -> streak=5 (expected 6) weekly=5 (expected 6)
```

An athlete who opens the app between 00:00 and 00:59 on the morning after the clocks go forward is told their streak **broke** — and `seedRetentionNotifications` (`dashboard/page.tsx:407`) fires the "streak at risk" push off exactly this number. In autumn the same athlete is credited with a day they did not train, and `weeklySessions` is inflated against `weeklyTarget`.

The identical bug is in `src/components/analytics/utils.ts:528` (`computeStreak`) and `:548` (`computeHitRate`).

**Fix:** walk calendar days, not milliseconds — decrement the `yyyy-MM-dd` key itself (`date-fns` `subDays` on the local-midnight `Date` from `startOfLocalDayInTz`), which is already available in `timezone.ts`.

---

### 2.6 `parseNum` accepts hex, binary, octal and exponent notation

**Code path:** `src/components/activities/form-state.ts:719-724`. The inputs are `type="text" inputMode="decimal"` (`fields.tsx:121-122,163-164`), so any string reaches this function.

**Observed:**

```
  parseNum("0x10")   = 16          parseNum("0b101") = 5
  parseNum("0o17")   = 15          parseNum("1e5")   = 100000
  parseNum("007")    = 7           parseNum(".5")    = 0.5
  parseNum("5.")     = 5           parseNum("+5")    = 5
  parseNum("1,5")    = 1.5         parseNum("1.2.3") = null
  parseNum("١٢٣")    = null        parseNum("1_000") = null

=== smuggled through a form field ===
  distance="0x10" -> 16000 m stored, no error
  distance="1e3"  -> 1000000 m stored, no error
  avgHr="0x64"    -> hr=100 stored, no error
  hours="0x10"    -> 57600 s (16-hour session), passes the 24 h check
```

The user sees `0x10` in the field and a 16 km run is saved. The field never disagrees with them.

**Fix:** replace `Number(trimmed)` with an explicit decimal test — `/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/` — and decide deliberately whether exponent notation is allowed (it should not be, in a distance field).

---

### 2.7 No upper bound on distance, and no future-date guard on `started_at`

**Code path:** `form-state.ts:1071-1075` (no `max`), `:1046-1048` (only `isNaN` on the date), `api/activities/route.ts:291,658,685`

```
  distance="1e10"  -> payload dist_m=10000000000000  pace=1.8e-7   (client accepts)
  distance="500000"-> payload dist_m=500000000       pace=0.0036   (client accepts)
  started_at "2099-12-31T23:59" -> started_at=2099-12-31T23:59:00.000Z (accepted)
  started_at "1900-01-01T00:00" -> accepted
  started_at "0001-01-01T00:00" -> 0001-01-01T00:01:15.000Z (LMT offset applied silently)
```

The distance cases are caught server-side by `assertScoringInput` (500 km cap) — but only as an opaque 400 after a round trip, and the resulting pace error names the wrong field. The **date** cases are not caught anywhere. `body.started_at` is written verbatim to `activities.started_at`, `workout_scores.created_at` and `split_index_history.recorded_at`, so a session dated 2099 permanently becomes `latestIndex` (`dashboard/page.tsx:167-173` orders by `recorded_at DESC LIMIT 1`) and every `previousSplitIndex` delta is computed against it forever.

The inverse of 2.7 also bites honest users: a 100 m rehab walk in 30 minutes is 18 000 s/km and is rejected with *"Average pace is out of the plausible range"* — a message about a field the athlete never filled in.

**Fix:** add a `max` to the distance field per sport; reject `started_at` more than a few hours in the future and earlier than, say, 1950, in `assertScoringInput` so the API and the form agree; widen `MAX_PACE_SECONDS` or exempt very short distances.

---

### 2.8 `assertScoringInput` lets three impossible values through

**Code path:** `src/lib/scoring/input-guards.ts:100-215`

```
  reps 1e6      -> ACCEPTED     (only Number.isInteger + > 0 are checked)
  weight_kg 0   -> ACCEPTED
  sport "quidditch" -> ACCEPTED (the `sport` param is never validated)
```

`reps: 1000000` reaches `gym_exercises.reps` and the volume/1RM arithmetic. `sport` is only stopped later by the Postgres enum, which surfaces as a raw driver message in the 500 body (`route.ts:346-349` returns `activityError.message` to the client).

Separately, `scoreActivity` (`service.ts:127-140`) calls `assertScoringInput` **without `rpe`** — the RPE range check only runs because the two API routes pass it themselves. Any future caller of `scoreActivity` gets no RPE validation.

**Fix:** cap `reps` at 200 (the form already does), require `weight_kg > 0` unless the exercise's tracking is bodyweight, validate `sport` against the enum, and pass `rpe` through in `scoreActivity`.

---

## S3 — Wrong output shown

### 3.1 "Today's session" on the dashboard uses server time, not the athlete's timezone

**Code path:** `src/components/dashboard/todays-session-data.ts:86-89` → `src/app/(app)/dashboard/page.tsx:153`

```ts
export async function loadTodaysSessionPayload(supabase, userId, today: Date = new Date())
...
const todaysSessionPromise = loadTodaysSessionPayload(supabase, user.id);   // default arg
```

The dashboard computes `userTimezone` at line 131 and threads it into `computeStreakMetrics` and the heatmap — but not into this call. `new Date()` on Vercel is UTC. An athlete in Auckland opening the app at 09:00 on Tuesday (20:00 Monday UTC) is shown **Monday's** prescribed session; one in Los Angeles at 18:00 Monday (02:00 Tuesday UTC) is shown Tuesday's.

`buildPlanCalendar` itself is sound — `offsetDays` uses `date-fns` local midnights and rounds correctly across DST (a 7-day span with one transition is 167 h → 6.958 → 7).

**Fix:** pass the profile timezone through and derive `today` with `startOfLocalDayInTz(localDateKeyInTz(new Date(), tz), tz)`.

### 3.2 Two workouts on one local day count as one weekly session

`computeStreakMetrics` builds a `Set` of day keys, so `weeklySessions` counts *days*, not sessions, while being compared against `weeklyTarget: 4` and labelled as sessions.

```
=== Two activities same LOCAL day, different UTC days ===
  keys: 2025-06-02 / 2025-06-02
  weeklySessions=1 (2 workouts, 1 local day) streak=1
```

A two-a-day athlete — the exact hybrid user this product targets — is systematically under-credited. (The date-line case itself is handled correctly: the same instant keys as `2025-06-01` in Auckland and `2025-05-31` in Honolulu, which is right.)

### 3.3 Formatters emit `NaN` and negative clock strings into the UI

`src/components/activities/form-state.ts:762-770`:

```
  formatClock(NaN)      = "NaN:NaN"
  formatClock(Infinity) = "Infinity:NaN:NaN"
  formatClock(-90)      = "-2:-30"
  deriveSpeedKmh(1000, 1e-9) = "3600000000000.0 km/h"
```

These are the live preview strings under the duration/pace fields, so a half-typed or pathological entry renders literal `NaN:NaN`.

### 3.4 `clampIndexScore(Infinity)` returns the *minimum*

`input-guards.ts`:

```
  clampIndexScore(NaN)       = 1
  clampIndexScore(Infinity)  = 1
  clampIndexScore(-Infinity) = 1
  clampIndexScore(1e308)     = 999
```

`if (!Number.isFinite(value)) return MIN_INDEX;` maps a scoring blow-up to "worst possible athlete" rather than surfacing it. `Infinity` should clamp to `MAX_INDEX` or throw; `NaN` should throw.

### 3.5 The share-image card renders an unbounded, unvalidated display name

**Code path:** `src/app/api/interference/report-card/route.tsx:45,71` and `src/app/api/reports/hybrid/card/route.tsx:36`

```tsx
const name = profile?.display_name ?? profile?.username ?? "This athlete";
...
<div style={{ fontSize: 40, fontWeight: 700, marginTop: 12 }}>{name}</div>
```

`profiles.display_name` is plain `TEXT` with no constraint (`001_initial_schema.sql:49`) and is seeded from `raw_user_meta_data->>'full_name'` (`007_signup_trigger_bulletproof.sql:14-18`) — i.e. from the attacker-controlled `options.data` of `supabase.auth.signUp`. Nothing between there and the card validates length, newlines or direction marks.

In a 1200×630 `ImageResponse` with `justifyContent: "space-between"`, a 500-character or newline-laden name wraps and pushes the headline off the canvas. Neither route passes a `fonts` array, so emoji and non-Latin scripts fall back to the bundled Latin face and render as blanks/tofu, and Satori has no bidi support so an RTL name renders reversed. A name of `"Split Index Support"` or one containing U+202E is a plausible impersonation vector, and `display_name` is also projected to other users through `056_public_projections.sql`.

`validateUsernameFormat` (`src/lib/utils/username.ts`) is solid — `^[a-zA-Z][a-zA-Z0-9_]{2,19}$` plus a blocklist — but **nothing equivalent exists for `display_name`.**

**Fix:** validate `display_name` on write (length ≤ 40, strip control chars and bidi overrides, reject names containing "split index"/"admin"/"support"), and truncate with an ellipsis in both card routes regardless.

---

## S4 — Latent / lower reachability

### 4.1 Merge metadata grows ~2× per nested merge

`api/activities/merge/route.ts:184-194`: `mergedMetadata` spreads `survivorMetadata` **and** embeds `snapshots` — and `MERGE_SNAPSHOT_COLUMNS` (`merge.ts:499-529`) includes `"metadata"`. So the survivor's whole previous metadata, including its previous `merge.sources`, is nested inside the new one *and* copied alongside it.

`MERGE_MAX_SOURCES` caps sources per call but nothing caps nesting depth. Merge A+B, then A+C, then A+D… and `activities.metadata` roughly doubles each time. Twenty sequential merges is a JSONB blob the row and the logbook query cannot carry.

(The nesting itself is *correct* — because `metadata` is snapshotted, unmerging A+C restores A to its A+B-merged state, which can then be unmerged again. That is good design; only the unbounded growth is the problem.)

**Fix:** cap `merge.sources[].metadata` to a depth of 1 — strip the nested `merge` key from a source snapshot's metadata and store the chain as a flat list with a depth limit.

### 4.2 Concurrent unmerge reports a false catastrophe

`unmerge/route.ts:144-160` re-inserts absorbed legs **under their original ids**. Two concurrent POSTs both read the merge record, both restore the survivor, and the loser's `insert` hits the primary key. It returns 500 with *"We restored the first session but could not bring the others back. Check your logbook before trying again."* — alarming, and untrue: the data is fine.

**Fix:** use `.upsert(..., { onConflict: "id", ignoreDuplicates: true })`, or detect the unique-violation code and treat it as success.

### 4.3 Concurrent recompute can wipe the personal-record table

`recompute-user.ts:628-648` deletes **every** `personal_records` row for the user and then inserts the rebuilt set — two statements, no transaction, no advisory lock. `POST /api/activities/recompute` takes no parameters and has no rate limit or in-flight guard, so a double-tap runs two full passes concurrently. If run B's delete lands between run A's delete and insert, run A's insert hits `UNIQUE(user_id, sport, metric)` and fails wholesale — `noteRebuild` records it in `rebuildFailures`, but `recomputed` still reads total-of-total and the route returns 200. The code comment already flags this as "the most destructive write in this function"; the missing piece is the guard.

Same window exists between a recompute and a concurrent `POST /api/activities` PR upsert.

**Fix:** wrap the delete+insert in a Postgres function (single transaction), and take a `pg_advisory_xact_lock(user_id)` for the whole recompute.

### 4.4 HPE intake accepts arbitrary values; DB CHECKs surface as 500s

`api/hpe/intake/route.ts:60-84` allowlists by *key* only — `values[key] = value` with no type or range check. The numeric columns are protected by `042_hpe_intake.sql` CHECK constraints (`max_sessions_per_week BETWEEN 3 AND 12`, `life_stress_now BETWEEN 1 AND 5`, …), so a hostile PATCH gets a Postgres constraint violation returned verbatim as a **500** rather than a 400 with a usable message.

The unconstrained columns do accept anything: `day_windows JSONB`, `exercises_by_day`, `custom_split_days`, `events TEXT[]`, `travel_weeks SMALLINT[]` (negative or absurd week numbers), `primary_modality TEXT`, `preferred_long_day` / `preferred_rest_day TEXT` (no day-name check), `federation TEXT`, `notes TEXT`.

On the client, `intake-fields.tsx:121` does `Number(e.target.value)` with `min`/`max` only as HTML attributes — not enforced for programmatic values — and `parseIntakeRow`'s `n()` helper (`intake-record.ts:383`) is `Number(row[key])` with **no NaN guard**, so a non-numeric value in a text-typed column propagates `NaN` into the plan engine.

**Fix:** a zod schema per section in the PATCH handler, returning 400 with the offending field; add `Number.isFinite` guards to `parseIntakeRow`'s `n()`.

### 4.5 `PATCH` validates lift weight against a stale bodyweight

`api/activities/[id]/route.ts:157` passes the raw `profile` to `assertScoringInput`, so the `weight_kg > bw * maxBodyweightMultiple` check uses `profiles.weight_kg` — not the `body.bodyweight_kg` submitted with the edit, and not the session's own anchored bodyweight (which the route *does* read at line 166-171 for scoring). `POST` uses the resolved `scoringProfile` (line 192, 207). An athlete who has since lost weight can have a historically valid session rejected on edit.

### 4.6 `parseSeconds` accepts degenerate clock strings

```
  parseSeconds(":")       = 0        parseSeconds("1:")     = 60
  parseSeconds("::")      = 0        parseSeconds(":30")    = 30
  parseSeconds("1:99")    = 159      parseSeconds("1:1e3")  = 1060
  parseSeconds("0x10:00") = 960      parseSeconds("  :  ")  = 0
```

`"1:99"` silently means 2:39, and `"0x10:00"` means 16:00. Empty segments become 0 because `Number("") === 0`.

### 4.7 `ageFromDateOfBirth` rolls invalid dates over

```
  "2013-02-30" -> 13     (JS rolls to 2 Mar)
  "1900-01-01" -> 126    (accepted; the guard is `<= 150`)
  "0000-01-01" -> null
  "2026-09-07" -> null   (future DOB correctly rejected)
```

`daysUntilDate("+275760-09-13")` → **99 979 298** days, which feeds the training-plan tapering and feasibility logic (`src/lib/utils/date.ts:14`).

### 4.8 `computeHitRate` returns 100% for a target of 0

`analytics/utils.ts:539-559`: `if (sessions >= targetSessionsPerWeek) hitWeeks++` with `target = 0` scores every week a hit, including on an empty heatmap. Not currently reachable (`analytics/page.tsx:207` hardcodes 4), but it becomes reachable the moment the target is user-configurable. `computePeriodMetrics`'s `consistencyPct` divides by the same value: `0/0` → `NaN` → renders `NaN%`.

### 4.9 Raw driver errors returned to the client

`api/activities/route.ts:346-349`, `merge/route.ts:208`, `[id]/route.ts:210`, `hpe/intake/route.ts:83` all return `error.message` from Supabase straight to the browser — leaking column names, constraint names and enum values.

---

## What was tested and found sound

Worth recording so it is not re-litigated:

- `resolveScoringBasis` / `resolveScoringSex` — **never throws** for any input tried (`{}`, `null`, `"other"`, `"prefer_not_to_say"`, `"banana"`, `"MALE"`), correctly flags `isDefault`. The documented signup-to-dead-end is genuinely fixed.
- Volume: 10 000 activities → `computeStreakMetrics` 25 ms, `buildHeatmapDays` 14 ms, `computeStreak` 1 ms. A 50-exercise × 200-set gym session scores in **15 ms**. 10 000 rows of history through the index engine: **51 ms**. No pathological complexity found.
- 0 activities and 1 activity: no crash on any path exercised.
- Date-line travel: `localDateKeyInTz` is correct (`2025-06-01T06:00Z` → `2025-06-01` Auckland, `2025-05-31` Honolulu).
- `buildPlanCalendar`'s `offsetDays` is DST-safe.
- Merge/unmerge design: overlap rejection, gap ceiling, mixed-sport rejection, survivor-first ordering, snapshot-based undo, and nested-merge undo all behave correctly. "Unmerge something never merged" returns a clean 400.
- `PATCH /api/activities/[id]` reads the previous `gym_exercises` before deleting them and restores on a failed replace.
- `validateUsernameFormat` is tight (ASCII-only pattern rejects unicode homoglyphs; substring blocklist).
- HPE intake `PATCH` is correctly allowlisted **by section**, so a preferences PATCH cannot rewrite the safety answers.
- Stripe/RevenueCat writes are absolute (not incremental), so a redelivered event in isolation is harmless — the ordering and error-handling gaps in 1.1 are the live risks.

---

## Suggested order of work

1. **1.1** billing webhook error handling — costs real money, silently.
2. **1.2** timezone validation — one authenticated POST 500s the dashboard.
3. **2.1** rowing duration rounding — one-line fix, unblocks a whole sport.
4. **2.2** clamp `sportIndex` — a first-time user being told "0" is the worst possible onboarding.
5. **1.3** submission idempotency key — the highest-volume duplicate-data path.
6. **1.4 / 1.5** delete/rollback cleanup for `personal_records` and `body_metrics`.
7. **2.5** calendar-day streak walk.
8. Everything else.
