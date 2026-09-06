# UAT #1 — The brand-new, zero-data hybrid athlete

**Persona:** downloaded the app five minutes ago. Lifts and runs. Has logged nothing.
**Method:** traced through the source, empty/null branches only. No dev server run, no source modified.
**Branch:** `hybrid-plan-engine` · **Date:** 2026-09-06

---

## Part 1 — The journey, screen by screen

### 1. Landing page (`src/app/page.tsx` → `src/components/marketing/landing-page.tsx`)

Split-screen hero. Left: **"The Lab · Strength"**, **"LIFT HEAVY."**, "Every set scored against your history and international strength standards.", gauge reading **72.4 · Strength Index**. Right: **"The Engine · Cardio"**, **"RUN FAR."**, "Pace, heart rate and splits fused into one honest endurance score.", gauge **69.1 · Running Index**. Centre ring on desktop: **70.8 · Split Index · "See how they affect each other"**, and **"Drag the divide"** at the bottom.

Below: a ticker of fabricated stats ("DOTS 412.6 / Top 21% worldwide", "EF +9.4% / 90-day efficiency", "Decoupling 3.1% / Aerobic health"), four data tiles, a product showcase (**"One logbook. Two engines."**), pricing (**"Start free. Upgrade when you're hooked."**, £0/mo vs £29.99/yr), and the four promise cards:

- "See how lifting and running actually affect each other"
- "Know when to back off" — *"Your Injury Risk Index tracks ACWR against your own training baseline…"*
- "Know what you're capable of" — race predictions
- "Prove it" — DOTS, IPF GL, age-graded standards

**Next action:** obvious. "Start free" is in the sticky header, in the mobile hero, on both pricing cards, and both halves of the closing CTA strip ("Enter the Lab →" / "Start the Engine →"). This screen does its job. *It is also the only screen in the entire flow that shows a number worth wanting.*

**Taps: 1.**

---

### 2. Signup (`src/app/signup/page.tsx` → `src/components/auth/auth-form.tsx`)

Header: brand mark, **"Create your account"**. Card: **"Continue with Google"**, divider **"or continue with email"**, then Email, Password, hint *"Use at least 8 characters. Longer passwords with letters and numbers are stronger."*, button **"Create Account"**. Footer: terms/privacy line.

Nothing empty here — it's an auth form. Clean.

**Taps: 3. Typed fields: 2.**

---

### 3. Email OTP (same component, `phase === "otp"`)

> "We sent a 6-digit code to *you@example.com*. Enter it below to confirm your account — or click the confirm link in that same email if you'd rather use that."
> "Don't see it? Check your junk/spam folder — confirmation emails end up there more often than they should."

Field **"6-digit code"** (autofocus), **"Verify code"** (disabled until 6 digits), then "← Use a different email" / "Resend code".

**The link path is a trap.** If they click the email link instead of typing the code, `src/app/auth/callback/route.ts` routes them to `/email-confirmed`, which calls `supabase.auth.signOut()` and renders:

> "You're verified — welcome to Split Index"
> "Your email is confirmed and your account is now active. Sign in to start logging your training and see where you rank."
> **[Sign in to Split Index]**

