# UI / Visual audit — mobile (390×844, iPhone-class)

Audited against the owner's standing rule:

> "I don't want to have to scroll very much at all in the app — all the key information should be
> available on the screen you see. Nothing should scroll side to side."

Scope: every screen under `src/app/(app)` and the components in `src/components`.

## Method and the measuring stick

Code read throughout. Where a number appears below it was **measured**, not estimated: the project's
own `globals.css` was compiled with `@tailwindcss/cli@4` and the real class strings for the shell,
the dashboard, the Lab, the Engine and Analytics were rendered at 390×844 in a browser and measured
with `getBoundingClientRect()`. Authenticated screens cannot be driven end-to-end (no login), so
screens not in that list were assessed by reading the JSX and Tailwind classes.

The fold arithmetic everything below uses:

| Band | y (px) | Where it comes from |
|---|---|---|
| Top of content | **71** | `app-shell.tsx:397` — `pt-[max(1.5rem,calc(env(safe-area-inset-top)+0.75rem))]`, i.e. 59 + 12 |
| `AppTopBar` | 71 → **107** | measured 36px tall |
| First content block | **123** | after `mb-4` |
| Bottom nav starts | **743** | measured: the nav is **101px** tall (icon 24 + gap 4 + 10px label + `py-2` + `pt-1.5` + 34px home indicator) |

**So the visible content window on an iPhone is 123 → 743 — 620 usable pixels.** Not the ~700 the
airier screens are built as though they have.

---

# CRITICAL

## C1 — Analytics: the entire first screen is a title, a filter bar and four stat tiles. No data.

**File:** `src/components/analytics/analytics-client.tsx:272`
**Screen:** `/analytics`

Measured at 390×844:

| Block | y |
|---|---|
| `PageHeader` "Performance / Analytics / Deep performance insights…" | 123 → 238 |
| `AnalyticsFilters` | 262 → 322 |
| Four summary stat cards | 346 → **742** |
| `StoredPredictionsPanel` (race ladder + 1RM predictions) | 766 → *below the nav* |

`grid gap-4 sm:grid-cols-2 lg:grid-cols-4` has **no base-width column count**, so at 390px it falls
back to one column: four `padding="sm"` cards (`p-5`, ~86px each) stacked, 396px of screen to show
four numbers. The comment above `StoredPredictionsPanel` says it was deliberately promoted "above
every graph on this page" because it is the most actionable content on the tab — and it lands
entirely under the bottom nav.

**Fix:** `className="grid grid-cols-2 gap-3 lg:grid-cols-4"`. Two-by-two puts the four tiles in
~190px instead of 396px and lifts the predictions panel to ~y560, on screen. Consider `padding` on
those tiles dropping to `p-3.5`.

## C2 — Dashboard: the Lift Prediction strip falls under the bottom nav on any two-session plan day.

**Files:** `src/app/(app)/dashboard/page.tsx:662` (`TodaysSessionCard variant="band"`), `:669-680`
(the two strips)
**Screen:** `/dashboard`

The dashboard is genuinely well-tuned — the header comment at `dashboard/page.tsx:588` sets out the
four-block first screen and it very nearly holds. Measured with the real band markup:

| Block | y (1-session day) | y (2-session day) |
|---|---|---|
| `IndexHero` | 149 → 359 | 149 → 359 |
| `TodaysSessionCard` band | 369 → 497 (128px) | 369 → **547** (178px, measured) |
| `RacePredictionStrip` | 509 → 633 | 559 → 683 |
| `LiftPredictionStrip` | 645 → **760** | 695 → **810** |
| Nav covers from | 743 | 743 |

On a one-session day the lift strip's bottom row (`best 160×3`) is clipped; on a two-session day —
the normal case for a hybrid athlete, which is the whole product — **more than half the lift strip is
behind the nav.** Block 4 of the stated four-block first screen does not make it.

