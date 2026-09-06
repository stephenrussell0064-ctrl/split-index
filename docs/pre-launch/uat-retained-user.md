# UAT — The Retained User

**Agent:** User acceptance test #2
**Date:** 2026-09-06
**Branch:** `hybrid-plan-engine`
**Persona:** Six months in. ~120 logged sessions, premium, a hybrid plan running, a handful
of friends, a race in eight weeks. Opens the app 5–10 times a week.
**Question under test:** not activation — *retention*. Does this app keep earning the open?

Everything below was traced through the real code paths. No source file was modified.

---

## Part 1 — A week in the life

### Monday, 06:10. The daily open.

`src/app/(app)/dashboard/page.tsx` runs eleven Supabase reads and renders, in order:

1. A one-line greeting — `Hi, {name} · Mon 6 Sep · Bias run or gym today — endurance needs attention`
2. `IndexHero` — Split Index, week trend, Engine/Lab halves, streak flame, `weeklySessions/4`
3. `TodaysSessionCard` — today's prescribed session from the stored hybrid plan
4. `RacePredictionStrip` (1500m→marathon) and `LiftPredictionStrip` (S/B/D predicted vs performed)
5. Below the fold: readiness, AI coach, interference radar, Engine/Lab trend, 8-week projection,
   next-rank / focus-week / goals, upcoming races, week-over-week, sport comparison, recent workouts.

This is a genuinely dense, well-ordered first screen. It is also, for this athlete, **nearly
identical every single morning**, and three of its numbers disagree with each other.

What actually changes day to day:
- The date string.
- `TodaysSessionCard`, if the plan has a different session today.
- `ReadinessCard` / `TodayCard`, which move with ACWR.
- `AICoachCard`, but only when a new activity was logged (`api/activities/route.ts:844` is the
  only writer of `ai_feedback`). On a rest day the coach is yesterday's advice with no date on it.
- The streak flame, on the day it breaks.

What does *not* change: the Split Index (moves a point or two per session), the race ladder
(a stored benchmark, updated on quality efforts), the lift strip (all-time bests — by month
six these are frozen for weeks at a time), the 8-week projection, the goals card, the rank.
Roughly 70% of the pixel area on this page is a constant for this user. The dashboard is
excellent as a *weekly* review surface and thin as a *daily* one.

**And it contradicts itself.** The hero shows `headlineValue` — `liveIndexes.headline`,
recomputed this request from the last 20 activities (`page.tsx:511–524`). But:

- `weeklyTrend` (`:433–436`) is `calculateTrend(current.split_index, weekAgo.split_index)` —
  computed from the *stored* history row, not the number displayed above it.
- `indexGap` / `weakerSide` (`:574–576`), which writes the greeting sentence and drives
  `FocusWeekCard`, reads `current.endurance_index / current.strength_index` — stored — while
  `EngineLabTrendCard` two blocks down is handed `displayEnduranceIndex / displayStrengthIndex`
  — live.
- `GoalsCard` (`:814`) is handed `current.split_index`; the hero shows `headlineValue`.
- The 8-week projection's "+N from today" (`:747`) subtracts `headlineValue` from a projection
  fitted on stored history.

The file already carries a long comment (`:527–563`) about closing exactly this class of bug for
the rank badge. The same fix was not applied to the trend, the greeting, the focus card or the
goals card. On one screen, this athlete can be told they are 712, that they moved +3 this week,
that their endurance is the weak side, and that their goal is 40 points away — where the +3, the
"endurance", and the 40 were each computed from a different number than the 712.

### Monday, 06:12. The plan.

They tap through to `/hybrid-plan`. `HybridPlanScreen` fetches `GET /api/hpe/plan`.

That GET **generates a whole new block, from scratch, on every page load**, and persists it
(`api/hpe/plan/route.ts:279–311` → `savePlan`). Three things follow:

1. **`buildMacrocycle` always starts at week 1.** `macrocycle.ts:137–142`:
   `volume = startingVolume * ONRAMP_START_MULTIPLIER` where `startingVolume` is the athlete's
   *current* weekly running minutes and the multiplier is `1.0`. Phases are then allocated across
   `goal.weeksOut`. There is no "which week of the block am I in" input anywhere in the engine.
   So this athlete, eight weeks from their race, opens the plan and is in **base, week 1**. Next
   Monday, seven weeks out, they open it and are in base, week 1 of a seven-week block. The
   `specific` and `peak` phases recede ahead of them like a horizon. They will reach the taper —
   because the taper is anchored to the event date — but they will never train a build week.
2. **`planStart` on the live path is `new Date()`.** `hybrid-plan-screen.tsx:194–198` only reads
   `data.storedPlan.generatedAt`, which the route populates *only on the paused branch*. So the
   calendar re-anchors to today on every visit. The dashboard card does the same by a different
   route: `todays-session-data.ts` anchors to `stored.generatedAt`, which is the newest
   `hpe_plans` row — written by the visit they just made.
3. **`hpe_plans` grows one row per page view.** `supersedePlans` only fires when
   `rerun.shouldRegenerate`, and `loadLatestStoredPlan` does not filter on `superseded_at`
   anyway. A user opening the plan daily for six months has ~180 plan rows and several thousand
   `hpe_sessions` rows.

### Tuesday. They do the session. Nothing happens.

There is no way to tell the app a prescribed session was done. `day-detail.tsx` and
`plan-view.tsx` have no complete/skip/log affordance. `todays-session-card.tsx` links to
`/hybrid-plan` and nothing else. `hpe_session_feedback` exists in migration 040, has RLS
policies letting users write it, and **has no writer in the entire codebase** — only two
read sites, both admin (`api/hpe/monitoring/route.ts`, `api/hpe/admin/fleet/route.ts`).

Consequences, all live:

- `generatePlan` is called from the route without `feedbackByWeek` (`route.ts:279`), so
  `autoregulate()` receives `[]` on every week of every plan and returns
  `{ volumeMultiplier: 1, triggered: false }`. **F16 autoregulation — the finding the assurance
  review called the difference between a plan and a document — never fires in production.**
- `applyLowCapacityDay` (F17) has zero call sites outside its test. The athlete cannot flag a
  bad day.
- `shouldRerunDiagnostic` has **zero call sites, including in tests**. (The four-weekly cadence
  is enforced elsewhere, via `evaluateRerun` in `persistence.ts:104`, so the loop does run — but
  the exported helper is dead and misleading.)
- The admin monitoring dashboard will report `sessionsLogged: 0`, `completionRate: null`, and a
  100% abandonment rate for every athlete, forever. The one instrument that would tell the team
  the plan isn't working reads zero by construction.

### Wednesday. They miss the session, or train outside the app.

Missing a session is invisible — nothing tracks it. What the engine *does* see, four weeks
later when `evaluateRerun` fires, is a lower `loggedWeeklyRunMinutes`, which lowers
`state.currentRunMinPerWeek`, which lowers week 1 of the next regenerated block. The plan
quietly ratchets *down* toward whatever the athlete has been doing, and can never ratchet up,
because the higher-volume weeks it prescribes are always in a future that is regenerated away.

Training outside the app is handled better than most of this: migration 050's
`trains_outside_app` flag makes the athlete's stated volume authoritative
(`intake.ts:562–575`). That is a genuinely thoughtful fix — but it is a one-time intake answer,
not something surfaced at the point the gap appears.

### Thursday. Analytics.

`/analytics` is the strongest long-arc surface: 365 days of index history, race records mined
all-time, all-time-best 1RMs per lift with confidence bands, HRV, DOTS/GL, predicted benchmarks.
Progress over months is genuinely legible here. Two problems:

- **Consistency is scored against a hardcoded `targetSessionsPerWeek: 4`**
  (`analytics/page.tsx:207`, and again as `weeklyTarget: 4` in `retention/streak-utils.ts:54`
  and as the `IndexHero` default). This athlete trains 5–10×/week. Their consistency score is
  pinned at 100% and their hero ring reads `8/4`. A goal you cannot fail is not a goal, and the
  intake already knows their real frequency.
