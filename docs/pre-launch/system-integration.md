# System Integration — the seams between subsystems

Scope: the joins, not the halves. Each subsystem below works in isolation; what
follows is what happens where two of them meet.

**Verification gates (all green, all run on `hybrid-plan-engine` @ adb35c5):**

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0, no diagnostics |
| `npx vitest run` | 98 files, 1348 tests, all passing |
| `npx next build` | exit 0 |

That matters for how to read this document: **every defect below compiles, type-checks
and passes the suite.** They are all seam defects — two sides that are each internally
consistent and disagree with each other. None of them can be caught by the gates
this repo runs, which is why they are still here.

> **Baseline note.** The working tree moved underneath this review — other work
> landed in `src/lib/social/leaderboard*.ts`, `(app)/dashboard/page.tsx`,
> `(app)/cardio/gps-run/page.tsx`, several form components, and a new
> `supabase/migrations/056_public_projections.sql` (which replaces the six
> `USING (true)` public-read policies with column-named views). Line references
> below were re-checked against the tree as it stands and the cited lines are
> unchanged, but **Seam 3 and D17 predate 056** — re-read the leaderboard and
> dimension-leaderboard read paths against those views before acting on them.

---

## Seam 1 — LOG → SCORE → INDEX → DISPLAY

### The trace

```
src/components/activities/form-state.ts:1400 buildPayload()
      ActivityPayload  (no max_heart_rate, no avg_cadence, no route)
  ↓
src/lib/activities/submit-activity.ts:12 submitActivityRequest()
      fetch POST /api/activities  →  on ANY throw: offline-queue.ts:33 enqueue
  ↓
src/app/api/activities/route.ts:147 POST
      :174 resolveScoringBodyweightKg      (bodyweight.ts)
      :179 observed max HR   →  :187 resolveEffectiveMaxHr  →  :192 scoringProfile
      :224 workout_scores  ×50            (load window)
      :231 workout_scores  ×10 same sport (sport comparison)
      :243 activities+workout_scores ×20  (index window)
      :273 fetchCurrentTemperatureCelsius (weather, 3s abort)  ← WRITTEN, NOT SCORED
      :285 INSERT activities
      :352 insertGymExercises              (gym-exercise-rows.ts)
      :380 split_index_history ×30
      :441 predicted_benchmarks + 90-day window  →  Tier-1/Tier-2 blend
      :575 scoreActivity(...)
  ↓
src/lib/scoring/service.ts:118 scoreActivity()
      :127 assertScoringInput           (input-guards.ts)
      :141 scoreActivityWithEngines
  ↓
src/lib/scoring/activity-scorer.ts:466 scoreActivityWithEngines()
      :488 scoreGymSession   → split-strength-engine.ts labIndex()      0–999
      :490 scoreEnduranceSession → cardio-activity.ts:1197 score        0–1000
      :502 buildActivityScores([current, ...20 recent])
      :503 computeIndexes(...)
  ↓
src/lib/scoring/index-engine.ts:56 sideIndex()   → :73 clamp(combined, 0, 1000)
      :83 computeIndexes()  → labIndex / engineIndex / splitIndex / headline
  ↓
src/app/api/activities/route.ts:632  INSERT workout_scores   (sport_index ≤ 999 CHECK)
                             :671  INSERT split_index_history (split_index ≤ 999 CHECK)
                             :696  INSERT strength_scores
                             :714  UPSERT predicted_benchmarks
  ↓
supabase/migrations/054  TRIGGER split_index_history_sync_profile
      → recomputes profiles.current_{split,endurance,strength}_index
        from the NEWEST surviving history row
  ↓
DISPLAY
  dashboard  (app)/dashboard/page.tsx:511    computeIndexes(...) RECOMPUTED LIVE
  Engine     (app)/cardio/page.tsx:57        latestIndex.endurance_index   STORED
  Lab        (app)/gym/page.tsx:81           latestIndex.strength_index    STORED
  Analytics  (app)/analytics/page.tsx:61     split_index_history           STORED
  Leaderboard lib/social/leaderboard.ts:132  profiles.current_split_index  STORED
  Friends    lib/social/queries.ts:420       profiles.current_split_index  STORED
  Rank       lib/retention/rank.ts:22        profiles.current_split_index  STORED
  → all rendered through lib/utils/format.ts:103 formatIndex() ÷10
```

### Where the shape drifts

**The same athlete's headline number is not the same on every surface.** The
dashboard is the only surface that recomputes; every other surface reads the
denormalised cache. The two agree only while nothing has changed since the
newest history row was written (D2 below).

**The 0–1000 → 0–100 rescale.** `formatIndex` is applied consistently on 40+ call
sites and I found no double-application. It is *missed* in exactly three places
(D3, D4, D5) and there is no place where it is applied twice. The internal
scale itself is well-marked: `scoreAccentClass` (gps-run/page.tsx:108),
`INDEX_MILESTONES` (retention/milestones.ts:1), `tierForScore` and `rank.ts`
all correctly work in 0–1000 and hand off to `formatIndex` at the edge.

**Create vs. recompute divergence.** Three different call sites build the
`scoreActivity` input and they do not agree (D6, and the `maxHeartRate` note in
Observations).

---

## Seam 2 — EDIT / MERGE / UNMERGE / DELETE → RESCORE

### The trace