**Fix, cheapest first:**
1. Put the two strips side by side on phones: `dashboard/page.tsx:670` →
   `className="grid grid-cols-2 gap-2 lg:grid-cols-2"`. Each strip's inner grid then needs
   `grid-cols-3` (races: drop 1500m and Full to the analytics page) and `grid-cols-3` stays for
   lifts. Saves ~125px and both land above the fold in every case.
2. Or cap the band at one session on phones and name the second (`todays-session-card.tsx:167`,
   `slice(0, 2)` → `slice(0, 1)` with the existing "+1 more" affordance).

## C3 — Hybrid Plan: today's prescribed session is below the fold, under a 320px "how tailored this is" card.

**File:** `src/components/hybrid-plan/hybrid-plan-screen.tsx:423-490` (tailoring card), `:497` (tabs),
`:514` (`PlanView`)
**Screen:** `/hybrid-plan`

Order on screen: `PageHeader` (~100px, two-line subtitle) → the "How tailored this is" card (eyebrow
+ h2 + confidence pill + explanation paragraph + a three-item "what your next sessions unlock" box,
~320px) → the four-tab bar (~52px) → `PlanView`, whose first element is *the day itself*
(`plan-view.tsx:140-142`, commented "First on screen, biggest thing on it").

That puts `DayDetail` at roughly y652 with the nav at 743 — about 90px, enough for its heading and
nothing else. The dashboard band exists precisely because "what do I do today" is the question; the
plan screen itself answers it below the fold.

**Fix:** move the tailoring card *below* `PlanView` (it is context for the plan, not a gate in front
of it), and collapse it to a one-line summary with a disclosure. Drop the `PageHeader` subtitle on
phones (`sm:block` on the `<p>` in `page-header.tsx:34`) — "Built from 14 findings in your own
logged history. Limiter: aerobic base." is two lines that repeat what the diagnostic tab is for.

## C4 — The Engine (`/cardio`): a third of the first screen is a title and a marketing sentence.

**File:** `src/app/(app)/cardio/page.tsx:79-128`
**Screen:** `/cardio`

Measured at 390×844:

| Block | y |
|---|---|
| Zone card top | 123 |
| Eyebrow + "Endurance HQ" + the description paragraph | 147 → 280 |
| Log manually / Start GPS tracking | 296 → 340 |
| "Endurance Blend" card (`p-8`, `text-6xl`) | 372 → 569 |
| "Session history" | 601 → 650 |
| Nav covers from | 743 |

`cardio/page.tsx:86` — *"Pace, split, and W/kg vs sport-specific benchmarks — ranked against your own
session history."* — wraps to five lines at 390px and costs ~115px. It is product copy on a screen
the athlete visits daily. The `p-6` zone padding plus the blend card's `p-8` plus two `mb-8`s spend
another ~130px on air. Net result: **one number and roughly two logbook rows above the fold.**

**Fix:**
- `:86` → `className="mt-2 hidden max-w-lg text-sm leading-relaxed text-cardio-muted sm:block"`.
- `:79` → `className="p-4 sm:p-10"`.
- `:107` → `className="glass-cardio rounded-2xl p-5 mb-5"` and `:111` → `text-5xl sm:text-7xl`.
- `:80` / `:105` — `mb-8` → `mb-5`.

Together these lift "Session history" from y601 to ~y400 and put five or six sessions on screen.

## C5 — `<option className="bg-slate-900">` is unreadable on the cardio light theme.

**File:** `src/components/ui/input.tsx:74`
**Screens:** `/cardio/log` (via `activities/sport-form.tsx`), `/cardio/gps-run` (`page.tsx:10`)

