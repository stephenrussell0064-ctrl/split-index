# Split Index — Appeal & Desirability Review

**Question asked:** not "does it work" but "would a hybrid athlete choose it, pay for it, and tell someone about it?"

**Short answer:** The product has a genuinely unique, defensible hook — and it is not on the first screen, not on the mobile first screen at all, and not in the app's own onboarding. Everything else is competent. This is a positioning and moment-design problem, not a features problem.

---

## 1. First impression

### What is good

The visual identity is genuinely distinctive and is the app's biggest non-obvious asset. `src/app/globals.css` defines two complete, opposed worlds:

- **The Lab** — `--gym-bg: #070908`, `--gym-accent: #3DFF6E` (near-black + neon green)
- **The Engine** — `--cardio-bg: #f7fbff`, `--cardio-accent: #3BA6FF` (near-white + sky blue)

A dark-and-light split inside one app is rare in fitness. Strava is orange-on-white, Hevy is blue-on-dark, Whoop is a monochrome data screen. Nobody looks like this. The wordmark in `src/components/brand/brand-mark.tsx` — `SPLIT` in green, `/` in grey, `INDEX` in blue — encodes the whole product in seven characters. Keep all of it.

The landing hero (`src/components/marketing/hero-split.tsx`) is the most confident piece of design in the repo: a draggable clip-path seam between the two worlds with a composite ring floating on the divide.

### What undersells it

**a) The hero is invisible on mobile — and mobile is the first impression.**

This is the single most damaging finding in the review. In `hero-split.tsx`, three elements are `hidden md:block` / `hidden md:flex`:

- the seam (line 181)
- the **composite ring** — the `70.8 · Split Index · "See how they affect each other"` (line 187)
- the "Drag the divide" affordance (line 201)

Below 768px the panels stack in normal flow. A phone visitor therefore sees:

> **LIFT / HEAVY.** … gauge 72.4 … then scroll … **RUN / FAR.** … gauge 69.1 … then a "Start free" button.

There is **no seam, no composite number, no Split Index, and no statement of what the product does**. The brand's entire thesis — two things, one score, and they affect each other — does not render on the device most people will open the link on. The name "Split Index" appears on a phone only in the logo image. This alone explains "the screenshot does not entice you."

**b) The headline says nothing only this app can say.**

"LIFT HEAVY." / "RUN FAR." is a supplement ad. It is the exact promise Strava, Hevy, Garmin and every gym poster already make. The two sub-lines are better but still generic: *"Every set scored against your history and international strength standards"* is a Hevy feature; *"Pace, heart rate and splits fused into one honest endurance score"* is Garmin's Running Index, shipped in 2016.

The actual hook is in a 10px line inside the composite ring — **"See how they affect each other"** — sized and placed like a caption.

**c) `src/components/marketing/data-tiles.tsx` is a screenshot of a spreadsheet.**

Four tiles: "412.6 DOTS", "4:42 /km", "+31 pts", "Z2 dominant" under the heading *"Data that actually means something"*. The heading promises meaning; the tiles deliver acronyms. `EF 0.84`, `Decoupling 3.1%` and `DOTS 412.6` in `data-ticker.tsx` are unreadable to anyone who is not already a data nerd — and the data nerd already owns TrainingPeaks. Worse, `EF 0.84` and `Decoupling 3.1%` are the *literal synthetic placeholder values* hard-coded in `gateCardioEnrichment()` (`src/lib/scoring/gates.ts:104-112`) for locked free users. The marketing site is advertising the dummy data.

**d) `src/components/marketing/product-showcase.tsx` shows the wrong product.**

The 3D-tilted browser mock shows two cards — "The Lab 72.4" and "The Engine 69.1" — side by side. That is precisely the "a strength score and a cardio score side by side" that `pricing-cta.tsx` line 12 explicitly says the product is **not**. The showcase contradicts the positioning three sections below it. It should show the Interference Radar.

**e) Screens that undersell the product, ranked:**