```
EDIT     api/activities/[id]/route.ts:102 PATCH
           :173 UPDATE activities
           :224 read old gym_exercises → :230 DELETE → :232 re-INSERT (restores on failure)
           :275 scoreAndPersist(excludeActivityIds:[id], anchoredBodyweightKg)

MERGE    api/activities/merge/route.ts:77 POST
           :172 READ predicted_benchmarks.last_activity_id  ← BEFORE the delete
           :197 UPDATE survivor (snapshot kept for restore)
           :211 deleteAbsorbed → split_index_history, personal_records, activities
           :232 scoreAndPersist(exclude all legs, predictionBaseIsStale)

UNMERGE  api/activities/[id]/unmerge/route.ts:79 POST
           :134 restore survivor columns+metadata
           :144 re-INSERT absorbed legs under ORIGINAL ids
           :164 DELETE personal_records for the merged id
           :179 scoreAndPersist per leg, oldest-first, predictionBaseIsStale on leg 0

DELETE   api/activities/[id]/route.ts:383 DELETE
           :408 DELETE split_index_history
           :410 DELETE activities            ← and nothing else

RECOMPUTE lib/activities/recompute-user.ts:98
           full oldest-first replay; authoritative personal_records rebuild

  all →  lib/activities/score-and-persist.ts:95 scoreAndPersist()
           :451 DELETE workout_scores  → :454 INSERT
           :452 DELETE split_index_history → :499 INSERT
           :522 DELETE strength_scores → :523 INSERT
           :544 UPSERT predicted_benchmarks
           :576 upsertPersonalRecordsIfBetter
  all →  migration 054 trigger keeps profiles.current_*_index in step
```

### Does every mutation recompute everything that depended on the old value?

| | `workout_scores` | `split_index_history` | `strength_scores` | `profiles.current_*` (054) | `predicted_benchmarks` | `personal_records` |
| --- | --- | --- | --- | --- | --- | --- |
| Create | ✅ | ✅ | ✅ | ✅ trigger | ✅ | ✅ incremental |
| Edit | ✅ | ✅ | ✅ | ✅ trigger | ✅ (stale-base handled) | ✅ incremental |
| Merge | ✅ | ✅ | ✅ | ✅ trigger | ✅ (`predictionBaseIsStale`) | ✅ absorbed rows deleted |
| Unmerge | ✅ | ✅ | ✅ | ✅ trigger | ✅ (`predictionBaseIsStale`) | ✅ merged row deleted |
| **Delete** | ✅ cascade | ✅ explicit | ✅ cascade | ✅ trigger | ❌ **D7** | ❌ **D7** |
| Recompute | ✅ | ✅ | ✅ | ✅ trigger | ✅ | ✅ authoritative |

Migration 054 is correct and is the load-bearing piece here: because it
recomputes from the table rather than copying `NEW`, it is the only reason
delete/unmerge/back-dated-edit leave the profile cache honest. The `AFTER
INSERT OR UPDATE OR DELETE` trigger covers every path above.

The one row it cannot heal is the one nothing owns — D1.

---

## Seam 3 — DATABASE vs CODE

Checked mechanically and by hand:

- **Every column named in a `.select("…")` string across `src/` exists in a
  migration.** Zero misses.
- **Every key in an `.insert()` / `.update()` / `.upsert()` object exists as a
  column**, except `cardio_enrichment` and `predicted_benchmark_after_session`,
  which are JSONB sub-keys of `score_breakdown` — correct.