Under `[data-mode="cardio"] .mode-content` (`globals.css:279-290`) `--foreground` is remapped to
`--cardio-text` (`#0c1a24`). The `<select>` correctly renders dark-on-light. Its `<option>`s inherit
that dark text but carry a hard-coded `bg-slate-900` (`#0f172a`) — **dark text on a near-black
background, contrast ≈ 1.02:1.** The `[class*="bg-white"]` escape hatch at `globals.css:297` does not
match `bg-slate-900`, so nothing rescues it. iOS renders `<select>` as a native picker and hides the
bug; the Android WebView and every browser show it.

**Fix:** delete `className="bg-slate-900"` at `input.tsx:74` and let the option inherit, or use a
mode-aware token: `className="bg-background text-foreground"` with `--background` explicitly set on
the option under cardio. (`gym-form.tsx:463,467,472,1377` carry the same class but only ever render
on the dark Lab surface — leave them or migrate them together.)

## C6 — Hidden horizontal scrollers. Six of them, all the pattern the 7-tab social strip was fixed to escape.

`social-hub.tsx:104-113` records the rule: *"A grid, not a scroller… reaching them meant swiping a
strip whose scrollability nothing on screen advertised."* Six places still do exactly that, four of
them with the scrollbar explicitly suppressed.

| # | File:line | What scrolls | Width needed vs 358px available |
|---|---|---|---|
| a | `activities/activity-form.tsx:722` | Sport switcher, 9 sports × `h-11 w-11` + `gap-1.5` | **444px** — and `[&::-webkit-scrollbar]:hidden` |
| b | `activities/gym-form.tsx:1604` | Muscle-group filter, 7 chips (`All…Core`) | ~420px |
| c | `gym/gym-quick-start.tsx:49` | 6 preset plans at `w-[200px]`, `snap-x` | ~1218px |
| d | `activities/log-quick-actions.tsx:196` | "Start from" past-workout cards, `snap-x` | scrollbar hidden |
| e | `activities/logbook-feed.tsx:293` | Zone filter chips (`-mx-4 … sm:flex-wrap`) | mobile-only scroller |
| f | `activities/gym-workout-timer.tsx:469` | Rest-timer strip, `h-8` | scrollbar hidden |

**Fixes (all are grids of known, small cardinality — the social-hub pattern applies verbatim):**
- (a) → `className="mb-6 grid grid-cols-5 gap-1.5"` — 9 icons, two rows, all visible.
- (b) → `className="grid grid-cols-4 gap-1"` — 7 chips, two rows. Also raise `min-h-[32px]` → `min-h-11`.
- (c) → `className="grid grid-cols-2 gap-3"` and drop `w-[200px]` for `w-full` — 6 plans, 3 rows,
  and on mobile this block is already last on the page (see M3).
- (d) → `grid grid-cols-2 gap-2` with `slice(0, 4)`.
- (e) → `className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap"` — the stated reason for the
  scroller ("a wrapped chip row pushes the first session below the fold") is answered by a fixed
  3-column grid, which is a known 2 rows rather than an unbounded wrap.
- (f) Timer strip: this one is a live readout, not navigation. `flex-wrap` it.

---

# HIGH

## H1 — Race prediction strip breaks at 320px; the Split Index tier pill is clipped there too.

**File:** `src/components/dashboard/prediction-strips.tsx:96`; `src/components/dashboard/index-hero.tsx:99-106`

Measured at 320×844 (iPhone SE 1st gen / smallest supported width), overflow detection reported:

```
DIV.grid grid-cols-5 gap-1                 259 > 254
DIV.rounded-lg … text-center (Half)         53 > 48
P.…text-[13px]… "1:31:12"                   49 > 40   ← clipped
P.…text-[13px]… "3:10:48"                   49 > 40   ← clipped
DIV.flex items-baseline gap-2 (72.4 + tier) 184 > 164 ← clipped by Card's overflow-hidden
```

At 390px both fit with ~0px to spare; at 320px a half-marathon and marathon prediction are visually
truncated, and the "ADVANCED / ELITE" tier pill beside the headline score is cut off by
`overflow-hidden` on the hero Card (`index-hero.tsx:93`).