| Screen | Problem |
|---|---|
| Mobile landing hero | Composite ring / seam / hook all `hidden md:block` — brand thesis absent |
| `retention/empty-dashboard-hero.tsx` | First in-app screen. Bullet list is a spec sheet, not a promise (see §4) |
| `marketing/data-tiles.tsx` | Four acronyms under a heading promising meaning |
| `marketing/product-showcase.tsx` | Depicts the "two scores side by side" product the copy disavows |
| OG image (`app/layout.tsx:45`) | Every shared link previews as a bare logo on a white bar |
| `activities/success-screen.tsx` | The reward moment; currently a receipt (see §3) |

**f) Domain inconsistency.** `product-showcase.tsx:80` renders `splitindex.co.uk/dashboard`; the shareable image at `app/api/interference/report-card/route.tsx:83` renders `splitindex.app/interference`. One of these travels on social media. Pick one.

---

## 2. The hook

### The sentence nobody else can say

> **Split Index is the only app that can tell you what leg day is actually doing to your 10K — measured in your own training history, not in a study of somebody else.**

This is real, and it is defensible. `src/lib/scoring/interference.ts` mines the athlete's own paired sessions: it compares efficiency-factor and HR on easy/recovery/long cardio sessions at day 0/1/2/3 after a strength session against a rested baseline (`MIN_REST_DAYS_FOR_BASELINE: 2`), and runs the reverse direction — high-cardio-volume weeks vs low — against the strength component. It degrades gracefully to a coarser weekly comparison (`WeeklyInterferenceFallback`) while day-level pairing is thin, and it labels low-sample findings rather than hiding them.

Why the competition structurally cannot copy it:

- **Strava / Garmin / Whoop** — have your runs, do not have your working sets, RPE and per-lift loads.
- **Hevy** — has your sets, has no cardio.
- **TrainingPeaks** — has both, but rolls them into a single undifferentiated TSS number. TSS is *designed* to erase the distinction between a squat session and a tempo run. Split Index's entire value is refusing to erase it.
- Nobody else has both halves on one timeline with the modality preserved. That is a genuine moat, and it deepens with every session logged.

The second-order hook is the Hybrid Plan Engine (`src/lib/scoring/hpe/`), which is far more serious than its marketing suggests: a deterministic, constants-versioned pipeline (health screen → data sufficiency → feasibility → macrocycle → session set → schedule → ACWR enforcement) with an explicit non-negotiable that it emits no calorie, macro, or rate-of-loss output. That last constraint is a marketing asset in 2026 and is stated nowhere a user can see.

### Does the app lead with it? No.

**On the landing page**, the hook appears exactly twice, both times buried:

1. `hero-split.tsx:196` — `"See how they affect each other"`, at `text-[10px]`, `text-white/45`, inside the composite ring, `hidden` on mobile.
2. `pricing-cta.tsx:11-13` — the first `OUTCOMES` card, which is the best copy in the entire repository and is sitting six sections down inside the pricing block:

> *"See how lifting and running actually affect each other — Not a strength score and a cardio score side by side — real analysis, mined from your own paired history, of whether leg day is hurting your next run and vice versa. Nobody else has both halves of your training on one timeline."*

That paragraph is the homepage headline. It is currently the fifth thing under an `<h2>` reading "Start free. Upgrade when you're hooked."

Meanwhile the `<h1>` says "LIFT HEAVY." and the site `<meta description>` (`app/layout.tsx:37`) says *"The premium analytics platform for hybrid athletes. Objective fitness scoring that updates after every workout."* — a sentence that would fit any of the five competitors named above.

**In the app**, `InterferenceRadarCard` is rendered at `dashboard/page.tsx:703` — below the index hero, the plan band, both prediction strips, the readiness card, the AI coach and the today card. It is roughly the seventh block on the page. The dashboard's own header comment carefully justifies the order of blocks 1–4 and never asks whether the differentiator should be one of them.

The card's own copy, when it has nothing yet, is the best line in the app:

> *"Gathering data — log both a strength and a cardio session across a few weeks and we'll show you something no other app can: how your lifting and running actually affect each other."*

A brand-new user never sees it: the whole card is inside `{hasActivities && ...}`.

**The nav label for it is "Interference"** (`layout/app-shell.tsx:40`) — a word that means "signal problem" to most people.

**Note on pricing strategy:** interference is *not* in `PREMIUM_FEATURES` — it is free. That is the correct call (it is the hook and it gets better with logging, so it drives retention), but it means the paid tier is currently sold on ACWR, DOTS, projections and leaderboards — i.e. on the generic half of the product. See §5.