- The ascending-order + row-limit pattern is a time bomb (see the projection bug below).
  `indexHistory` here is `limit(400)` ascending over 365 days; at 10 sessions/week this athlete
  crosses 400 rows inside a year, after which the chart silently ends months ago.

### Thursday, still. The 8-week projection is wrong for exactly this user.

`dashboard/page.tsx:181–186`:

```
.from("split_index_history").select("*").eq("user_id", ...)
.order("recorded_at", { ascending: true }).limit(90)
```

Ascending order with a limit returns the **oldest 90 rows**, not the newest. One row is written
per scored activity (`score-and-persist.ts:499`), so at ~120 sessions this athlete's
`fullHistory` stops around month four. `computeSplitIndexProjection` then takes `.slice(-14)`
of *that* — fitting the trend on data from months three-to-four and anchoring `lastValue` on a
months-old index. The card then renders `projection8Weeks - headlineValue` "from today", in red
when negative. **An improving athlete is shown an eight-week forecast below their current score,
in danger red, with no way to see why.** This bug is invisible below 90 sessions and switches on
permanently at 90 — i.e. it fires precisely at the retention boundary this test exists to probe.

### Saturday. Social.

Seven tabs. Behind "More" on the phone, along with Interference and Analytics.

| Tab | 0 other athletes | 1 friend | 5 friends | Verdict |
|---|---|---|---|---|
| **Feed** | Your own workouts, chronological | Yours + theirs, comments + 1–10 scoring | Genuinely alive | **The one that works.** Correct with zero friends by design. |
| **Squads** | "No squads yet" + create/join | A two-row table ranked by `current_split_index` | Six rows | Functional but static — it is a leaderboard of a stored column, refreshed by nothing, with no activity or event feed. |
| **Duels** | "Add a friend first" | Works — live `workout_scores` aggregation over the window | Works | Real mechanic, but no notification when a duel is sent, accepted, overtaken, or won. An ended duel just says "Ended". |
| **Friends** | Search/add | Fine | Fine | Fine. |
| **Challenges** | **Permanently empty** | Same | Same | See below. |
| **Leaderboards** | Widens bracket → standards percentile | Same | Same | Widening logic is good. Period tabs are fake — see below. |
| **Achievements** | **0/N, every badge greyed** | Same | Same | See below. |

Three of the seven are dead:

- **Challenges.** `fetchChallenges` reads `challenges WHERE is_global = true`. There is no
  create endpoint (`/api/challenges/[id]/join` is the only route), no admin UI, and no seed row
  in any migration. The tab reads "No active challenges right now / Check back soon for new
  events" for every user on day one and forever. And if a challenge *were* seeded,
  `challenge_participants.progress` is written by nothing — joining it would show 0% complete
  permanently.
- **Achievements.** `achievements` is seeded (migration 001:396). `user_achievements` is
  **never written by anything** — the only non-delete reference in the repo is the read in
  `queries.ts:335`. A six-month, 120-session athlete opens this tab and sees every badge at 40%
  opacity with a `0/N` counter. That is worse than not shipping the tab.
- **Leaderboard periods.** `/api/cron/leaderboard` exists but is **not in `vercel.json`**
  (only `hybrid-reports` is scheduled). `leaderboard_entries` is therefore always empty, so
  every period falls through to live `profiles.current_split_index`
  (`leaderboard.ts:334–340`). Weekly, Monthly and All-time render **byte-identical rows**, and
  `previousRank` is always null so the rank-movement arrow never appears.

### Every day. The streak says two different things.

Two independent implementations:

| | `lib/retention/streak-utils.ts` (dashboard, hero, notifications) | `lib/social/streaks.ts` (social page, public profile) |
|---|---|---|
| Day keys | Athlete's timezone | UTC (`iso.slice(0,10)`) |
| Rest day today | Allowed — probes from yesterday | **Breaks the streak immediately** |