**Fix:** `prediction-strips.tsx:96` → `grid grid-cols-3 gap-1` on phones (5K / 10K / Half; move
1500m and Full to `/analytics`), or keep five and drop the cell type to
`text-[11px] sm:text-[13px]`. `index-hero.tsx:99` → add `flex-wrap` and `min-w-0` so the pill drops
to its own line rather than being clipped.

## H2 — Two `overflow-x-auto` tables with `min-w` larger than a phone card.

**File:** `src/components/hybrid-plan/event-day-view.tsx:91-92` and `:178-179`
**Screen:** `/hybrid-plan` → Event day tab

- Attempt selection: `<table className="w-full min-w-[22rem]">` = **352px** minimum inside a
  `Card` whose content box at 390px is **318px**. Guaranteed side-scroll.
- Race pacing: `min-w-[20rem]` = 320px inside 318px. Scrolls by 2px — a scrollbar and a jiggle for
  nothing.

Both are genuinely tabular, but neither needs its floor. Attempt selection is Lift / Opener /
Second / Third — four short numeric columns that fit in 318px comfortably. Race pacing's fourth
column header "On the clock" is what forces the width.

**Fix:** delete `min-w-[22rem]` outright (`:92`). For `:179`, delete `min-w-[20rem]` and shorten the
header to "Clock" with `className="pb-2 text-right font-medium"`; drop the per-split `deltaLabel`
span to a second line inside the Pace cell on phones. Remove both `overflow-x-auto` wrappers once
the floors are gone, so a future regression is visible rather than silently scrollable.

## H3 — Hybrid Plan tab bar overflows the page at 320px.

**File:** `src/components/hybrid-plan/hybrid-plan-screen.tsx:497-511`

`flex gap-1.5 … p-1.5` with four `flex-1 px-3 py-2.5 text-sm` buttons. Flex items default to
`min-width: auto`, so they will not shrink below their content: Plan + Goals + Diagnostic +
Event day ≈ 320px of content plus 24px of gaps and padding. At 358px (390 viewport) it fits by
~13px; at 288px (320 viewport) it **overflows the container and gives the whole page a horizontal
scrollbar** — the one thing the standing rule forbids outright.

**Fix:** `className="grid grid-cols-4 gap-1.5 rounded-2xl bg-white/[0.03] p-1.5"` and on the buttons
`className="min-w-0 truncate rounded-xl px-2 py-3 text-sm font-medium"`. This also raises the tap
target from 40px to 44px (see H5).

## H4 — Page content is 5px shorter than the bottom nav.

**File:** `src/components/layout/app-shell.tsx:397` (`pb-24`) vs `:319` (the nav)

`pb-24` is 96px. The nav measures **101px** with a 34px home indicator. The last 5px of every page —
including the `ScoreDisclaimer` at `dashboard/page.tsx:865` — sits under the nav bar with no way to
scroll it clear.

**Fix:** `pb-[calc(6.5rem+env(safe-area-inset-bottom))] lg:pb-8`.

## H5 — Touch targets under 44×44 on primary controls.

The design system is right — `button.tsx:26-31` sizes every variant at `h-11` or larger. The
failures are all hand-rolled controls outside it.