- **Every table has `ENABLE ROW LEVEL SECURITY`.** No table is unprotected.
- **Every RLS-enabled table has a policy**, except `hpe_rollout_audit`
  (041:71), which is deliberate and documented ("No policies: readable and
  writable only through the service role") and is only written by
  `api/hpe/admin/rollout/route.ts:46` via `createAdminClient()`. Correct.
- **Enums match TypeScript unions.** `sport_type` (001:8 + 021:14) ≡
  `SportType` (types/index.ts:1); `session_type` (001:13 + 015:14) ≡
  `SessionType`; `subscription_tier`/`gender_type` match.
- **Migration 053** (`profiles.injury_status`) is safe and self-consistent: nullable,
  no backfill, `NOT VALID` + `VALIDATE` to avoid an ACCESS EXCLUSIVE scan, closed
  vocabulary enforced at the DB edge. The code that reads/writes it is only the
  athlete's own profile control. No defect.
- **Migration 054** is correct in substance and in the `NULLS LAST` / `id DESC`
  ordering detail. No defect. Its one blind spot is that it does not distinguish a
  history row that belongs to an activity from one that does not — see D1.

**Unapplied-migration signals.** I cannot query the live database from here, but the
repo carries two standing admissions of past drift: `002b_apply_missing.sql`
(a full replay of 002 with `IF NOT EXISTS` everywhere) and
`051_social_feed_repair.sql` (a replay of 031's eight policies). More
pointedly, `lib/activities/gym-exercise-rows.ts:121 insertGymExercises()` exists
*solely* to survive a production database that is behind on migration 028 —
it retries the insert with the `attachment` column stripped and logs
`"gym_exercises is missing column(s)"`. That log line is the canary; it should be
checked before launch, and it carries a latent bug of its own (D11).

**The DB caps scores at 999; the code clamps to 1000.** See D8.

---

## Seam 4 — NATIVE BRIDGE

### The trace (widget)

```
(app)/dashboard/page.tsx:314  strengthPayload  ← overallDotsGl (best-ever 1RM, kg)
                        :355  raceLadder = riegelPredictions(5000, predicted5k, k)
                        :365  racePredictionPayload : SplitIndexWidgetPayload
  ↓ (server component → client)
src/lib/native/race-predictions-sync.tsx:26  RacePredictionsSync
      JSON.stringify keying → publishRacePredictions()
  ↓
src/lib/native/race-predictions.ts:154  publishRacePredictions()
      isRacePredictionWidgetSupported()  → iOS only, else {published:false,"unsupported"}
      RacePredictions.set(payload)
  ↓  Capacitor bridge
ios/App/App/RacePredictionsPlugin.swift:47  set()
      :53  entry(from: getObject("headline"))   → nil unless finite & >0
      :61  (getArray("ladder") as? [JSObject])  ← see D12
      :71  strength(from: getObject("strength"))
  ↓
ios/App/SplitIndexWidgets/RacePredictionStore.swift:220  save()
      :183 containerIsReachable  (sandbox-level, not a same-process read-back)
      :160 storageKey "racePredictions.v1"
  ↓
ios/App/SplitIndexWidgets/RacePredictionWidget.swift  (extension reads only)
```

**The payload matches the reader, field for field.** Every TS field in
`SplitIndexWidgetPayload` (race-predictions.ts:69) has a Swift counterpart in
`RacePredictionSnapshot` (RacePredictionStore.swift:94), the status vocabularies
are identical (`ready`/`calibrating`/`noData`, and `ready`/`noData` for strength),
`strength` is optional on both sides for exactly the stated forward-compat reason,
and labels are passed rather than re-derived on both halves. `formatRacePrediction`
(RacePredictionStore.swift:250) is a faithful twin of `formatRiegelPrediction`
(scoring/presentation.ts:50), including the round-once-up-front rule. This seam is
in good shape.

### Degradation on web

Every native module gates before touching a plugin and every plugin call is
wrapped:

| Module | Guard | Failure |
| --- | --- | --- |
| `gps-tracking.ts` | `isNativePlatform()` :354 | try/catch :47, :173 |
| `heart-rate.ts` | `isNativePlatform()` :51 | try/catch :80, :85 |
| `airpods-heart-rate.ts` | `isNative && ios` :35 | throws by design, documented |
| `step-cadence.ts` | `isNative && ios` :26 | — |
| `live-activity.ts` | `isNative && ios` :87 | try/catch :95, :105, :114, :133 |
| `daily-training.ts` | `isNative && ios` :107 | try/catch :140, :160, :174 |
| `race-predictions.ts` | `isNative && ios` :125 | typed failure reason :129 |
| `billing.ts` | `isNativePlatform()` :36 | try/catch :79, :105 |
| `oauth.ts` | `isNativePlatform()` :37 → no-op | — |
| `pm5-monitor.ts` | `isNativePlatform()` :87 | try/catch :125, :131 |

No web build path can reach a Capacitor plugin. Android has no widget/Live
Activity equivalent and is correctly excluded by the `getNativePlatform() === "ios"`
guards rather than by `isNativePlatform()` alone.

---

## Seam 5 — THIRD PARTY

| Integration | Timeout | 4xx | 5xx | Malformed | Verdict |
| --- | --- | --- | --- | --- | --- |
| **Weather** `lib/weather/fetch-temperature.ts` | 3s `AbortController` | `!res.ok → null` | same | `typeof temp === "number"` | ✅ exemplary — but the result is then dropped, D6 |
| **External** `lib/external/open-meteo.ts` | `fetchWithTimeout` :17 | `→ null` :43 | same | try/catch :54, :84 | ✅ |
| **Supabase SSR** `lib/supabase/{server,proxy}.ts` | none | — | — | — | ✅ standard `@supabase/ssr`; proxy catches and fails open (D13) |
| **OpenAI** `lib/openai/coach.ts:71` | **none** | caught | caught | caught | ⚠️ falls back correctly but can hang the request — **D9** |
| **Stripe** `api/stripe/webhook/route.ts` | n/a | sig verified :31 | — | **unchecked writes** | ❌ **D14, D15** |
| **RevenueCat** `api/revenuecat/webhook/route.ts` | n/a | secret checked :51 | — | **unchecked writes** | ❌ **D16** |

### Unguarded `await`s that would 500 a page or a route

I traced every `await` on the request-critical paths. The ones that can reject:

- `await request.json()` in **every** API route (e.g. `api/activities/route.ts:162`,
  `merge/route.ts:87`, `goals/route.ts:34`). A malformed body throws before any
  try/catch → unhandled → 500 with a stack, not a 400. Cosmetic on a first-party
  client, ugly on a replayed/queued request.
- `api/activities/route.ts:839 generateCoachFeedback(...)` — internally caught, but
  see D9 for the latency, not the error.
- Everything else on the write paths reads its `error` and either rolls back
  (`failAndRollback` :129) or reports (`noteWrite` :443 in recompute). This part of
  the codebase is unusually careful and I found no *silent* swallowed write error
  on the activity paths — the failures are all in the two billing webhooks.

---

# Defects — severity ordered

---

## D1 — CRITICAL — The onboarding calibration row is an orphan that can pin an athlete's public index forever

**`src/app/api/onboarding/calibrate/route.ts:267-275`**

```ts
const { error: historyError } = await supabase.from("split_index_history").insert({
  user_id: user.id,
  split_index: lastResult.splitIndex,
  ...
  activity_id: null,          // ← no owner
});                            // ← no recorded_at, so DEFAULT NOW() (001:154)
```

Three things collide here.

1. `activity_id` is `null`, so **no mutation path can ever remove this row.**
   `recompute-user.ts:486` deletes by `activity_id`; `[id]/route.ts:408` deletes by
   `activity_id`; `merge/route.ts:310` deletes by `activity_id`. The full
   authoritative rebuild (`recomputeUser`) rebuilds every *activity's* row and leaves
   this one untouched and unrecomputed, forever.
2. `recorded_at` defaults to `NOW()` — signup time. Every other writer deliberately
   stamps the **activity's own date** (`route.ts:685`, `score-and-persist.ts:510`,
   `recompute-user.ts:507`, each with a comment explaining why).
3. Migration 054's trigger picks `ORDER BY recorded_at DESC NULLS LAST` and copies
   that row onto `profiles.current_split_index`.

**Failure scenario.** An athlete signs up on 1 March, types a 5 k time and an SBD
into onboarding, and gets a calibration row stamped 1 March with, say, index 640.
They then import or back-log three months of real training from December–February.
Every one of those sessions gets `recorded_at` in the past, so **the 1 March
onboarding guess remains the newest row.** `profiles.current_split_index` stays at
640. Their Lab page, Engine page, leaderboard position, rank badge, friends list,
duels and squad standing all read 640 — a number derived from two numbers they
typed into a signup form — while the dashboard hero (which recomputes, Seam 1)
shows their real 780. Nothing they can do in the app clears it short of logging a
session dated after signup. This is also precisely the orphan-history-row shape
that `merge/route.ts:39-44` explicitly guards against ("a row with a null
activity_id that no longer belongs to any session, cannot be recomputed away …
so it goes on bending every Split Index trend line forever") — the guard exists
on the merge path and the row is created on the onboarding path.

---

## D2 — HIGH — The dashboard hero disagrees with every other surface, by construction

**`src/app/(app)/dashboard/page.tsx:511-526`** vs **`(app)/gym/page.tsx:81`,
`(app)/cardio/page.tsx:57`, `lib/social/leaderboard.ts:132`,
`lib/social/queries.ts:420`, `lib/retention/rank.ts:22`**

```ts
// dashboard — RECOMPUTED from the current 20 most recent activities
const liveIndexes = indexActivityRows.length >= 1
  ? computeIndexes(buildActivityScores(indexActivityRows), athleteProfile, weightLab)
  : null;
const headlineValue = liveIndexes?.headline ?? current.split_index;
```

```ts
// Lab page — STORED, from the newest split_index_history row
const strengthIndex = latestIndex?.strength_index ?? null;
```

The stored value was computed **at the time that one session was scored**, over
the 20 activities that existed *then*. The dashboard recomputes over the 20 that
exist *now*. Those are different inputs whenever the activity set has moved since
the newest history row was written — and the write paths deliberately only rewrite
the *edited* session's history row, never the newest one.

**Failure scenario.** Athlete logs a run on Friday → history row 700, profile 700,
dashboard 70.0, Lab 70.0, leaderboard 70.0. On Saturday they open last Tuesday's
gym session and fix a typo in the weight. `scoreAndPersist` rewrites **Tuesday's**
history row; the 054 trigger recomputes the profile cache from the newest row,
which is still Friday's 700. But the dashboard's live 20-activity window now
contains the corrected gym score, so the hero renders 71.5. The athlete now sees
**71.5 on the home page and 70.0 on the Lab page, the Engine page, Analytics, their
own social profile, the leaderboard and their friends' lists** — same athlete, same
second, six surfaces, two numbers. The dashboard's own comment block (:527-563)
documents that this contradiction was *partially* closed for the rank badge; the
underlying two-sources-of-truth split is still open.

---

## D3 — HIGH — Goals are entered on the 0–1000 scale and displayed on the 0–100 scale

**`src/components/dashboard/goals-card.tsx:62-71`, `:207`, `:367`, `:437`** and
**`src/app/api/goals/route.ts:4-5`, `:53`**

```tsx
// goals-card.tsx:62 — the input, on the RAW scale
<Input label="Target index" type="number" min={350} max={999}
       value={target} placeholder="e.g. 700" />
```
```tsx
// goals-card.tsx:58 — the goal-title placeholder, on the RAW scale
placeholder="e.g. Break a 700 Split Index"
```
```tsx
// goals-card.tsx:367 — the progress readout, RESCALED
{formatIndex(currentIndex)} / {formatIndex(target)}
```
```ts
// api/goals/route.ts:53 — the auto-generated title, stored, on the RAW scale
: `Reach Split Index ${Math.round(targetSplitIndex)}`;
```

**Failure scenario.** The athlete's hero reads **70.1**. They tap "Add goal" and
are shown a field whose suggested value is `725` and whose placeholder is `700` —
numbers ten times anything the app has ever shown them. If they type the obvious
`75`, `api/goals/route.ts:37` rejects it with *"Target must be between 350 and
999"*, an error message about a scale that exists nowhere in the UI. If they
accept the suggestion, the goal is stored as 725 and the card then renders two
contradictory numbers side by side: the stored title **"Reach Split Index 725"**
and, immediately beneath it, the progress line **"70.1 / 72.5"**. This is the one
place in the app where `formatIndex`'s boundary is crossed in the *input*
direction and nothing does the ×10.

---

## D4 — HIGH — The live GPS run screen shows scores ten times larger than the saved activity

**`src/app/(app)/cardio/gps-run/page.tsx:871` and `:1257`**

```tsx
<p className={`text-xs font-bold tabular-nums ${scoreAccentClass(entry.score)}`}>
  {Math.round(entry.score)}
</p>
```

`entry.score` comes from `livePredictionLadder` →
`timeToScore(benchmarkSport, seconds, sex)` (`cardio-activity.ts:587`), which
returns the internal 0–1000 value (`cardio-benchmarks.ts:297 clampScore` →
`0…1000`). Every other surface in the app renders that scale through
`formatIndex`. Here it is rendered raw. The sibling `scoreAccentClass`
(`gps-run/page.tsx:108`) *is* correctly written against 0–1000 thresholds
(850/725/475), which confirms the value's scale and isolates the bug to the
rendered number.

**Failure scenario.** Athlete starts a tracked run. Mid-run, the predicted-score
strip shows their projected 5 K as **"742"**. They stop, and the review screen
(:1257) shows **"742"** again. They save, and the success screen
(`activities/success-screen.tsx:150`) shows **"74.2"**, as does the activity detail
page and the logbook row. The athlete has no way to know these are the same number
— the most likely reading is that saving cost them 668 points.

---

## D5 — MEDIUM-HIGH — Data export hands the athlete un-rescaled scores with no unit

**`src/app/api/export/activities/route.ts:85`**

```ts
sport_index: ws?.sport_index ?? null,
```

The CSV/JSON export writes the raw 0–1000 column. Every UI surface the athlete has
ever seen shows 0–100, and no column header or accompanying note says the exported
scale is different.

**Failure scenario.** A premium athlete exports 18 months of training to build
their own chart, plots `sport_index`, and gets a series running 400–900 against a
memory of scores running 40–90. There is nothing in the file to tell them which is
right, and the natural conclusion — that the app's displayed number is a
tenth-scaled approximation — is wrong in the other direction.

---

## D6 — MEDIUM-HIGH — Auto-fetched weather is stored but never scored, so a GPS run's score changes the first time it is recomputed

**`src/app/api/activities/route.ts:273-281` vs `:529` and `:585`**

```ts
let temperatureCelsius = body.temperature_celsius;
if (temperatureCelsius === undefined && typeof body.start_latitude === "number" && ...) {
  temperatureCelsius = (await fetchCurrentTemperatureCelsius(...)) ?? undefined;   // :280
}
...
.insert({ ..., temperature_celsius: temperatureCelsius, ... })                     // :302  ← STORED
...
  thisSessionEF: terrainAdjustedSessionEF(..., body.temperature_celsius),          // :529  ← NOT the fetched one
...
  temperatureCelsius: body.temperature_celsius,                                     // :585  ← NOT the fetched one
```

The fetched temperature lands in the local `temperatureCelsius` and is persisted,
but both scoring inputs read `body.temperature_celsius`, which is `undefined` for
every GPS-tracked session (that is the whole reason the fetch ran).

Meanwhile `recompute-user.ts:340` and `:395` read `activity.temperature_celsius`
— the *stored* value — and `score-and-persist.ts:361` and `:417` read
`body.temperature_celsius`, which on an edit is repopulated from the stored row.

**Failure scenario.** An athlete runs 10 K at −3 °C. The activity is saved with
`temperature_celsius = -3`, but scored as if the temperature were unknown, so
`temperatureDifficultyBonus` contributes nothing and the harsh-conditions credit
(`cardio-activity.ts:1183`, flag `harsh-conditions-credit`) never fires. The
activity detail page shows "−3 °C" next to a score that does not account for it.
Weeks later a calibration change triggers a recompute — or the athlete simply
opens and re-saves the session — and the same run now scores *higher*, with a
"harsh conditions" credit that appeared from nowhere. Neither the athlete nor the
logs can attribute the move to anything they did.

---

## D7 — MEDIUM-HIGH — Deleting an activity leaves its personal record and its race-prediction evidence behind

**`src/app/api/activities/[id]/route.ts:383-416`**

```ts
await supabase.from("split_index_history").delete().eq("activity_id", id);
const { error } = await supabase.from("activities").delete().eq("id", id);
```

That is the whole handler. Two children are `ON DELETE SET NULL`, not `CASCADE`:

- `personal_records.activity_id` (`001:167`)
- `predicted_benchmarks.last_activity_id` (`011:18`)

The merge path deletes the first explicitly (`merge/route.ts:317`) *and* reads the
second before deleting so it can pass `predictionBaseIsStale`
(`merge/route.ts:172-181`) — with a 12-line comment explaining why both are
necessary. The unmerge path does the same (`unmerge/route.ts:164`, `:195`). The
plain delete path does neither.

**Failure scenario A (records).** An athlete accidentally logs a 5 K as a 50 K,
sees a bogus "fastest 5 K" PR appear, and deletes the session. The activity is
gone from the logbook; the PR row survives with `activity_id = NULL`, still shown
on their profile, no longer linked to anything they can open, and unbeatable
because it describes a run that never happened. Only a full
`POST /api/activities/recompute` clears it (`recompute-user.ts:629` is the
authoritative rebuild).

**Failure scenario B (predictions).** An athlete deletes their fastest run.
`predicted_benchmarks.benchmark_seconds` still contains that run's evidence, and
the `last_activity_id` link that would have revealed it has just been set to NULL
by the FK. Every subsequent session blends into a base that includes a deleted
session, and nothing can detect it — this is the exact failure
`ScoreAndPersistOptions.predictionBaseIsStale` was built for
(`score-and-persist.ts:74-92`, "the bug that turned a real 18:25 5 k into a
displayed 24:59"), reachable through the one path that does not use it.

---

## D8 — MEDIUM — The code clamps scores to 1000; every score column rejects anything above 999

**`src/lib/scoring/cardio-activity.ts:1197-1198`** and
**`src/lib/scoring/index-engine.ts:73`** vs
**`001:132`, `001:147`, `002:182-184`**

```ts
// cardio-activity.ts:1197
score: Math.round(clamp(paceScore, 0, 1000)),
paceScore: Math.round(clamp(paceScore, 0, 1000)),
```
```ts
// index-engine.ts:73
return Math.round(clamp(combined, 0, 1000));
```
```sql
-- 001:132
sport_index INTEGER NOT NULL CHECK (sport_index >= 0 AND sport_index <= 999),
-- 001:147
split_index INTEGER NOT NULL CHECK (split_index >= 0 AND split_index <= 999),
-- 002:148-150
current_split_index INTEGER CHECK (current_split_index >= 0 AND current_split_index <= 999),
```

`scoring/constants.ts:14` declares `MAX_INDEX = 999` and it is applied throughout
`engine.ts`, `strength/mapping.ts`, `input-guards.ts`, `composite.ts` and
`premium/projection.ts` — but **not** on the cardio path or in the index
aggregator, the two values that are actually persisted. `cardio-benchmarks.ts:361`
caps the anchor lookup at 998/999, but `paceScore` then accumulates the
fitness-ceiling bonus, easy-effort floor and relative-effort adjustments before the
`clamp(…, 0, 1000)`.

**Failure scenario.** A near-world-record cardio session earning any bonus produces
`sport_index = 1000`. `POST /api/activities:632` fails the CHECK; the route treats
that as fatal and calls `failAndRollback` (:668) — the athlete's best-ever session
is *deleted* and they are told "We could not save this workout. Nothing was
recorded." On the edit path (`score-and-persist.ts:491`) the same violation only
logs, leaving the session permanently unscored. Rare, but the failure is total and
lands on exactly the athlete least likely to accept it. Worse: the two write paths
disagree about whether it is fatal.

---

## D9 — MEDIUM — An OpenAI stall can time out the save *after* the workout is committed, and the client will then queue a duplicate

**`src/lib/openai/client.ts:8`**, **`src/lib/openai/coach.ts:115`**,
**`src/app/api/activities/route.ts:839`**, **`vercel.json`**

```ts
// client.ts:8 — no timeout, no maxRetries override
_openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```
```ts
// route.ts:839 — runs AFTER every DB write has committed
const coachOutput = await generateCoachFeedback(coachInput, { useOpenAI: true });
```

The OpenAI SDK's defaults are a 10-minute timeout and 2 retries. `vercel.json`
declares no `maxDuration`, so the function dies at the platform default long
before the SDK gives up. By line 839 the activity, `workout_scores`,
`split_index_history`, `strength_scores`, `predicted_benchmarks` and
`personal_records` rows are all committed.

**Failure scenario.** OpenAI is slow. The function is killed mid-`await`. No
response reaches the browser, so `submit-activity.ts:28` catches a `TypeError`,
`isNetworkFailure` (`offline-queue.ts:85`) returns `true` for it, and the payload
is **enqueued for retry** — of a request that already succeeded. The athlete is
told *"You're offline — workout saved on this device and will sync when you're back
online."* On the next `online` event or page load
(`components/providers/client-bootstrap.tsx:18`, `:23`) the queue flushes and
`POST /api/activities` runs a second time. There is no idempotency key on that
route. **The athlete now has the same session logged twice**, double-counted in
their load window, their ACWR, their injury-risk model and their index. The
try/catch inside `generateCoachFeedback` (`coach.ts:71`) correctly handles OpenAI
*failing*; nothing handles it being *slow*.

---

## D10 — MEDIUM — The offline queue can double-post, retries permanent failures forever, and can throw away the workout it was meant to save

**`src/lib/activities/offline-queue.ts:24`, `:49-79`** and
**`src/components/providers/client-bootstrap.tsx:17-24`**

Three distinct problems in one file:

```ts
// :24 — unguarded, unlike readQueue's try/catch on :14
function writeQueue(items: QueuedActivitySubmit[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));   // can throw QuotaExceededError
}
```
`enqueueActivitySubmit` is called from *inside* the catch block of
`submitActivityRequest` (`submit-activity.ts:30`). A `QuotaExceededError` there —
Safari private mode, or a gym session with a long `set_details` payload on a nearly
full origin — escapes the function entirely as an unhandled rejection. The one
code path whose whole job is not to lose an offline workout loses it silently.

```ts
// :63-79 — no in-flight guard, no attempt counter
for (const item of queue) { ...await fetch... }
```
`flushActivityQueue` is invoked on mount *and* on every `online` event
(`client-bootstrap.tsx:18`, `:23`) with no re-entrancy guard. A flaky connection
that fires `online` while the mount flush is still awaiting a slow POST runs both
loops over the same `readQueue()` snapshot — **the same session is posted twice.**

Finally, a queued item rejected with a permanent 400 (a plausibility guard in
`assertScoringInput`) hits `failed += 1; continue` (:71-72) and is **never
removed.** It is re-POSTed on every reconnect for the life of the browser profile,
and `getPendingActivityCount` (:29) drives a badge that can never reach zero.

---

## D11 — MEDIUM — `insertGymExercises` returns success after exhausting its retries without inserting anything

**`src/lib/activities/gym-exercise-rows.ts:130-146`**

```ts
for (let attempt = 0; attempt <= DEGRADABLE_COLUMNS.length; attempt++) {
  const { error } = await supabase.from("gym_exercises").insert(payload);
  if (!error) return { error: null, droppedColumns };
  ...
}
return { error: null, droppedColumns };   // ← :146, loop exhausted, nothing inserted
```

The fall-through after the loop reports **success**. With today's single
`DEGRADABLE_COLUMNS = ["attachment"]` this line is unreachable (the second
iteration's `missingColumn(error, [])` returns null and takes the `return { error }`
branch on :136). The moment a second degradable column is added — which is exactly
what this list is designed to accommodate — a database missing both columns makes
the loop exhaust and return `error: null`.

**Failure scenario.** `POST /api/activities:366` sees no error, skips
`failAndRollback`, and the athlete gets a success screen for a gym session with
**zero exercises**. The session then scores off nothing, which is the precise shape
of the recurring "logged a gym exercise and the strength score is missing"
report that the rest of this file was written to eliminate. The fix is one line:
`:146` should return the last error.

---

## D12 — LOW-MEDIUM — The widget's ladder uses the exact array cast the same file forbids twelve lines later

**`ios/App/App/RacePredictionsPlugin.swift:61`** vs **`:149-156`**

```swift
// :61 — the race ladder
let ladder = (call.getArray("ladder") as? [JSObject] ?? [])
    .compactMap { Self.entry(from: $0) }
```
```swift
// :149-156 — the strength lifts, with the comment explaining why NOT to do the above
// Read the nested array as plain Foundation types rather than
// `[JSObject]`. A failed bridge here would produce zero lifts, which
// this function would then honestly report as "never lifted" — a
// silent wrong empty state, which is the exact bug class this whole
// widget has already been burned by once. `[Any]` / `[String: Any]`
// is a cast that cannot fail on anything the WebView can send.
let rawLifts = object["lifts"] as? [Any] ?? []
let lifts = rawLifts.compactMap { lift(from: $0 as? [String: Any]) }
```

Same nested-array problem, opposite treatment, in the same function's file. If the
`[JSObject]` cast ever fails on a future Capacitor version, `ladder` silently
becomes `[]`.

**Failure scenario.** The medium home-screen widget loses its 10 K and Half rungs
while the 5 K headline (read via `getObject`, a different code path) keeps working.
Nothing logs, nothing degrades visibly to a developer, and the athlete just sees a
widget that has quietly become the small one. Low likelihood, but the file's own
author already decided this cast is not acceptable.

---

## D13 — LOW-MEDIUM — The proxy's route allow-list is missing four `(app)` route groups and fails open

**`src/lib/supabase/proxy.ts:39-50`, `:62-64`**

```ts
const isAppRoute =
  pathname.startsWith("/dashboard") || .../onboarding/ .../activities/
  .../analytics/ .../gym/ .../cardio/ .../social/ .../settings/ .../profile/;
```

Missing: `/hybrid-plan`, `/hybrid-plan/intake`, `/hybrid-plan/monitoring`,
`/interference`, `/reports`, `/admin`, `/admin/hpe-fleet`.

```ts
} catch (error) {
  console.error("[proxy] Supabase session update failed:", error);
}
return supabaseResponse;   // ← unauthenticated request proceeds
```

**Assessed as low because I verified the second line of defence holds**: every one
of those pages calls `supabase.auth.getUser()` and `redirect("/login")` itself
(`hybrid-plan/page.tsx:19`, `interference/page.tsx:16`, `reports/page.tsx:14`,
`hybrid-plan/intake/page.tsx:12`, `hybrid-plan/monitoring/page.tsx:12`,
`admin/hpe-fleet/page.tsx:19`, which additionally checks `resolveAdminRole`). Next.js'
own docs (`node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`)
explicitly say proxy "should not be used as a full session management or
authorization solution", so the architecture is right. What is wrong is that the
list is a hand-maintained enumeration that has already fallen four routes behind
the router — the next new route under `(app)` will be added the same way, and the
page-level guard is the only thing standing behind it.

---

## D14 — HIGH — Stripe writes `unpaid` / `paused` / `incomplete_expired` into an enum that rejects them, and answers 200 anyway

**`src/app/api/stripe/webhook/route.ts:49`** vs **`supabase/migrations/001_initial_schema.sql:38`**

```ts
subscription_status: subscription.status as "active" | "trialing",   // ← a lie, not a narrowing
```
```sql
CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete'
);
```

Stripe's `Subscription.status` is `trialing | active | past_due | canceled |
unpaid | incomplete | incomplete_expired | paused`. Three of those eight
(`unpaid`, `incomplete_expired`, `paused`) have no enum member. The blind `as`
cast makes TypeScript agree that they cannot occur, so `tsc --noEmit` passes.

Postgres rejects the UPDATE with `22P02 invalid input value for enum
subscription_status`. **The result is never read** (:45, :62, :83) and the handler
returns `{ received: true }` (:97).

**Failure scenario.** A subscriber's card fails. Stripe dunning runs, exhausts,
and moves the subscription to `unpaid`. The webhook fires
`customer.subscription.updated`, the UPDATE is rejected by the enum, the error is
discarded, Stripe receives **200** and never retries. `profiles.subscription_tier`
stays `premium` and `subscription_status` stays `active`, so
`isPremiumUser` (`lib/retention/trial.ts:23`) keeps returning true. **The user
retains full premium access indefinitely without paying**, and there is no log
line, no alert, and no reconciliation job to find them.

---

## D15 — HIGH — Every Stripe profile write is unchecked, so a transient Supabase failure silently loses a paid upgrade

**`src/app/api/stripe/webhook/route.ts:45`, `:62`, `:83`** — none of the three
`.update()` calls reads its `error`; **`:97`** returns 200 unconditionally.

**Failure scenario.** A customer completes checkout. Stripe delivers
`checkout.session.completed`. Supabase is briefly unavailable (or the connection
is reset mid-request). The update fails, the error is discarded, and Stripe is
told **200 — delivered**. Stripe's retry ladder never engages, because from
Stripe's point of view nothing went wrong. The customer has been charged and their
profile still says `free`. Recovery requires someone to notice and hand-repair
the row; the app has no signal that it happened.

Two secondary problems in the same handler:
- **No event-ordering or idempotency guard.** Stripe delivers at-least-once and
  does not guarantee order. A `customer.subscription.updated` delayed behind a
  `customer.subscription.deleted` will resurrect a cancelled subscription to
  `premium`. There is no `stripe_events` dedupe table and no comparison of
  `event.created` against a stored watermark.
- **Silent no-op on missing metadata.** Every branch is gated on
  `subscription.metadata.supabase_user_id` (:41, :59, :80). A subscription created
  or modified from the Stripe dashboard, or one whose metadata is dropped by a
  plan-change flow, matches no branch and is discarded without a log.

---

## D16 — MEDIUM-HIGH — RevenueCat's writes are equally unchecked, and a non-UUID `app_user_id` is a silent no-op

**`src/app/api/revenuecat/webhook/route.ts:73`, `:86`, `:102`**

```ts
await admin.from("profiles").update({ subscription_tier: "premium", ... })
  .eq("user_id", userId);          // ← result discarded
...
return NextResponse.json({ received: true });   // ← always 200
```

Same shape as D15, with an extra failure mode: `event.app_user_id` (:69) is fed
straight into `.eq("user_id", …)` against a `uuid` column. RevenueCat sends
`$RCAnonymousID:…` for a user who has not yet been identified, which Postgres
rejects with `22P02 invalid input syntax for type uuid`. Discarded; 200 returned;
RevenueCat never retries.

**Failure scenario.** An athlete buys the annual plan in the iOS app before the
RevenueCat SDK has aliased their anonymous id to their Supabase id (a real race
on first launch — see `lib/native/billing.ts:36`, where `configureBilling` is
keyed on `configuredForUserId`). The `INITIAL_PURCHASE` webhook carries the
anonymous id, the update matches nothing (or errors), RevenueCat is told 200, and
the athlete is charged with no premium entitlement — and no retry will ever fix it.

Two more, lower:
- **No `TRANSFER` handling** (:97 lists it as a deliberate no-op). When an
  entitlement transfers between `app_user_id`s, the *old* profile keeps
  `subscription_tier = premium` forever.
- **`/api/revenuecat/webhook` is not exempt from the rate limiter.**
  `src/proxy.ts:11` exempts `/api/stripe/webhook` and `/api/cron` but not this
  route, so a burst of >60 RevenueCat events per minute from RevenueCat's egress
  IP is 429'd (`proxy.ts:44`). RevenueCat does retry on 429, so this degrades
  rather than loses — but the omission is clearly unintentional.

---

## D17 — MEDIUM — `/api/cron/leaderboard` exists, is complete, and is never scheduled

**`vercel.json`** vs **`src/app/api/cron/leaderboard/route.ts`**

```json
"crons": [ { "path": "/api/cron/hybrid-reports", "schedule": "0 7 1 * *" } ]
```

That is the entire cron list. `api/cron/leaderboard/route.ts` — 107 lines that
compute weekly/monthly/all-time ranks and `previous_rank` into
`leaderboard_entries` — has no schedule entry and is therefore never invoked in
production.

`lib/social/leaderboard.ts:295` and `:373` both guard with
`if (entries && entries.length > 0)` and fall back to a live query over
`profiles`, so the leaderboard *works*. What silently does not work:

**Failure scenario.** `leaderboard_entries` stays permanently empty. The
weekly, monthly and all-time leaderboards all render the identical live
`current_split_index` ordering — the period selector changes nothing. The
rank-movement indicator (`previousRank`, `leaderboard.ts:136`) is always `null`,
so the up/down arrows that make a leaderboard feel alive never appear for anyone.
The failure is invisible because the fallback is well written.

---

## D18 — LOW — `createAdminClient` is defined twice

**`src/app/api/stripe/webhook/route.ts:7-12`** duplicates
**`src/lib/supabase/admin.ts:3`**, which every other service-role caller imports
(`cron/leaderboard:2`, `cron/hybrid-reports:2`, `revenuecat/webhook:2`,
`hpe/admin/fleet:3`, `hpe/admin/rollout:3`, `ensure-profile:2`). The two are
currently identical, which is exactly why the next change to the shared one — an
`auth: { persistSession: false }`, a schema pin, a fetch wrapper — will apply to
every service-role path except the payment webhook.

---

# Observations that are not defects

- **Migration 054 is the strongest piece of work in this codebase's seams.**
  Recomputing from the table rather than copying `NEW`, covering
  `INSERT OR UPDATE OR DELETE`, `NULLS LAST` on a nullable `recorded_at`, and the
  idempotent re-sync at the end — it is correct in substance and in every detail I
  could find a way to break. D1 is not a fault in the trigger; it is a row the
  trigger is asked to trust that nothing owns.
- **Migration 053 is clean.** The lock-avoiding `NOT VALID` + `VALIDATE` split, the
  closed vocabulary at the DB edge, and the explicit refusal to let the Hybrid
  Plan's injury input write this column are all correct, and the code honours it —
  I found no writer other than the athlete's own profile control.
- **The activity write paths are unusually disciplined.** `failAndRollback`
  (`route.ts:129`), the delete-before-insert error surfacing in
  `score-and-persist.ts:491`, `noteWrite`/`noteRebuild` in `recompute-user.ts:443`
  and `:610`, and the merge route's restore-on-delete-failure are all real
  compensating logic with the reasoning written down. The silent-write-failure bug
  class has been genuinely eliminated *here* — which makes its survival in the two
  billing webhooks (D14–D16) the sharper contrast.
- **`max_heart_rate` is passed to `scoreActivity` by the edit path
  (`score-and-persist.ts:412`) and by recompute (`recompute-user.ts:391`) but not
  by create (`route.ts:576-608`).** Harmless today: `service.ts` uses it only for
  `assertScoringInput`, and it never reaches `scoreActivityWithEngines`. Worth
  knowing before anyone makes it score-bearing.
- **Recompute derives `effectiveMaxHr` once from *every* session
  (`recompute-user.ts:152-156`), including ones logged after the activity being
  scored.** Create uses only what was known at the time. This is a deliberate,
  commented choice, but it does mean a recompute legitimately moves historical
  scores.
- `workout_scores.activity_id` is `UNIQUE` (`001:129`), so the "TWO score rows"
  scenario in `recompute-user.ts:449-451` cannot actually occur — the second insert
  would be rejected, which the code already handles. The comment overstates the
  risk; the guard is still right.

---

# Fix order

1. **D1** — stamp the calibration row with a sentinel `recorded_at`, or exclude
   `activity_id IS NULL` rows from the 054 trigger's `SELECT`. One athlete's
   public number is currently pinnable by an act as ordinary as backfilling.
2. **D14 / D15 / D16** — check the webhook write results, return non-2xx on
   failure so the provider retries, widen the `subscription_status` enum to
   Stripe's full vocabulary, and add event-id idempotency. This is money.
3. **D9 / D10** — put a timeout on the OpenAI client (or move coach generation off
   the request path entirely), add an idempotency key to `POST /api/activities`,
   and add an in-flight guard plus an attempt cap to the offline queue.
4. **D2** — pick one source of truth for the headline index. Either the dashboard
   reads the stored cache like every other surface, or the write path recomputes
   the newest row on every mutation.
5. **D3 / D4 / D5** — three missing `formatIndex` boundaries. Cheap, and each is
   directly visible to the athlete.
6. **D7 / D6 / D8** — the delete path's missing cleanup, the dropped weather value,
   and the 999/1000 clamp mismatch.
7. **D11 / D12 / D13 / D17 / D18** — latent traps and one unscheduled cron.