An athlete who trained Mon–Sat and has not yet trained on Sunday morning sees **"6 day streak 🔥"**
on the dashboard and **no streak card at all** on Social and on their own public profile. This
is not an edge case; it is true every morning before training, which is when this persona opens
the app.

### Off-app: nothing.

`package.json` has no `@capacitor/push-notifications` and no local-notification plugin. Grepping
`from("notifications").insert` returns exactly two sites, both in `retention/rank.ts` — a
`welcome` for new accounts and a `streak_reminder`. Both are seeded by
`seedRetentionNotifications`, **called from the dashboard render**. The streak-at-risk
reminder therefore only exists if the athlete already opened the app. A re-engagement mechanism
that requires re-engagement is not one.

Nothing notifies on: friend request, duel invite, duel result, comment on your activity, score
on your activity, squad join, new PR, monthly report ready, or plan regenerated.

The one real off-app surface is the iOS home-screen widget (`RacePredictionsSync`,
`DailyTrainingSync`), and it is well built — payloads are derived from the same gates the app
UI uses so the two cannot disagree.

---

## Part 2 — Retention risks, severity ordered

### S1 — The plan never advances. It restarts at week 1 on every visit.

**Where:** `hpe/macrocycle.ts:137–142`; `api/hpe/plan/route.ts:279`;
`hybrid-plan-screen.tsx:194–198`.
**Effect:** The single feature this app is built around — "build me a block that arrives at an
event date" — delivers base week 1 every time it is opened. `blockProgress()` and the whole F15
quality progression (`progression.ts:91–120`) are computed against a week index that resets, so
the athlete is also prescribed the *same* interval session in week 1 of every regeneration.
This is the exact failure the assurance review named as F5 ("the same week repeated with
different labels"), reintroduced at the persistence layer rather than in the macrocycle.
**Fix:** Persist a block, don't regenerate one. On GET, load the active `hpe_plans` row and
compute `currentWeek = floor((today − generated_at)/7) + 1`; render from storage. Regenerate
only when (a) no active plan exists, (b) `evaluateRerun().shouldRegenerate`, or (c) the athlete
explicitly asks. Add `weekOffset` to `GeneratePlanInput` so a regeneration mid-block resumes at
the right phase and volume instead of re-ramping. Make `savePlan` supersede the previous active
plan unconditionally, and make `loadLatestStoredPlan` filter `superseded_at IS NULL`.

### S2 — The adaptation loop has no input. Nothing writes `hpe_session_feedback`.

**Where:** table in migration 040; zero writers; `route.ts:279` omits `feedbackByWeek`.
**Effect:** `autoregulate` (F16) and `applyLowCapacityDay` (F17) are unreachable. The plan
cannot respond to a session that went badly, a week that was missed, or a day the athlete
feels wrecked. Fleet monitoring reads 0 sessions and 100% abandonment for everyone, so the
team cannot detect this from the dashboard built to detect it.
**Fix:** Add a completion control to `TodaysSessionCard` and `day-detail.tsx` —
done / partial / skipped, optional RPE 1–10, and a "low capacity today" flag. Write
`hpe_session_feedback`. Pass `feedbackByWeek` into `generatePlan`. Wire `applyLowCapacityDay`
to the flag. Ideally link a logged `activities` row to the `hpe_sessions` row it satisfies so
`metPrescription` can be derived rather than self-reported.

### S3 — The 8-week projection is fitted on months-old data and reads red.

**Where:** `dashboard/page.tsx:181–186` — `.order(ascending: true).limit(90)`.
**Effect:** Silently correct below 90 logged sessions, silently wrong above it. A premium
athlete who is improving is shown a forecast *below* today's score, in `text-danger`,
attributed to "your recent trend". This is the single most demoralising wrong number in the
app and it only appears once someone has stayed.
**Fix:** `.order("recorded_at", { ascending: false }).limit(90)` and reverse in memory (or
add a `gte` cutoff). Audit every other `ascending: true` + `limit()` pair — `indexHistory`
(dashboard, 180) and `analytics/page.tsx:66` (400) have the same latent shape.

### S4 — Three of seven social tabs are permanently empty by construction.

**Where:** Challenges (no global rows, no creator, no progress writer); Achievements
(`user_achievements` never written); Leaderboard periods (`/api/cron/leaderboard` absent from
`vercel.json`).
**Effect:** A six-month user with 120 sessions and a friend list sees `0/N` achievements and
"check back soon" challenges. Empty state at signup reads as "early days"; empty state at month
six reads as "abandoned product".
**Fix, cheapest first:** (a) add `/api/cron/leaderboard` to `vercel.json` — one line, and it
makes period tabs and rank arrows real; (b) award achievements in `score-and-persist.ts` from
data already in hand (first 5k, 100 sessions, 30-day streak, 100kg bench, first hybrid plan
completed); (c) either seed rolling global challenges *and* update
`challenge_participants.progress` in the scoring path, or hide the tab until it has content.
Do not ship three greyed-out tabs.

### S5 — Two streak numbers for one athlete, contradicting every morning.

**Where:** `lib/retention/streak-utils.ts` vs `lib/social/streaks.ts`.
**Fix:** Delete `computeTrainingStreak`. Have `social/page.tsx` and `fetchPublicProfile` call
`computeStreakMetrics` with the athlete's timezone. Same function, one answer.

### S6 — The dashboard ranks, trends, and advises on numbers it does not display.

**Where:** `dashboard/page.tsx` — `weeklyTrend` (:433), `indexGap`/`weakerSide` (:574),
`GoalsCard` (:814), projection delta (:747) all read `current.*`; the hero and trend card read
`liveIndexes.*`.
**Fix:** Resolve `headlineValue`, `displayEnduranceIndex`, `displayStrengthIndex` once at the
top and feed *every* consumer from those three, exactly as the rank fix at `:564` already does.
The comment block at `:527–563` is the right rule; apply it to the remaining four call sites.

### S7 — Zero off-app re-engagement, and the in-app reminder is circular.

**Where:** no push dependency; `seedRetentionNotifications` called from the dashboard render.
**Effect:** For a 5–10×/week athlete this is survivable. For the week they get ill, travel, or
lose motivation, the app has no voice at all. Strava, Whoop and Hevy all do.
**Fix:** Ship `@capacitor/push-notifications` (or local notifications as a cheap first step for
streak-at-risk and "today's session"). Move notification seeding out of the dashboard render
into the existing cron. Add events for duel invite/result, comment on your activity, and monthly
report ready — the social loops that exist are silent, which is why they feel dead.

### S8 — Consistency is scored against a hardcoded 4 sessions/week.

**Where:** `analytics/page.tsx:207`, `streak-utils.ts:54`, `index-hero.tsx:79`.
**Effect:** A permanently maxed metric. `8/4` in the hero ring reads like a bug.
**Fix:** Derive the target from `hpe_intake` session availability, or a rolling personal
baseline. Make it settable.

### S9 — `hpe_plans` / `hpe_sessions` accumulate one plan per page view.

**Where:** `route.ts:298–311` persists unconditionally; `supersedePlans` only on regeneration;
`loadLatestStoredPlan` ignores `superseded_at`.
**Fix:** Falls out of S1. Until then, at minimum supersede on every write.

### S10 — On mobile, the USP and the social loop are both behind "More".

**Where:** `app-shell.tsx:319–390` — bottom bar is Home / Lab / log / Engine / More.
**Effect:** Interference — the thing nobody else does — is two taps deep on the device this
athlete uses. So is Social. `secondaryNav`'s own comment says Interference "needs to read as
[the USP] everywhere in the product"; on the phone it does not.
**Fix:** Promote Interference into the bottom bar, or surface a live interference verdict on
the dashboard above the fold rather than below it.

### S11 — Dead and misleading engine exports.

`shouldRerunDiagnostic` (`progression.ts:309`) has no call sites anywhere, including tests, and
duplicates the live check in `persistence.ts:104`. `applyLowCapacityDay` is test-only.
**Fix:** Delete `shouldRerunDiagnostic`; wire or delete `applyLowCapacityDay`. Dead exports in
an engine documented as closing named assurance findings will be read as evidence those
findings are closed.

### S12 — Soft-trial users can open the Reports page but no report exists.

`reports/page.tsx:24–28` gates on `isPremiumUser || hasSoftTrialAccess`; the cron generates only
for `isPremiumUser`. A trial user gets an unlocked page with no content.
**Fix:** Align the cron's predicate with the page's, or show the trial user an explicit
"your first report generates on the 1st".

---

## Part 3 — Why they stay

### What the competition gives this athlete that Split Index does not

- **Strava:** segments, kudos, club activity, a population dense enough that the feed is alive
  without you curating it, and — crucially — push notifications on every social event.
- **Hevy:** a genuinely fast in-gym logger, per-exercise volume/1RM history that updates as you
  lift, and plate-math. Split Index's strength analytics are richer; the logging path is not.
- **TrainingPeaks:** a plan that is a *calendar you complete*, with compliance, planned-vs-actual,
  PMC/CTL/ATL, and a coach who can see it. This is the direct competitor to the hybrid plan and
  it wins today on the one thing that matters — the plan advances and knows what you did.
- **Whoop:** a daily reason to open the app that is not "did you train" — sleep, HRV, recovery,
  a strain target that changes every morning. Split Index's dashboard has no equivalent daily
  variable, which is why it reads static at month six.

### The one thing nobody else does

**The Interference & Synergy Engine.** `src/lib/scoring/interference.ts` mines *this athlete's
own paired sessions* to answer "is my lifting costing my running, and by how much, and for how
many days after?" — decayed by day since the strength session, with an explicit low-confidence
caveat below `MIN_PAIRED_SESSIONS`, and an explicit "calibrating" state when there is nothing
to say. It is honest about its own uncertainty in a way almost nothing in consumer fitness is.
No competitor has this. Whoop measures recovery but not attribution. TrainingPeaks models load
but does not tell you that *lifting specifically* cost you 4% efficiency factor for two days.
Strava and Hevy do not model cross-domain interaction at all.

Split Index itself — one number reconciling endurance and strength, with Engine and Lab halves —
is the second differentiator, and it is more legible than the "hybrid athlete score" anyone else
ships.

### Is it obvious enough to be the reason they stay?

**Not yet.** The evidence:

- On mobile it is behind a "More" sheet.
- On the dashboard, `InterferenceRadarCard` is the fourth block below the fold, after readiness
  and the AI coach.
- Its only prescriptive output — `buildDeloadNudge` in `today-plan.ts` — fires only when
  readiness is below 40 **and** interference is at full confidence **and** the delta is worse
  than −3%. That triple gate means most athletes never see the one sentence where the two
  flagship engines combine into advice.
- Most damagingly, the *plan* does not consume it. The hybrid plan engine and the interference
  engine do not speak. An athlete whose own data says squatting costs them two days of running
  quality gets a macrocycle that does not know it.

**Verdict.** This athlete stays for three months on the quality of the analytics and the honesty
of the writing — this is a codebase whose comments show real care about not lying to users, and
that shows through. They start to drift somewhere in month four, when they notice the plan is
always week 1, the achievements are still `0/N`, and the projection tells them they are getting
worse. Nothing pulls them back because nothing can reach them off-app.

The thing that would make them stay is one sentence the app is already capable of writing and
does not: *"Your own last 90 days say a heavy squat costs you 4% running efficiency for two
days — so this week's block puts your interval session on Thursday, not Wednesday."* Wire the
interference engine into the plan, make the plan advance, and put that sentence on the first
screen. That is a product no competitor can copy without the paired data, and it is the only
version of this app whose daily open is genuinely earned.