| File:line | Control | Size |
|---|---|---|
| `layout/app-top-bar.tsx:21` | **Back button** — the most-tapped control in the app | 36×36 |
| `layout/app-shell.tsx:291` | "More" sheet close (X) | ~24×24 |
| `retention/complete-profile-banner.tsx:36` | Dismiss banner | ~24×24 |
| `retention/friend-invite-banner.tsx:38` | Dismiss banner | ~24×24 |
| `dashboard/goals-card.tsx:287` | Edit/delete a goal | ~24×24 |
| `social/compare-modal.tsx:94` | Close modal | ~28×28 |
| `social/friends-panel.tsx:225` | Remove a friend (destructive) | ~28×28 |
| `analytics/analytics-filters.tsx:93` | W / M / Y granularity | 32×32 |
| `activities/gym-form.tsx:1615` | Muscle-group chips | `min-h-[32px]` |
| `activities/activity-form.tsx:677,684,699` | Discard-draft confirm / cancel | `min-h-[32px]` |
| `activities/gym-workout-timer.tsx:435,462,523` | Timer +30s / reset / dismiss | 32–36px |
| `activities/interval-blocks.tsx:291,302` | Duplicate / delete an interval | 40×36 |
| `activities/gym-form.tsx:867,1084` | Delete a set | 40×40 |
| `activities/fields.tsx:439` | RPE / session-type pills | `min-h-[40px]` |
| `globals.css:618-628` | `.logbook-filter-chip` | ~27px tall |
| `hybrid-plan/hybrid-plan-screen.tsx:505` | Plan / Goals / Diagnostic / Event day | 40px |

**Fix:** the icon-only ones take `h-11 w-11` (and `-m-1` to keep the visual box small while the hit
area grows). The pill/chip ones take `min-h-11`. `fields.tsx:439` already carries a comment about
having been raised from ~30px to 40px — finish the job to 44. `.logbook-filter-chip` →
`padding: 0.75rem 0.9rem`.

---

# MEDIUM

## M1 — The cardio white-alpha remap is an always-on rule, so hover/active states are permanently on.

**File:** `src/app/globals.css:293-299`

```css
[data-mode="cardio"] .mode-content [class*="bg-white"]  { background-color: rgba(12,26,36,0.04); }
[data-mode="cardio"] .mode-content [class*="border-white"] { border-color: rgba(12,26,36,0.12); }
```

An attribute substring selector matches `hover:bg-white/5` and `active:bg-white/[0.06]` exactly as
readily as `bg-white/5`, and the rule is **not** scoped to `:hover`. At specificity (0,3,0) it also
beats Tailwind's own `.hover\:bg-white\/5:hover` at (0,2,0). Two consequences on every `/cardio`
route:

1. A `Button variant="ghost"` (`button.tsx:14`, whose only white utility is `hover:bg-white/5`)
   renders with a permanent grey fill — it stops reading as a ghost button.
2. Nothing on the cardio theme can ever change background on press. Every `active:bg-white/[…]`
   press state is dead.

**Fix:** split the rule so the interactive variants keep their pseudo-class:

```css
[data-mode="cardio"] .mode-content [class*="bg-white"]:not([class*=":bg-white"]) { … }
[data-mode="cardio"] .mode-content [class*="hover:bg-white"]:hover { background-color: rgba(12,26,36,0.06); }
[data-mode="cardio"] .mode-content [class*="active:bg-white"]:active { background-color: rgba(12,26,36,0.09); }
```

The same applies to `[class*="text-white"]` at `globals.css:324`.

## M2 — The cardio text remap flattens every opacity step to one colour.

**File:** `src/app/globals.css:324-326`
**Screen:** `/cardio/gps-run`, review phase (`page.tsx:1170+`, rendered in place — unlike the
tracking HUD at `:750`, which correctly `createPortal`s to `document.body` to escape this exact rule)

`[class*="text-white"] { color: var(--cardio-text) }` collapses `text-white`, `text-white/60` and
`text-white/50` to the identical full-strength dark. On the GPS run review card
(`gps-run/page.tsx:1191-1205`) the "Distance" caption and the "5.02 km" value end up the same
colour; the label/value hierarchy the layout depends on disappears. It is legible, so this is a
design regression rather than an accessibility failure.

**Fix:** add graded overrides after the blanket rule:

```css
[data-mode="cardio"] .mode-content [class*="text-white/6"],
[data-mode="cardio"] .mode-content [class*="text-white/5"] { color: var(--cardio-muted); }
[data-mode="cardio"] .mode-content [class*="text-white/4"],
[data-mode="cardio"] .mode-content [class*="text-white/3"] { color: var(--muted-foreground); }
```