They are dropped back at the login screen and must type email + password again. The OTP path goes straight to `/onboarding`; the link path costs a whole extra sign-in. This is deliberate (there's a comment explaining it) but the user doesn't know that.

**Taps: 1. Typed fields: 1** (+3 taps and 2 more typed fields on the link path).

---

### 4. Onboarding, step 1 of 4 — "Basics" (`src/components/onboarding/onboarding-flow.tsx`)

Progress bar (4 segments), **"Onboarding"**, **"Basics"**, **"Step 1 of 4"**.

- Avatar circle + **"Profile icon"** / *"Optional — shown on the leaderboard"*, then **"Or pick one"** with preset avatars.
- **Username** — hint *"Public — shown on the leaderboard. Letters, numbers, underscore."* Live check shows "Checking availability…" → "Available" / "Taken".
- **Date of Birth** — hint *"We use this to calculate your age"*, becomes "Age 34".
- **Gender** — select, "Select…".
- (Only for non-male/female:) **"Score me against (optional)"**.
- **[Continue]**

Username is *required* (`usernameStatus !== "available"` blocks) for a leaderboard the user has not asked about and cannot see yet.

**Taps: ~5. Typed fields: 2** (+1 select).

---

### 5. Onboarding, step 2 of 4 — "Body"

**Height (cm)**, **Weight (kg)** (both required), **Max Heart Rate** *"Optional — suggested: 186"*, **Resting Heart Rate** *"Optional — with max HR above, unlocks personalized heart-rate-zone scoring on easy/recovery/long sessions"*. **[Back] [Continue]**

**Taps: 3. Typed fields: 2.**

---

### 6. Onboarding, step 3 of 4 — "Sports"

**"Preferred Sports"**, a 2-column grid of sport pills. Our hybrid athlete taps Gym and Running. **[Back] [Continue]**

**Taps: 3.**

---

### 7. Onboarding, step 4 of 4 — "Ready"

Card 1: **"Your Your Split Index"** eyebrow, a dashed circle containing **"—"**, then:

> **"Earned from your first workout"**
> "No baseline guess. Each sport builds its own index — running vs running, gym vs gym — then blends into your hybrid score."

with 🏋 "Gym Strength Index" and 🏃 "Sport-specific endurance" chips.

Card 2: ✨ **"You're set"** — *"Log your first workout to unlock your sport-specific index — goals and experience level can wait until after you've seen your score."*

Button: **[Go to Dashboard]**

Two problems, both visible in the source:

- **No Back button on this step** (`step > 0 && step < 3`). Picked the wrong sports? Can't fix it.
- **The button does not go to the dashboard.** It saves the profile and sets `showReveal`, which mounts a further four-phase sequence. The label lies.

**Taps: 1.**

---

### 8. Score reveal, phase 1 — a spinner that computes nothing (`score-reveal.tsx`)

Full-card spinner for a hardcoded **2400 ms**:

> **"Calculating your Split Index…"**

There is nothing to calculate. The user has entered zero performance data at this point. This is 2.4 seconds of theatre before a form.

---

### 9. Score reveal, phase 2 — "quick-input"

> **"Enter a result to see your score"**
> "Any combination works — a lift, a run, or several of each. This is stored as a personal stat, not a logged workout, so it won't show up in your activity history."

**"Strength (SBD) — optional"**: Squat / Bench Press / Deadlift, each with a blank *Weight (kg)* and *Reps* prefilled to `5`.
**"Cardio — optional"**: sport select (Running), **Distance (km) = `5`**, **Minutes = `25`**, **Seconds = `0`**, plus "+ Add another sport (e.g. 10K bike, 1K swim)".
**[See your score]**

🔴 **The cardio entry ships pre-filled with a 5 km in 25:00 that the user never claimed.** `newCardioEntry()` returns `{ distanceKm: "5", minutes: "25", seconds: "0" }`, and `canSubmitQuickInput` is therefore `true` on mount. Both labels say "optional", the whole section is skippable-looking, and there is no Skip button — so the fastest, most obvious action (tap the only enabled button) POSTs a fabricated 5K PB to `/api/onboarding/calibrate`, which writes it to `personal_records`, seeds `predicted_benchmarks` with `sample_count: 1`, and inserts a `split_index_history` row. Every number the athlete sees for the next several weeks is anchored to a run that never happened.

**Taps: 1. Typed fields: 0 (if they accept the default) / up to 9 (if they don't).**

---

### 10. Score reveal, phase 3 — "revealing"

> **"Your Split Index"**
> ✨ **62.4**
> **"Intermediate"**
> "Keep logging both sides of your training and we'll show you something no other app can: how your lifting and running actually affect each other."
> **[Continue]**

**Nothing explains the number.** No scale ("out of 100" appears only later, on the dashboard hero). No "here's what went into it". No link to `/how-scoring-works` (which exists and is thorough, but is linked from the marketing footer, `/analytics`, the Lab panel, and activity detail — never from the one screen where a stranger meets their first score). The tier word comes from `tierForScore()`, whose thresholds are the **strength** tier table (`Beginner / Intermediate / Semi-Pro / Advanced / Elite / World Class` in `split-strength-engine.ts`) — a runner who entered only a 5K is handed a strength-flavoured rank with no caveat.

**Taps: 1.**

---

### 11. Score reveal, phase 4 — the paywall

> **"Start your 14-day free trial"**
> "Full Split Index, AI coaching, and analytics — free for 14 days. Cancel anytime."
> [SKU picker — annual / monthly / lifetime]
> *"Skip for now"* (small, underlined, muted grey)

A payment screen, before the first workout, before the product has done anything. The dismissal is the smallest, dimmest thing on the card.

**Taps: 1.**

---

### 12. First dashboard (`src/app/(app)/dashboard/page.tsx`)

`hasActivities = false` (calibration deliberately writes no `activities` row). `hasIndexHistory = true` (calibration wrote one). `premium = true` via `hasSoftTrialAccess`. Here is what actually renders, top to bottom:

1. **Greeting line:** `Hi, {username}` · `Sat 6 Sep` · *"gym or running — keep the hybrid balance going"*
2. **`EmptyDashboardHero`:** ✨ **"{name}, your index is unwritten"** — *"No baseline guess. Log your first workout and earn a sport-specific score — your running index vs your runs, your bench score vs your bench history."* Four bullets ("Per-sport comparative scoring", "Hybrid 50/50 composite index", "Session-to-session sport deltas", "AI coach on score breakdown"). Buttons **[Log gym] [Log cardio]**, link "All sports →", note "Sport score unlocks instantly".
3. **`IndexHero` — HIDDEN.** It is gated on `hasActivities`. 🔴 **The 62.4 they were shown ninety seconds ago appears nowhere on the home screen.** The app that just gave them a score now tells them their index is "unwritten".
4. **Hybrid Plan band:** **"Hybrid Plan · Today"** → **"No plan yet"** — *"Build a block that arrives at your event date, and today's session shows up here."* **[Build your plan →]**
5. **Race + Lift prediction strips — HIDDEN** (`hasActivities`). The nicely-worded empty copy ("A few more runs and your times across every distance appear here.") never gets shown to the person who most needs it.
6. **ReadinessCard — HIDDEN.**
7. **AI Coach (full width):** **"AI Coach"** — *"Complete a workout to receive data-driven performance analysis, recovery guidance, and session recommendations after every activity."* (upsell link hidden, soft trial counts as premium)
8. **Interference Radar — HIDDEN.**
9. **Engine vs Lab:** **"Log a few cardio and gym sessions to see your balance trend"** (`data.length < 2`)
10. **8-week projection — HIDDEN** (`computeSplitIndexProjection` returns null under 3 points)
11. **The push row, three cards:**
    - 🔴 **`NextRankCard`**: `target` is null, so it falls to the final branch and renders **"Beat The Next Rank"** / 👑 / **"You're #1"** / *"Nobody's ahead of you globally right now — keep training to defend it."* **A user with zero logged sessions is congratulated on being the best athlete in the world.**
    - **`FocusWeekCard`**: **"Your Focus This Week"** — "**Strength** is lagging by 4.1 pts — bias your next sessions here." *(computed from the fabricated 5K from step 9.)* → **[Schedule a compound-lift gym session →]**
    - **`GoalsCard`**: **"No goals set yet"**
12. **Upcoming races:** "No upcoming races yet — add one to get a terrain- and weather-aware prediction." **[Add race]**
13. **"Your data"** / "Full analytics →"
14. **`WeekOverWeekCard`**: **"This Week vs Last"** — **0** "sessions this week", "0 last week", "Training load — **0 AU**"
15. **`SportComparisonGrid`**: "Log a session to see how you compare to your own history"
16. **`RecentWorkouts`**: **"The tape is empty"** — *"Your sessions will scroll here like a market feed."* → "Log your first workout →"
17. **Disclaimer:** "Split Index scores are training estimates based on your logged data. They are not medical advice…"

**Verdict on this screen:** eight of the seventeen blocks are either hidden or say some variant of "log something". It is not visually broken — every empty state is written and styled — but it is a **wall of absence**, and the two things on it that *do* carry a number are a zero ("0 AU") and a lie ("You're #1"). This is the exact screenshot the owner already complained about, and the calibration score that would have fixed it is thrown away by the `hasActivities` gate.

**Next action:** yes, obvious and repeated (Log gym / Log cardio / the + button / "Log your first workout →"). No dead end. But it takes four screens of scrolling to establish that the app currently knows nothing about you.

---

### 13. The + button → log launcher (`src/components/activities/log-launcher.tsx`)

Bottom-bar raised **+** ("Log workout") → `/activities/new` → **"Log workout"**, split half-and-half:

- **The Lab · Strength** — 🏋 **"Gym session"**, *"Exercises, sets and reps — scored against your own best lifts."*, pill **"Start lifting ›"**
- **The Engine · Endurance** — a GPS row (**GPS 🏃 Run / 🚵 Ride / 🚶 Walk**), then *"Or log one you've done"* and a 4-across grid of the endurance sports.

This screen is genuinely good and needs no empty state.

**Taps: 2** (+ then a sport).

---

### 14. The form (`sport-form.tsx`, running)

**"What kind of session?"** first, with pill options and a plain-English meaning under each (`easy` → *"Conversational pace. The baseline your aerobic efficiency is measured against."*). Then **Date & start time** (prefilled to now), **Distance**, **Duration**, then optional Avg heart rate / Elevation gain / Temperature / **"RPE — how hard did it feel?"**, and a collapsed "Name & notes (Optional)".

Required for a run: distance + duration. Required for a gym session: bodyweight (prefilled from the profile), and one exercise with a name, a muscle group (auto-filled if picked from the library), weight and reps.

**Taps: 3. Typed fields: 2.**

---

### 15. First score (`src/components/activities/success-screen.tsx`)

> ✓
> **"Session scored"**
> **68.4**
> **"Running Index"**
> *(if session type is easy/recovery/long:)* 🔴 *"Scored relative to your own recent easy-effort history, not absolute pace."*
> …
> **"Your predicted 5K, updated by this run"** → **"Calibrating — 2/5 sessions logged"**
> **"First Running session logged — your history starts here."**
> **"Composite Split Index"** → **63.1** + breakdown line
> 👑 **"Unlock AI Coach analysis"** — *"Premium explains every score factor — tied to your actual breakdown, not generic motivation."* → **"Start 14-day free trial →"**
> *"Taking you to your dashboard…"*
> **[View dashboard] [Log another]**

**Is the score explained?** Partially, and better than the onboarding reveal — there's a sport label, a benchmark context line, a "first session" line, and a composite breakdown. But:

- 🔴 **It auto-redirects after 6200 ms** (`REDIRECT_AFTER_MS`). A first-time user gets 6.2 seconds to read a card containing a headline index, an enrichment panel, a prediction range, a calibration notice, a comparison panel, a composite index and an upsell. It will yank the page out from under them mid-sentence.
- 🔴 The **"Scored relative to your own recent easy-effort history"** caption fires purely on session type (default `easy`), with no check that the history exists. `MIN_EASY_BASELINE_SAMPLES = 3`, so on session #1 the scoring did **not** do that. The app's first explanation of its own maths is false.
- 🔴 **"Start 14-day free trial →"** — they are *already* inside the soft trial the dashboard is using to unlock premium cards. `/activities/new` passes `isPremiumUser(...)` only; the dashboard uses `isPremiumUser(...) || hasSoftTrialAccess(...)`. Two screens, two different truths about the same account.

---

### 16. Back on the dashboard — what the app asks them to do next

Now `hasActivities = true`, so the hidden blocks appear. With exactly one logged session:

- **IndexHero**: a real number, tier badge, *"Strength + endurance, out of 100"*, "No change over the last 7 days", Engine / Lab / Streak 🔥 1 "Day in a row", weekly ring "1/4 Sessions this week".
- 🔴 **`ReadinessCard`**: with one session, `acute = L`, `chronic = L/4`, so **ACWR ≈ 4.0** → `fatigueScore ≈ 66` → **readiness ≈ 28**, rendered in `text-danger` red under **"Today's Readiness"**, with *"Lower today — recent strength training is the main driver."*
- 🔴 **`TodayCard`**: `readiness < 40` → **"Recovery day — easy movement only, or take the day fully off."**

**The app's reward for a first-ever workout is a red 28/100 and an instruction not to train again.** This is the single worst moment in the flow and it lands exactly where the retention loop needs a win.

- **Race strip**: "A few more runs and your times across every distance appear here." **[Log a run]**
- **Lift strip**: dashes (`—`) for lifts not yet logged.
- **Engine vs Lab**: still "Log a few cardio and gym sessions to see your balance trend" — `trendByDay` collapses the calibration row and the session row onto the same calendar day, so `data.length` is still 1.
- **Interference Radar**: "Gathering data — log both a strength and a cardio session across a few weeks and we'll show you something no other app can: how your lifting and running actually affect each other."

---

## Part 2 — Tap and field count, app-open to first logged workout

| Step | Taps | Typed fields |
|---|---|---|
| Landing → Start free | 1 | 0 |
| Signup (email, password, submit) | 3 | 2 |
| OTP (type code, verify) | 1 | 1 |
| Onboarding "Basics" (username, DOB, gender, continue) | 5 | 2 |
| Onboarding "Body" (height, weight, continue) | 3 | 2 |
| Onboarding "Sports" (gym, running, continue) | 3 | 0 |
| Onboarding "Ready" (Go to Dashboard) | 1 | 0 |
| *2.4 s fake spinner* | — | — |
| Quick-input (accept the prefilled fake 5K) | 1 | 0 |
| Score reveal → Continue | 1 | 0 |
| Trial paywall → Skip for now | 1 | 0 |
| Dashboard → + | 1 | 0 |
| Log launcher → pick Running | 1 | 0 |
| Form (distance, duration, submit) | 3 | 2 |
| **TOTAL** | **≈25** | **9** |

Add **+3 taps and +2 typed fields** if they click the email link instead of typing the code. Add **up to 9 more typed fields** if they honestly fill in the quick-input instead of accepting the fabricated default.

**Discrete screens between "Start free" and the dashboard: 9** (signup, OTP, 4 onboarding steps, spinner, quick-input, reveal, paywall). **Two of those nine — the spinner and the paywall — do nothing for the user.**

Is onboarding too long to survive? Marginally. Four steps with a visible "Step 1 of 4" is defensible; the problem is that the progress bar *lies* — it says four steps and then delivers four more screens after "Go to Dashboard", including a payment prompt. A user who has budgeted their patience against that progress bar will feel bait-and-switched at exactly the moment they were told they were finished.

---

## Part 3 — Drop-off risks, worst first

### S1 — The onboarding score is thrown away by the dashboard
`hasActivities` gates `IndexHero`, and calibration deliberately writes no `activities` row. The user is shown **62.4 · Intermediate**, taps Continue twice, and lands on a home screen headed **"your index is unwritten"**. Every prediction strip is hidden for the same reason.
**Fix:** gate the hero on `hasIndexHistory`, not `hasActivities`, and render `EmptyDashboardHero` only when *both* are false. Show the calibrated index with an honest badge ("From your onboarding stats — log a session to make it real"). Do the same for the two prediction strips: their empty copy is already written and is far better than hiding them.
*Files: `src/app/(app)/dashboard/page.tsx:631–680`.*

### S2 — A red 28/100 readiness and "take the day fully off" after the first workout
One session gives ACWR ≈ 4.0 (`acute = L`, `chronic = L/4`), readiness ≈ 28, `text-danger`, and `TodayCard` prescribes "Recovery day — easy movement only, or take the day fully off."
**Fix:** suppress or neutralise both cards below a minimum chronic-load history (e.g. fewer than ~6 sessions or under 14 days of data). Show "Building your baseline — readiness needs about two weeks of sessions" instead of a number. An ACWR with a one-session denominator is not a measurement.
*Files: `src/lib/scoring/readiness.ts`, `src/lib/scoring/today-plan.ts`, `src/components/dashboard/readiness-card.tsx`.*

### S3 — The onboarding calibration invents a 5 km in 25:00
`newCardioEntry()` prefills `distanceKm: "5", minutes: "25"`, making the submit button live on mount with data the athlete never entered. There is no Skip. This becomes a personal record, a `predicted_benchmarks` seed, and the anchor for their Split Index, race ladder and "Strength is lagging" nudge.
**Fix:** start every field blank; disable the button until something real is entered; add an explicit **"Skip — I'll log a session instead"** that lands them on the dashboard. If a placeholder is wanted, use the HTML `placeholder` attribute, never a `value`.
*Files: `src/components/onboarding/score-reveal.tsx:36–39, 76, 104`.*

### S4 — "You're #1" to a user with zero sessions
`NextRankCard` receives `target: null` and falls through to the crown branch: **"You're #1 — Nobody's ahead of you globally right now — keep training to defend it."**
**Fix:** add an explicit null branch — "Log a few sessions and we'll show you the athlete just ahead of you." Never render the #1 claim from an absent target.
*Files: `src/components/retention/next-rank-card.tsx:88–137`, dashboard line 798.*

### S5 — The success screen yanks itself away after 6.2 seconds
`REDIRECT_AFTER_MS = 6200`, and the card it is redirecting away from is the densest screen in the app.
**Fix:** disable the auto-redirect on the athlete's first N sessions (or entirely — both buttons already exist). At minimum raise it and show a visible countdown so it doesn't read as a crash.
*Files: `src/components/activities/success-screen.tsx:68, 102–106`.*

### S6 — The first score is never explained
The reveal shows a bare **62.4** and a strength-table tier word. No scale, no inputs, no link to `/how-scoring-works` — which exists, is good, and is linked from four *other* places.
**Fix:** add "out of 100", one line naming what fed it ("From your 5K — the gym half is still blank"), and a "How this is calculated →" deep link. Use the API's `headlineLabel` (already returned, currently discarded) instead of hardcoding "Your Split Index" for a cardio-only entry.
*Files: `src/components/onboarding/score-reveal.tsx:144, 287–324`.*

### S7 — A false explanation of the maths on the first run
"Scored relative to your own recent easy-effort history, not absolute pace." renders on session type alone. `MIN_EASY_BASELINE_SAMPLES = 3`, so it is untrue for sessions 1–2.
**Fix:** pass through whether relative scoring actually applied and gate the caption on that.
*Files: `success-screen.tsx:153–157`, `src/lib/scoring/cardio-predictions.ts:797`.*

### S8 — The app contradicts itself about the trial
The dashboard treats the account as premium (`hasSoftTrialAccess`); the success screen tells the same user to "Start 14-day free trial →". They were also already offered the trial at the end of onboarding.
**Fix:** thread `hasSoftTrialAccess` into `/activities/new` (and every other `isPremium` prop) so one account has one trial state. Replace the success-screen upsell during the soft trial with "Trial · 12 days left".
*Files: `src/app/(app)/activities/new/page.tsx:42–45`, `src/lib/retention/trial.ts`.*

### S9 — "Go to Dashboard" doesn't, and a 2.4 s spinner computes nothing
The step-4 button opens four more screens, one of which is a paywall. The first of those is a hardcoded 2400 ms "Calculating your Split Index…" before any data has been entered.
**Fix:** relabel to "See your first score", extend the progress bar to cover the reveal, and delete the spinner (or move it to *after* the calibrate POST, where there is actually something to wait for).
*Files: `onboarding-flow.tsx:44, 695–697`, `score-reveal.tsx:78–82`.*

### S10 — A payment screen before the first workout
The trial SKU picker is phase 4 of onboarding; "Skip for now" is the smallest text on the card.
**Fix:** move it behind the activation event that already exists — `ACTIVATION_EVENT_SESSION_COUNT = 3` and `showActivationPaywall` are already built for exactly this, and currently never fire for a new user because the soft trial suppresses them.
*Files: `score-reveal.tsx:326–345`, `src/lib/pricing/config.ts:25`.*

### S11 — Username is mandatory for a leaderboard they haven't seen
Step 1 blocks on an available username, with a live availability check, for a premium-gated social feature.
**Fix:** offer a generated default with a "change it later" note, or move it to the deferred profile prompt.
*Files: `onboarding-flow.tsx:196–201`.*

### S12 — The email-link path silently signs them out
Clicking the confirmation link routes to `/email-confirmed`, which calls `signOut()` and demands a fresh login.
**Fix:** if the deliberate sign-out must stay, say so on that page ("For security we've signed you out — sign in once and you're in"), and make the OTP code far more prominent than the link in the email template.
*Files: `src/app/auth/callback/route.ts:133–140`, `src/app/email-confirmed/page.tsx`.*

### S13 — No Back button on the final onboarding step
`step > 0 && step < 3` hides it. Wrong sport selection is unfixable without restarting.
**Fix:** allow Back on step 3.
*Files: `onboarding-flow.tsx:685`.*

### S14 — The deferred profile prompt doesn't exist
Onboarding promises *"goals and experience level can wait until after you've seen your score"*, and a code comment cites a "deferred 'complete your profile' prompt". Nothing in the app ever asks. The only match in the codebase is a sidebar label.
**Fix:** build the prompt, or cut the promise from the copy.
*Files: `onboarding-flow.tsx:41–43, 672–675`.*

---

## Part 4 — What is promised and when it actually arrives

| Promise (where it's made) | Gate | Sessions needed |
|---|---|---|
| Split Index headline | `hasActivities` on the dashboard | **1** (but the onboarding score is hidden until then — S1) |
| Per-session sport index | none | **1** — the app's one instant payoff |
| Predicted 1RM strip | a logged squat/bench/deadlift | **1 gym session** |
| Engine vs Lab trend | `data.length >= 2` **distinct calendar days** | **2 sessions on different days** |
| Predicted race times, every distance ("Know what you're capable of", landing) | `TIER2_MIN_SAMPLES_TO_DISPLAY = 5` | **5 cardio sessions** (calibration seeds 1, so 4 more) — until then "Calibrating — n/5 sessions logged" |
| 8-week projection | ≥3 history points | **3 sessions** (premium; soft trial covers it for 14 days) |
| Interference / "how lifting and running actually affect each other" — **the #1 landing promise and the closing line of the score reveal** | `MIN_PAIRED_SESSIONS = 3` paired sessions across a lookback window; ≥2 gym sessions for the reverse direction | realistically **6+ sessions across several weeks**, both disciplines |
| Injury Risk Index ("Know when to back off" — landing promise #2) | 28-day chronic ACWR window; lives on `/analytics`, premium-gated, **not on the dashboard at all** | **~4 weeks** |
| DOTS / IPF GL ("Prove it" — landing promise #4) | `strength_dots_gl` premium feature | **1 gym session**, but paid after day 14 |

**Three of the four landing-page promise cards do not produce a number in the first five minutes, and two of them do not produce one in the first week.** The one that does — a per-session sport index — is exactly the thing the dashboard hides behind `hasActivities` until they've logged.

---

## Part 5 — The first five minutes: would they keep it?

**Probably not, and the reason is not the product — it's the ninety seconds after they finish onboarding.**

What works: the landing page is excellent and sells a real, differentiated idea. The log launcher is the best screen in the app. The session form explains itself better than most fitness apps manage. Every empty state has been written by someone who cared — "The tape is empty", "your index is unwritten", "A few more runs and your times across every distance appear here". Nothing renders as a raw crash or an undefined. The next action is always visible; there is **no dead end anywhere in this flow**.

What kills it is a sequence of small betrayals stacked back to back:

1. They tap "Go to Dashboard" and get four more screens, one of which asks for money.
2. They are shown **62.4** with no explanation of what it is or where it came from — most likely computed from a 5 km run the app made up on their behalf.
3. They arrive at a home screen that says **"your index is unwritten"**, hides the score they just earned, congratulates them on being **#1 in the world**, and reports **0 AU** of training load.
4. They log an honest first run, get a decent score card, and have it **snatched away after 6.2 seconds**.
5. They land back on the dashboard and the app's very first piece of coaching is a **red 28/100** and *"take the day fully off."*

The owner's complaint about the old home screen — *"the screenshot does not entice you to start logging when you first see it"* — has been half-fixed. It now entices you to log. What it does not do is **reward you for having logged**, and it actively punishes you for it via the readiness card. S1 and S2 alone are the difference between a first-five-minutes that ends in "log another" and one that ends in a long-press and Delete App.

**Fix S1, S2, S3, S4 and S5 — five changes, all of them small and local — and this becomes a keeper.** Everything else on the list is polish on top of a product that clearly knows what it is.