---

## 3. Emotional payoff

### What happens now, on submit

`src/components/activities/success-screen.tsx`:

1. A check mark scales in (0.35s).
2. A number counts up from 0 (1.1s, delay 0.55s) — the sport index.
3. Comparison panel vs the athlete's own history.
4. Composite Split Index, smaller, below a divider.
5. A `<Crown>` premium upsell, "Unlock AI Coach analysis" (`!isPremium`).
6. `"Taking you to your dashboard…"` — and at **6200ms an automatic `router.push`** (`REDIRECT_AFTER_MS`).

`MilestoneToast` can fire — but only when a hard-coded index threshold is crossed, and its copy is *"Index milestone / You crossed 70 — elite territory awaits."*

### The next morning

`IndexHero` (`src/components/dashboard/index-hero.tsx`): the headline number, a tier chip, `"Strength + endurance, out of 100"`, `"+0.4 over the last 7 days"`, a sessions ring, and Engine / Lab / Streak. It is a well-made, honest, clearly-labelled instrument panel. Nothing on it happened *because you trained yesterday*. It is the same card with a slightly different number.

### The verdict

**There is no reward moment. There is a receipt.** Specifically:

- **No PR detection at the moment of submission.** A personal-records table exists (`analytics/personal-records-table.tsx`) but it is on the analytics page — the athlete has to go looking for the news. Strava tells you the instant you stop the watch.
- **No "first time" acknowledgement.** `isFirstSportSession` is already computed and passed into `ScoreResultSummary` (line 53) and is **never rendered**.
- **No social loop.** No kudos, no friend saw it, no one is coming.
- **No shareable output from a session.** `ShareImageButton` is wired to exactly one thing, the interference report (§6).
- **The 6.2-second auto-redirect actively removes the moment.** The user is ejected from the one screen designed to make them feel something, before they have finished reading it and before they could act on it. Compare: Strava's post-activity screen never leaves on its own, because that screen is where kudos arrive.
- **The upsell is inside the reward.** A crown and "Start 14-day free trial →" is the second-largest element on the page celebrating the athlete's work.
- **The milestone copy is condescending.** "Elite territory awaits" is what you say to someone who is not elite.

**What Strava does that this does not:** you finish a run and within seconds you learn you took a segment, set a PR, hit a monthly-distance milestone, and three people you know reacted. Split Index tells you a number went from 71.8 to 72.4.

**The asset going unused:** Split Index can generate a reward Strava structurally cannot —

> *"That's your fastest easy run inside 48 hours of a heavy squat session. Your legs are adapting."*

That sentence requires both halves of the timeline. It is the emotional payoff form of the moat, and the data to compute it already exists in `interference.ts`.

---

## 4. Language

Term-by-term. "Explained at point of use" means a sentence in the same visual block, not a link the user must follow.