Longer term, the GPS review card should use `text-foreground` / `text-muted` tokens like the rest of
the app and stop relying on the remap at all.

## M3 — The Lab: "start a workout" is the last thing on the page on a phone.

**File:** `src/app/(app)/gym/page.tsx:208` (`grid gap-8 lg:grid-cols-[1fr_380px]`), `:243`

The right rail holds `GymQuickStart` — preset plans, saved templates and the big "Start blank
session" button. On desktop it is a sticky sidebar; on a phone the grid collapses and it renders
**after** `GymStrengthPanel`, `RecommendedSplitCard`, `WorkoutPlansDisclosure` *and the entire
paged logbook*. The primary action of the strength zone is several screens down.

Measured first screen (`/gym`): Log-session button 148→192, `GymStrengthPanel` 236→517,
`RecommendedSplitCard` 549→642, `WorkoutPlansDisclosure` 674→731. Reasonable — but only because
quick-start is nowhere near it.

**Fix:** render `GymQuickStart` above the logbook on mobile — `order-first lg:order-none` on the
`<aside>` won't work across a grid-column collapse, so hoist it: put `<GymQuickStart />` inside the
left column before `<LogbookFeed>` wrapped in `lg:hidden`, and keep the `<aside>` copy `hidden
lg:block`. Also `min-h-[80vh]` at `:189` should be `min-h-[80dvh]` (see M6).

## M4 — Profile: a 96px decorative gradient banner sits at the top of the fold.

**File:** `src/components/profile/profile-header.tsx:72`, `:117`

`<div className="h-24 bg-gradient-to-r …" />` carries no information and costs 96px — 15% of the
620px window. The header block totals ~438px, so `ProfileForm` starts at ~y585 and shows about two
fields before the nav.

Separately, `:117` is `grid grid-cols-3 sm:grid-cols-5` with **five** stats, so on a phone the last
two sit alone on a second row with a hole beside them.

**Fix:** `:72` → `className="h-12 bg-gradient-to-r … sm:h-24"`. `:117` →
`className="mt-6 grid grid-cols-5 gap-1.5 sm:gap-3"` and drop the stat tiles to `p-2 text-center`
with `text-base` values — five across fits at 390px and saves a whole row.

## M5 — Long forms other than the activity form get no keyboard handling.

**File:** `src/components/activities/use-keyboard.ts` (both hooks) — used **only** by
`src/components/activities/activity-form.tsx:233-234`

The hooks themselves are excellent and the WKWebView reasoning in the docblock is correct. But the
other long forms in the app never call them:

| Screen | File | Fields |
|---|---|---|
| `/hybrid-plan/intake` | `hybrid-plan/intake-wizard.tsx` | many, multi-step |
| `/onboarding` | `onboarding/onboarding-flow.tsx` | many |
| `/profile` | `profile/profile-form.tsx` | ~10 |
| Goals modal | `dashboard/goals-card.tsx` | 3 in a sheet |
| Add race | `analytics/upcoming-races-panel.tsx` | 4 |
| Create squad | `social/squads-panel.tsx` | 2 |

On iOS the keyboard does not resize the layout viewport, so any field in the lower half of these
forms is typed into blind — the exact complaint quoted at `use-keyboard.ts:16`.

**Fix:** each of these gets `const formRef = useRef<HTMLElement>(null)` +
`useKeyboardSafeFocus(formRef)` on the scroll container. Intake and onboarding also want
`useKeyboardInset()` on their sticky Next/Back bars, as `activity-form.tsx:783` already does.

## M6 — Bottom-sheet modals ignore the home indicator; one uses `vh` instead of `dvh`.

| File:line | Issue |
|---|---|
| `social/compare-modal.tsx:76` | `flex items-end … p-4` — sheet bottom sits 16px from the physical edge, inside the 34px home-indicator zone |
| `activities/delete-activity-modal.tsx:46` | same |
| `activities/merge-activities-modal.tsx:152` | same |
| `activities/merge-activities-modal.tsx:159` | `max-h-[85vh]` — `vh` is the pre-keyboard viewport on iOS, so with the keyboard open the sheet is taller than the visible area |
| `gym/page.tsx:189` | `min-h-[80vh]` — same class of bug the shell already fixed with `min-h-dvh` (`app-shell.tsx:149`) |

**Fix:** on the three `p-4` overlays → `className="… p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"`.
Replace both `vh` values with `dvh`.

## M7 — Two `<select>` elements under 16px will permanently zoom the iOS WebView.

**Files:** `src/components/analytics/analytics-filters.tsx:76` (`text-xs`),
`src/components/activities/logbook-feed.tsx:322` (`text-xs`)

`input.tsx:26-30` documents the rule and the consequence in full: *"iOS auto-zooms into any input
whose font-size is under 16px, and since this is an SPA … that zoom doesn't reset when you leave the
page, leaving the whole app looking 'zoomed in and not fitting' afterward."* Both of these are raw
`<select>`s that bypass the `Select` component and its `text-base`.

**Fix:** `text-base` on both (they can keep their `h-9` box; `leading-none` keeps the height).
Better: route both through `<Select>` from `components/ui/input`.

## M8 — `BlockOverview` week bars scroll sideways on any block longer than 13 weeks.

**File:** `src/components/hybrid-plan/plan-view.tsx:242`, `:257`

`flex … overflow-x-auto` with `min-w-[1.35rem]` (21.6px) per bar plus `gap-[3px]`. Available inside
a `Card` at 390px is 318px → 13 bars fit; a 16-week block needs 391px and a 20-week block 489px.
Week labels are `text-[0.6rem]` (9.6px).

**Fix:** drop `min-w-[1.35rem]` and let `flex-1` do its job (`flex-1 min-w-0`); the bars get thinner
rather than the strip getting wider. Show the week number only every 4th bar
(`{w.week % 4 === 1 && …}`) at `text-[10px]`, and remove `overflow-x-auto`.

---

# LOW

## L1 — Sub-11px type is systemic, and one instance is 7px.

| File:line | Size |
|---|---|
| `dashboard/index-hero.tsx:143` | **`text-[7px]`** — "Sessions / this week" inside the progress ring |
| `globals.css:236` | `.micro-label` = 0.625rem (**10px**) — **116 uses across the app** |
| `globals.css:619` | `.logbook-filter-chip` = 0.65rem (10.4px) |
| `plan-view.tsx:269` | `text-[0.6rem]` (9.6px) |
| `plan-view.tsx:275`, `day-detail.tsx:177`, `diagnostic-report.tsx:397`, `event-order-decision.tsx:69,74` | `text-[0.65rem]` |
| 30 `text-[9px]` | incl. `prediction-strips.tsx:102,156,173`, `logbook-row.tsx:183,219,226,257`, `week-strip.tsx:98,138`, `activity-heatmap.tsx:152,171,224,228`, `feed-panel.tsx:72,277,292` |
| 131 `text-[10px]` | incl. `app-shell.tsx:335,370,384` (bottom-nav labels), `app-top-bar.tsx:93` (Upgrade pill) |

The 7px label is not readable by anyone; it is inside a 74px ring and could simply be dropped (the
`3/4` is self-explanatory next to a ring) or become an `aria-label`.

**Fix:** raise `.micro-label` to `0.6875rem` (11px) — one change lifts 116 sites — and sweep
`text-[9px]` → `text-[10px]`. Then let uppercase + `tracking-[0.12em]` carry the "this is a label"
signal, which is what those classes are actually for.

## L2 — `overflow-x-auto` with no `min-w` is a no-op that hides a squashed table.

**File:** `src/components/analytics/personal-records-table.tsx:49-50`