| Term | Where | Explained? | Fix |
|---|---|---|---|
| **ACWR** | `analytics/injury-risk-panel.tsx:80,90` | **Yes** — *"ACWR compares this week's training load to your rolling 4-week average"* | Model case. Leave alone. |
| **ACWR** | `analytics/acwr-trend-chart.tsx:25,63` | **No** — bare `CardTitle` "ACWR Trend" and a raw tooltip key | Retitle **"Training load vs your 4-week average"**; keep ACWR as the axis label only. |
| **ACWR** | `lib/scoring/gates.ts:131` — free-user placeholder text *"…based on your fatigue and ACWR"* | **No** | This is upsell copy shown to a user who by definition has never seen ACWR defined. Rewrite to plain English. |
| **ACWR** | `hybrid-plan/monitoring-dashboard.tsx`, `plan-view.tsx` | **No** | Same fix as the chart. |
| **DOTS** | `dashboard/gym-strength-panel.tsx:51` | **Link only** (`ScoringExplainerNote → #dots-gl`) | Acceptable — a note is present. |
| **DOTS / IPF GL** | `analytics/dots-gl-panel.tsx:23,27,56,61,67` | **No** — no `ScoringExplainerNote` on this panel at all | Add one sentence: *"Bodyweight-adjusted strength scores — how your total compares to lifters of other sizes."* Then the acronyms are fine. |
| **DOTS** | `marketing/data-tiles.tsx:11`, `data-ticker.tsx:2` | **No** — on the *acquisition* page | Highest-cost instance. A stranger reads "412.6 DOTS" and leaves. Replace with the plain-English claim; keep "DOTS" as the small print. |
| **IPF GL** | `social/feed-panel.tsx` | **No** — in a social feed, of all places | Show the tier word, not the acronym. |
| **Riegel** | `marketing/pricing-cta.tsx:22` — *"built on Riegel's formula"* | **No** — named on the marketing page | Nobody buys because of Riegel. *"Predicts your 10K from your 5K, calibrated to how your own pace fades over distance."* |
| **Riegel** | `dashboard/prediction-strips.tsx`, `analytics/race-records-panel.tsx` | Mixed | In-app, a `ScoringExplainerNote` covers most. |
| **Interference** | `layout/app-shell.tsx:40` (nav), `interference-radar-card.tsx:58` (card title) | **Partly** — the radar card asks *"Does lifting slow your cardio?"* underneath, which rescues it; the **nav item is bare** | Rename the nav item to **"Lift vs Run"** or **"Crossover"**. The nav is where the word first appears with zero context. |
| **TRIMP** | `activities/cardio-enrichment-panel.tsx:66` | **Link** (`#trimp`) | OK. |
| **Decoupling** | `cardio-enrichment-panel.tsx:94` | **Link** (`#decoupling`) | OK, and the note text *"Pacing held steady between halves"* does the real work. Good pattern. |
| **EF / Efficiency Factor** | `marketing/data-tiles.tsx:22` (`EF 0.84`), `data-ticker.tsx:3` (`EF +9.4%`) | **No** — marketing page | Cut from marketing entirely. |
| **Macrocycle** | Only in a *code comment* in `hybrid-plan/plan-view.tsx:26` | **N/A** — already removed from the UI | Nothing to do. Someone already fixed this; it is the right precedent. |
| **Intensity ceiling** | `app/api/hpe/plan/route.ts` only | **N/A** — server-side | No user impact. |
| **"Calibrating"** | `success-screen.tsx:192`, `activities/[id]/page.tsx:258` — *"Calibrating — 2/5 sessions logged"* | **No** | Reads like the app is broken. Say **"Needs 3 more runs before we'll predict your 5K — we won't guess."** Same words, and the honesty becomes a selling point instead of an error state. |
| **"Calibrating…"** | `analytics/stored-predictions-panel.tsx:107` — bare, no count | **No** | Worse: no progress shown at all. Show `n/5`. |
| **"Tier 2"** | Internal only (`tier2IsCalibrating`) | **N/A** | Never surfaced. Good. |
| **"Split Index"** | Everywhere | **In-app yes** (`IndexHero`: *"Strength + endurance, out of 100"`) — **on the landing page, no** | The marketing site never defines its own product name. |

**Additional non-jargon language problems:**

- `retention/empty-dashboard-hero.tsx:31-49` — the **first screen a new user sees**. Headline *"Your index is unwritten"*; four bullets: *"Per-sport comparative scoring" / "Hybrid 50/50 composite index" / "Session-to-session sport deltas" / "AI coach on score breakdown"*. That is a spec sheet written by an engineer. Zero of it is a reason to log a workout. This screen, more than any other, is the answer to "does not entice you to start logging."
- `milestone-toast.tsx:55` — *"elite territory awaits"*.
- `marketing/data-tiles.tsx:55` — the heading *"Data that actually means something"* is a promise the tiles below it break.

---

## 5. Monetisation appeal

### Prices

`src/lib/pricing/config.ts` — annual £29.99, lifetime £79.99, monthly from `PREMIUM_PRICE_GBP`, 14-day trial, activation paywall re-shown at 3 sessions.

**The prices are good.** £29.99/yr undercuts Strava (~£55), Whoop (~£229) and TrainingPeaks (~£95) decisively. Lifetime at £79.99 = 2.7 years of annual is a genuinely attractive offer for the early-adopter cohort a launch attracts, and it converts skeptics who won't start a subscription. Nothing here needs changing.

### Is free generous enough to hook? Yes — but it doesn't know it.

`FREE_TIER_FEATURES` gives full logging, all sports, CSV import, the current Split Index, per-workout cardio index, and a country leaderboard preview. Crucially, **the Interference Radar and the Hybrid Plan are both free** (`hybrid-plan` is gated by `hpe/rollout.ts`, not by subscription — a fact the code comment in `features.ts:85-91` is admirably honest about).

So the free tier includes the two most differentiated things in the product and the marketing page advertises neither as free. The free column reads: *"Full workout logging (all paths)"*, *"Current Split Index & per-workout cardio index"*, *"Last 7 days on dashboard"*, *"Rules-based training snippet"*. That is a list of restrictions with ticks next to them. "Rules-based training snippet" is a phrase that makes a free user feel they are being given the cheap version of something.

### Is paid compelling enough to convert? Not as written.

`PREMIUM_TIER_FEATURES` leads with Injury Risk Index, AI Coach, race predictions, DOTS/IPF GL, TRIMP/EF/decoupling, 90-day trends, projections, leaderboards, export. Every one of those exists elsewhere: injury risk ≈ Whoop strain, AI coach ≈ every app in 2026, race predictions ≈ Garmin, DOTS ≈ free calculators, TRIMP/EF ≈ TrainingPeaks, leaderboards ≈ Strava.

**The paid tier is sold entirely on the commodity half of the product.** Nothing in the premium list is something only Split Index can do. The unique thing is free and unmentioned.

There is a coherent fix that keeps the hook free: sell **interference depth**, not interference. Free gets the headline finding ("lifting costs you ~4% efficiency the next day"). Premium gets the recovery-window recommendation, the per-lift breakdown (is it squats or deadlifts), the trend over training blocks, and — the real product — the Hybrid Plan that *schedules around your own measured interference*. That is a premium feature no competitor can build, and it is already computed.

### Premium walls on the dashboard — count: **five**

For a free user with ≥3 sessions logged, in scroll order through `app/(app)/dashboard/page.tsx`:

1. **`AICoachCard` header link** — *"Unlock with Premium for GPT-powered analysis →"* (`workout-list.tsx:264`)
2. **`AICoachCard` body `PremiumTease`** — blurred content behind a lock icon (`workout-list.tsx:326`) — *the same card, twice*
3. **Activation paywall `PremiumTease`** — *"Start your 14-day free trial"* over the trend panel (`page.tsx:706`)
4. **8-week projection `PremiumTease`** — *"Premium unlocks trend projections, 90-day history, and period comparisons."* (`page.tsx:755`)
5. **"Beat the next rank" `PremiumTease`** — `showPreview={false}`, so it is a lock icon and an ad occupying a card slot with no content behind it (`page.tsx:800`)

Plus, invisibly, four strings in the AI feedback object itself are replaced with *"— unlocked with Premium"* (`gates.ts:128-135`), which is where wall #2's blurred text comes from.

**Motivating or nagging?** Nagging, and three specific things make it worse than the count suggests:

- **Wall #5 has nothing behind it.** `showPreview={false}` means a card-sized advertisement sits in the grid. Walls that blur *real* content ("here is your thing, slightly out of reach") motivate. Walls that show a padlock in an empty box are billboards.
- **Every tease carries a legal disclaimer.** `PremiumTease` renders *"Scores are training estimates only — not medical advice."* (`premium-tease.tsx:55-57`) inside every single one. The sales pitch contains a hedge. On a dashboard with five teases, the user reads that disclaimer five times.
- **The blurred numbers are fake.** `gateCardioEnrichment` substitutes `trimp: 112`, `EF 0.84`, `decoupling 3.1%` for free users. It is behind blur today, but a user who inspects it, or a rendering path that misses the blur, discovers the app showed them invented physiological data. For an app whose entire pitch is "honest, evidence-based, mined from your own history," this is the highest-severity trust risk in the codebase. Blur real data or blur nothing.

Recommendation: **five walls → two.** Merge the two AI Coach walls into one. Delete #5 outright (or give it real content). Keep the activation paywall (it is well-timed at 3 sessions — that is a good call) and one content tease. Remove `ScoreDisclaimer` from `PremiumTease` and let the page-level `ScoreDisclaimer` at `page.tsx:865` carry it.

---

## 6. Shareability

**There is exactly one shareable artefact in the product.**

`ShareImageButton` (`src/components/analytics/share-image-button.tsx`) is well-built — Web Share API Level 2 with file sharing, native share sheet on mobile, tab-open fallback on desktop. It is used in exactly two places, both rendering the same image: `interference-radar-card.tsx:61` and `interference-detail.tsx:189`. It is gated on `hasShareableFinding(report)`, which needs paired history.

The image itself (`app/api/interference/report-card/route.tsx`) is a dark card: name, the finding sentence at 46px, a secondary line, and `splitindex.app/interference`. **It is the right thing to share** — "here is what leg day does to my running" is a genuinely novel thing to post, it is about the poster, and it is unanswerable by any other app. Someone would post that.

Everything else is missing:

- **No PR share.** The single most-posted fitness moment in existence.
- **No session share.** You finish a workout and there is no way to show anyone.
- **No Split Index card.** The product's own headline number cannot be shared.
- **No streak or milestone share.** `MilestoneToast` fires and vanishes in 5 seconds with no action.
- **No weekly recap.** The highest-yield recurring share format in the category.
- **The OG image is the logo** (`app/layout.tsx:45`). Every link anyone pastes into Discord, WhatsApp, Reddit or a group chat previews as a wordmark on a bar. This is free distribution being thrown away.
- **The Hybrid Plan card route exists** (`app/api/reports/hybrid/card/route.tsx`) and **is wired to no button anywhere.** An asset already built and unreachable.

The social layer (`src/components/social/` — friends, squads, duels, challenges, achievements, leaderboards) is substantial, but it is all *inside* the app. There is no path from a Split Index moment to a place where non-users are. That is the difference between a social feature and a growth loop.

---

## 7. Name and positioning

**"Split Index" — clear to a stranger in three seconds? No, but it is worth keeping.**

The failure mode is specific: "split" in fitness vocabulary already means *training split* (push/pull/legs). A lifter reading "Split Index" assumes a program-tracking app. The intended meaning — the split *between* two disciplines, and the seam where they meet — is a good idea that arrives second.

It is rescued instantly by one line of context, and the tagline in `brand-mark.tsx:62` already is that line:

> **"Two worlds · one score"**

That tagline is behind an opt-in prop (`showTagline`, default `false`) and is **not enabled on the landing page header** (`landing-page.tsx:16` uses `variant="full"`, the image lockup). Turning it on is a one-word change.

**"The Lab" and "The Engine" are excellent and should be pushed harder.** They are memorable, they map cleanly (Lab = controlled, measured, strength; Engine = output, endurance), they are colour-coded consistently through the entire app, and they give users vocabulary to talk about the product to each other — "my Engine is way behind my Lab" is a sentence a user will say out loud. That is rare and valuable. They are also correctly used in the nav (`app-shell.tsx:32-33`) with `shortLabel` fallbacks. No change needed.

**The positioning line is the problem, not the names.** Current meta description: *"The premium analytics platform for hybrid athletes."* Category-generic. It should be the interference claim.

---

## Top 5 changes before launch

Ranked by (impact on desire to use) ÷ (effort).

### 1. Put the hook in the `<h1>`, and make the hero work on a phone
**Effort: hours. Impact: decides whether anyone signs up.**

Two edits to `src/components/marketing/hero-split.tsx`:

- **Change the headline.** Keep LIFT HEAVY / RUN FAR as the panel eyebrows if you love them, but the `<h1>` must carry the claim. Lift the copy that already exists at `pricing-cta.tsx:11-13` verbatim: *"See how lifting and running actually affect each other."* Sub-line: *"Split Index measures what leg day does to your 10K — and what your 10K does to your squat — from your own training history. No other app has both halves on one timeline."*
- **Un-hide the composite ring, seam and hook on mobile.** Remove `hidden md:block` from lines 181, 187 and 201. Static seam and a centred ring below the two stacked panels is fine — the drag interaction can stay desktop-only. Right now the product's entire thesis is invisible to phone visitors.

Then update `app/layout.tsx:37` and the OpenGraph description to match, and replace `product-showcase.tsx`'s two-cards-side-by-side mock with the Interference Radar — it currently depicts the product the copy explicitly disavows.

### 2. Rewrite the empty dashboard and promote the Interference Radar above the fold
**Effort: hours. Impact: this is literally the "does not entice you to start logging" screen.**

- `retention/empty-dashboard-hero.tsx` — bin *"Per-sport comparative scoring / Hybrid 50/50 composite index / Session-to-session sport deltas."* Replace with the promise the radar card already makes when empty: *"Log a lift and a run and we'll show you something no other app can — how your lifting and your running are affecting each other."* Then one CTA, not four.
- `app/(app)/dashboard/page.tsx` — move `InterferenceRadarCard` (line 703) to slot 3, directly under `IndexHero` and `TodaysSessionCard`, above the prediction strips. Render it for new users too (currently inside `{hasActivities && …}`) — its empty state is the best acquisition copy in the app and nobody sees it.
- Rename the nav item from "Interference" to "Lift vs Run" (`layout/app-shell.tsx:40`).

### 3. Turn the success screen into a moment
**Effort: 1–2 days. Impact: this is the entire retention loop.**

In `activities/success-screen.tsx`:

- **Kill the 6.2s auto-redirect** (`REDIRECT_AFTER_MS`). Never eject a user from the reward screen. Leave the explicit buttons.
- **Render `isFirstSportSession`** — it is already computed, already passed in, and already ignored (line 53).
- **Detect and celebrate a PR at submit time.** The data is there; the personal-records table just lives on another page. "Heaviest squat you've logged" belongs here, not in analytics.
- **Add the crossover line** — the payoff only this app can produce: *"Fastest easy run you've done within 48h of a heavy squat session."* Compute from `interference.ts`.
- **Add a share button** to the success screen (§4 below).
- **Move the premium upsell below the fold** of this screen, and rewrite `milestone-toast.tsx:55` — "elite territory awaits" is condescending.

### 4. Give people something to post
**Effort: 1 day (the generator, the button and the fallback all exist). Impact: the only free distribution channel.**

- **Fix the OG image.** `app/layout.tsx:45` currently previews every shared link as a bare logo. Ship a real one carrying the split visual and the hook sentence. Highest ratio of impact to effort in this document.
- **Wire `ShareImageButton` to the success screen** — session card with the score, the sport, the delta, and any PR.
- **Wire the orphaned Hybrid Plan card route** (`app/api/reports/hybrid/card/route.tsx`) to a button. It is built and unreachable.
- **Pick one domain.** `splitindex.co.uk` (showcase mock) vs `splitindex.app` (share card footer). The share card is the one strangers read.

### 5. Halve the dashboard paywalls and repoint what Premium sells
**Effort: hours for the walls; a pricing decision for the repositioning. Impact: conversion, and it stops the free tier feeling punitive.**

- **Five walls → two.** Merge the duplicated AI Coach walls (`workout-list.tsx:264` and `:326`). Delete the contentless "Beat the next rank" tease (`page.tsx:800`, `showPreview={false}`) — a padlock in an empty card is a billboard. Keep the 3-session activation paywall; it is well-timed.
- **Remove `ScoreDisclaimer` from `PremiumTease`** (`premium-tease.tsx:55-57`). The page-level disclaimer already covers it. A sales pitch should not contain a hedge, five times per screen.
- **Stop blurring fabricated data.** `gateCardioEnrichment` (`gates.ts:104-112`) substitutes invented TRIMP/EF/decoupling values. Blur the real numbers or show a locked shape with no numbers at all. For a product selling honesty, this is the wrong corner to cut.
- **Repoint the premium pitch** (`premium/features.ts:68`). Lead with interference *depth* — recovery-window recommendation, per-lift breakdown, block-over-block trend, and a Hybrid Plan that schedules around your own measured interference — instead of leading with ACWR and DOTS, which every competitor also sells. And say on the marketing page that the Interference Radar is free; it is the strongest thing in the free tier and the pricing table hides it.

---

*Assessed against `src/app/page.tsx`, `src/components/marketing/`, `src/components/brand/`, `src/app/globals.css`, `src/app/(app)/dashboard/page.tsx`, `src/components/dashboard/`, `src/components/activities/success-screen.tsx`, `src/components/premium/`, `src/components/analytics/`, `src/components/social/`, `src/lib/scoring/index-engine.ts`, `src/lib/scoring/interference.ts`, `src/lib/scoring/gates.ts`, `src/lib/scoring/hpe/`, `src/lib/pricing/config.ts`, `src/lib/premium/features.ts`. No source files were modified.*