`<div className="overflow-x-auto"><table className="w-full …">` — the table is `w-full` so it never
exceeds the container and the wrapper never scrolls. What actually happens at 390px is that four
columns (Sport / Metric / Value / `MMM d, yyyy`) squeeze into 318px and the metric column wraps to
three lines.

**Fix:** drop the wrapper and restructure to two lines per record on phones — sport + value on line
one, metric + date in `text-xs text-muted` on line two — with the table returning at `sm:`.

## L3 — Interference chart: the axis label column takes 44% of the chart.

**File:** `src/components/analytics/interference-detail.tsx:250`

`<YAxis type="category" width={140} />` with `margin={{ right: 36, left: 8 }}`. Inside a 318px card
that leaves **134px** of plot for the bars, with a right-hand `LabelList` inside it.

**Fix:** `width={90}` on phones with the tick text truncated, or move the category label above each
bar and set `width={0}`.

## L4 — Small consistency items

- `analytics-client.tsx:244` / `social-hub.tsx:98` / `hybrid-plan-screen.tsx` all render a
  `PageHeader` whose `title` duplicates the bottom-nav label the user just tapped. ~80–115px each.
  Suggest `page-header.tsx:31` → `className="text-xl font-semibold tracking-tight md:text-3xl"` and
  `:34` → `className="mt-1.5 hidden text-sm leading-relaxed text-muted sm:block"`.
- `settings/page.tsx:391` — "Sign out" is the last card on the page, below a full pricing
  comparison. Move the Account card directly under Profile.
- `button.tsx:5` — `focus-visible:ring-offset-background`: `--background` is deliberately *not*
  remapped under cardio (`globals.css:301-313` explains why), so the focus ring offset paints dark
  on the white Engine surface. Use `ring-offset-transparent` in cardio mode.
- `card.tsx:53` — `CardTitle` is `text-[11px] uppercase tracking-[0.12em] text-muted`. On a
  card whose body is `text-sm`, the title is smaller and lower-contrast than its content.

---

# What is already right

Worth recording so it does not get "fixed" backwards:

- `app-shell.tsx:149,169` — `min-h-dvh` with the reasoning written down; `:162-168` — the themed
  backdrop on a fixed element rather than a growing wrapper.
- `layout.tsx:64` — `viewportFit: "cover"`, without which every `env(safe-area-inset-*)` in the app
  resolves to 0.
- `social-hub.tsx:114` — the 4-column tab grid. This is the pattern the six scrollers in C6 need.
- `hybrid-plan/week-strip.tsx:73` — `grid grid-cols-7`, seven days with no scroll.
- `activities/use-keyboard.ts` — correct on both platforms with one code path, and correctly
  explained.
- `cardio/gps-run/page.tsx:739-750` — the tracking HUD portals to `document.body` specifically to
  escape the cardio remap, with the reasoning in the comment. Exactly right.
- `activities/logbook-theme.ts` — surface vs zone separated, and `zoneScoreClass` /
  `zoneBadgeClass` already handle neon-green-on-white.
- `button.tsx:26-31` — every size ≥ 44px.
- `dashboard/page.tsx:588-612` — the four-block first screen is the correct instinct; C2 is the
  last 130px of it.

# Suggested order

1. **C1** (`grid-cols-2` on the analytics tiles) — one class, unlocks the whole tab.
2. **C5** (delete `bg-slate-900`) — one class, fixes an unreadable control.
3. **H4** (`pb-24` → `pb-[calc(6.5rem+env(…))]`) — one class.
4. **C4** (hide the Engine blurb, tighten padding) — four classes.
5. **C6a/b/e** (three grids in the log forms) — the scrollers a user hits daily.
6. **C2, C3** — reordering; needs a design call on what the band and the plan screen lead with.
7. **H1, H3, M6** — the 320px and safe-area breaks.
8. **H5, L1** — the touch-target and type sweep; mechanical, best done in one pass.
