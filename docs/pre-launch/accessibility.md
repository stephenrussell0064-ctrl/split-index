# Accessibility audit — WCAG 2.2 AA

Scope: every component in `src/components` and every page in `src/app`. Bar: WCAG 2.2 Level AA,
which is both the App Store's stated expectation and the standard a paid consumer product is
measured against under the EAA / ADA Title III.

## Method

Contrast ratios below are **computed**, not eyeballed. Every hex value was taken from
`src/app/globals.css`, alpha-composited against its real backdrop where a Tailwind opacity
modifier is in play (`text-muted/70`, `bg-white/[0.03]`, `--card: rgba(18,18,18,0.72)`), then run
through the WCAG relative-luminance formula:

```
c_srgb = c/255
c_lin  = c_srgb <= 0.03928 ? c_srgb/12.92 : ((c_srgb + 0.055)/1.055)^2.4
L      = 0.2126·R_lin + 0.7152·G_lin + 0.0722·B_lin
ratio  = (L_lighter + 0.05) / (L_darker + 0.05)
```

Worked example — `--muted` `#a1a1aa` on `--background` `#060606`:

```
#a1a1aa → R=161 G=161 B=170 → 161/255=0.6314 → ((0.6314+0.055)/1.055)^2.4 = 0.35153
                                170/255=0.6667 → ((0.6667+0.055)/1.055)^2.4 = 0.40197
  L = 0.2126(0.35153) + 0.7152(0.35153) + 0.0722(0.40197) = 0.35969
#060606 → 6/255=0.02353 ≤ 0.03928 → 0.02353/12.92 = 0.001821 → L = 0.00182
  ratio = (0.35969 + 0.05) / (0.00182 + 0.05) = 0.40969 / 0.05182 = 7.91:1  PASS
```

Two composited backdrops recur and are stated once here:

- **Card surface** — `--card: rgba(18,18,18,0.72)` over `#060606` = `#0f0f0f`
- **`.glass`** — `rgba(255,255,255,0.03)` over `#060606` = `#0d0d0d`

Thresholds: **4.5:1** normal text, **3:1** large text (≥18.66px bold or ≥24px regular) and
non-text UI components. Note that almost nothing in this app qualifies as "large text" — the
typography is overwhelmingly 9–13px (see §3), so 4.5:1 is the applicable bar nearly everywhere.

---

# 1. Contrast table

## 1a. Dark theme (neutral shell + The Lab)

| # | Foreground | Background | Ratio | Verdict |
|---|---|---|---|---|
| 1 | `--foreground` `#fafafa` | `--background` `#060606` | **19.41** | PASS |
| 2 | `--muted` `#a1a1aa` | `--background` `#060606` | **7.91** | PASS |
| 3 | `--muted` `#a1a1aa` | card `#0f0f0f` | **7.48** | PASS |
| 4 | `--muted-foreground` `#71717a` | `--background` `#060606` | **4.19** | **FAIL** (large-only) |
| 5 | `--accent` `#3dff6e` | `--background` `#060606` | **15.17** | PASS |
| 6 | `--cardio-accent` `#3ba6ff` | `--background` `#060606` | **7.80** | PASS |
| 7 | `--success` `#22c55e` | card `#0f0f0f` | **8.41** | PASS |
| 8 | `--warning` `#eab308` | card `#0f0f0f` | **10.00** | PASS |
| 9 | `--danger` `#ef4444` | `--background` `#060606` | **5.38** | PASS |
| 10 | `--accent-foreground` `#04120a` on `--accent` (default Button) | `#3dff6e` | **14.35** | PASS |
| 11 | `--gym-text` `#f4fff8` | `--gym-bg` `#070908` | **19.50** | PASS |
| 12 | `--gym-muted` `#a8b5ac` | `--gym-bg` `#070908` | **9.39** | PASS |
| 13 | `--gym-muted` `#a8b5ac` | `--gym-bg-elevated` `#0c1410` | **8.79** | PASS |
| 14 | `--gym-accent` `#3dff6e` | `--gym-bg` `#070908` | **14.96** | PASS |
| 15 | `text-gym-accent/80` → `#32ce5a` | `--gym-bg` `#070908` | **9.62** | PASS |
| 16 | `text-muted/70` → `#75757b` | card `#0f0f0f` | **4.19** | **FAIL** |
| 17 | `text-muted/60` → `#67676c` (incl. `micro-label text-muted/60`) | card `#0f0f0f` | **3.41** | **FAIL** |
| 18 | `text-muted/40` → `#48484c` (input placeholders) | `.glass` `#0d0d0d` | **2.13** | **FAIL** |
| 19 | `text-muted/30` → `#3b3b3e` (HeroInput placeholder) | card `#0f0f0f` | **1.72** | **FAIL** |
| 20 | `text-danger/80` → `#c23939` | card `#0f0f0f` | **3.59** | **FAIL** |
| 21 | `text-gym-muted/60` → `#6a756e` | `--gym-bg-elevated` `#0c1410` | **3.90** | **FAIL** |
| 22 | `.logbook-filter-chip` idle `rgba(255,255,255,0.45)` → `#767676` | `#060606` | **4.46** | **FAIL** (marginal) |

## 1b. Light theme (The Engine / cardio mode)

The cardio override at `globals.css:279–290` remaps the shared design tokens for every component
rendered under `.mode-content` — `--accent → #3ba6ff`, `--accent-foreground → #ffffff`,
`--muted → #5b7284`, `--muted-foreground → #7d94a5`. That single block is where most of this
section's failures originate: components that are perfectly legible on `#060606` inherit the same
class names and land on `#f7fbff`.

| # | Foreground | Background | Ratio | Verdict |
|---|---|---|---|---|
| 23 | `--cardio-text` `#0c1a24` | `--cardio-bg` `#f7fbff` | **16.99** | PASS |
| 24 | `--cardio-muted` `#5b7284` | `--cardio-bg` `#f7fbff` | **4.83** | PASS |
| 25 | `--cardio-muted` `#5b7284` | `--cardio-bg-elevated` `#eef6ff` | **4.60** | PASS (marginal) |
| 26 | `--cardio-muted` `#5b7284` | `--cardio-surface` ≈ `#ffffff` | **5.02** | PASS |
| 27 | **`--cardio-accent` `#3ba6ff`** | `--cardio-bg` `#f7fbff` | **2.50** | **FAIL** — also fails the 3:1 large-text floor |
| 28 | `--cardio-accent-soft` `#6bb8ff` | `--cardio-bg` `#f7fbff` | **2.03** | **FAIL** |
| 29 | `text-cardio-accent/80` → `#61b7ff` | `--cardio-bg` `#f7fbff` | **2.08** | **FAIL** |
| 30 | **`#ffffff` on `--cardio-accent`** (`--accent-foreground` in cardio mode; every default Button, the GPS CTAs, the bottom-nav FAB) | `#3ba6ff` | **2.60** | **FAIL** |
| 31 | `white/90` → `#ebf6ff` on `--cardio-accent` (the "GPS" micro-label) | `#3ba6ff` | **2.37** | **FAIL** |
| 32 | cardio `--muted-foreground` `#7d94a5` | `--cardio-bg` `#f7fbff` | **3.04** | **FAIL** |
| 33 | cardio `--muted-foreground` `#7d94a5` | `--cardio-bg-elevated` `#eef6ff` | **2.90** | **FAIL** |
| 34 | `--accent` `#3dff6e` (green leaking into cardio surfaces) | `#f7fbff` | **1.28** | **FAIL** |
| 35 | `--success` `#22c55e` | `#f7fbff` | **2.19** | **FAIL** |
| 36 | `--warning` `#eab308` | `#f7fbff` | **1.84** | **FAIL** |
| 37 | `--danger` `#ef4444` | `#f7fbff` | **3.62** | **FAIL** |

**Suggested replacement values** (all computed against `--cardio-bg` `#f7fbff`):

| Token | Now | Ratio | Proposed | Ratio |
|---|---|---|---|---|
| cardio accent as **text** | `#3ba6ff` | 2.50 | `#0b6bb8` | **5.30** PASS |
| " (higher headroom) | | | `#1e5a8f` | **6.93** PASS |
| cardio accent as **button fill** | `#3ba6ff` + white | 2.60 | `#0a5fa8` + white | **6.53** PASS |
| " (keep the brand blue) | | | `#3ba6ff` + `--cardio-text` `#0c1a24` | **6.80** PASS |
| cardio `--muted-foreground` | `#7d94a5` | 3.04 | fold into `--cardio-muted` `#5b7284` | **4.83** PASS |

Keeping `#3ba6ff` as the *fill* and switching the label to `#0c1a24` (6.80:1) is the smallest
change that fixes finding 30 without touching the brand colour.

## 1c. Information conveyed by colour alone

| Surface | File | Verdict |
|---|---|---|
| Trend arrows (dashboard, leaderboard, sport grid) | `split-index-hero.tsx:126`, `leaderboard-panel.tsx:506`, `sport-comparison-grid.tsx:49` | **PASS** — every arrow is paired with a signed number (`+3`, `−2`) and a `Minus` glyph for zero. Shape + text carry the meaning. |
| Adaptive 1RM trend | `analytics/adaptive-1rm-list.tsx:42-43` | **PASS** — carries explicit `label: "Rising" / "Falling"`. |
| **Training heatmap** | `dashboard/activity-heatmap.tsx:190-207, 223-229` | **FAIL** — five load levels are five opacities of `--accent` and nothing else. The cells have no text, no `title`, no `aria-label`; the "Less ⬛⬛⬛⬛⬛ More" legend is colour-only. |
| **Draft badge on cardio sport tiles** | `activities/log-launcher.tsx:185` | **FAIL** — a bare `<span className="h-1.5 w-1.5 rounded-full bg-warning" />`. The Lab tile beside it (line 115) uses a text badge reading "Draft"; the endurance tiles use an unlabelled amber dot. |
| Tier colours | `leaderboard-panel.tsx:436,663`, `index-hero.tsx:104` | **PASS** — `tierForScore()` returns a string that is rendered as text. |
| Rest-timer "over" state | `gym-workout-timer.tsx:478-484` | **PASS** — colour changes *and* the text swaps to "Rest over!". |

---

# 2. Findings by severity

## BLOCKER

### B1 — Every form label in the logging flows is unassociated with its input

**Files:** `src/components/activities/fields.tsx:57-63` (definition); 73 call sites across
`gym-form.tsx`, `activity-form.tsx`, `sport-form.tsx`, `cardio-enrichment-panel.tsx`,
`interval-blocks.tsx`.

`Field` renders `<MicroLabel htmlFor={htmlFor}>` where `htmlFor` is optional — and **not one of
the 73 `<Field>` call sites passes it**. The whole app contains only 15 `htmlFor` attributes.
Separately, 195 `GlassInput` / `UnitInput` / `HeroInput` instances render with only 29 `id`s
between them. The result: a `<label>` that is a sibling, not an ancestor, of an `<input>` with no
`id` — so VoiceOver announces "text field, blank" for the weight, reps, distance and duration
fields that are the entire point of the product. Violates **1.3.1 Info and Relationships** and
**4.1.2 Name, Role, Value**.

**Fix:** make `htmlFor` required on `FieldProps`, generate a stable id with `useId()` inside
`Field`, and pass it down to the child via a render-prop or context so the label and the control
agree:

```tsx
export function Field({ label, error, hint, children, className }: FieldProps) {
  const id = useId();
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <MicroLabel htmlFor={id}>{label}</MicroLabel>
      {typeof children === "function" ? children({ id, describedBy: error ? `${id}-err` : hint ? `${id}-hint` : undefined }) : children}
      {hint && !error && <p id={`${id}-hint`} className="text-xs text-muted/70">{hint}</p>}
      <FieldError id={`${id}-err`} error={error} />
    </div>
  );
}
```

### B2 — The Engine's primary CTAs and headline numbers fail contrast

**Files:** `src/app/(app)/cardio/page.tsx:99` (`bg-cardio-accent … text-white` — 2.60:1),
`:111` (`text-6xl … text-cardio-accent` — 2.50:1, fails even the 3:1 large-text floor),
`:82` (`micro-label text-cardio-accent` at 10px — 2.50:1);
`src/components/activities/log-launcher.tsx:55,57` (three GPS record buttons, white on
`#3ba6ff`); `src/components/layout/app-shell.tsx:353` (the bottom-nav FAB in cardio mode);
`src/app/globals.css:286` (`--accent-foreground: #ffffff` in the cardio override, which
propagates the failure to *every* default `<Button>` rendered under `.mode-content`).

Rows 27–31 and 34–37 of the contrast table. Violates **1.4.3 Contrast (Minimum)** and
**1.4.11 Non-text Contrast** for the button fills.

**Fix:** in `globals.css:279-290`, set `--accent-foreground: var(--cardio-text)` (6.80:1 on the
existing blue) and introduce a text-safe blue for anything drawn *as* text on the light shell:

```css
[data-mode="cardio"] .mode-content {
  --accent: #0b6bb8;            /* 5.30:1 on --cardio-bg — for text and icons */
  --accent-foreground: #ffffff; /* 6.53:1 against #0b6bb8 fills */
  --muted-foreground: var(--cardio-muted);  /* was #7d94a5 @ 3.04:1 */
}
```
Keep `--cardio-accent` `#3ba6ff` as the decorative/brand fill; stop using it for text.

### B3 — No modal is a dialog; none of them handle Escape

**Files:** `src/components/social/compare-modal.tsx:70-98`,
`src/components/activities/delete-activity-modal.tsx:45-58`,
`src/components/layout/app-shell.tsx:268-317` (the "More" sheet),
`src/components/retention/notification-bell.tsx:77-117` (the notifications popover).

Only `merge-activities-modal.tsx:155-157` carries `role="dialog" aria-modal="true"
aria-label="Merge sessions"`. Everywhere else the dialog is a plain `<div>`/`motion.div`:

- No `role="dialog"` / `aria-modal="true"` / `aria-labelledby` → a screen reader never announces
  that a dialog opened and keeps reading the page behind it.
- **No focus trap and no focus restore.** Tab walks straight out of the dialog into the page
  underneath, which is still fully interactive.
- **`grep -rn '"Escape"' src/` returns zero matches — the app has no Escape handling anywhere.**
  A keyboard user who opens the delete-activity dialog cannot dismiss it: the only close affordance
  is the backdrop, and the "Cancel" button is reachable only after tabbing through it.
- No initial focus is set, so focus stays on the trigger behind the overlay.

Violates **2.1.2 No Keyboard Trap**, **2.4.3 Focus Order**, **4.1.2 Name, Role, Value**.

**Fix:** extract one `<Modal>` primitive that all five use. Either adopt the platform
`<dialog>` element with `showModal()` (Escape, focus trap, inertness and `aria-modal` come free),
or wire it manually:

```tsx
useEffect(() => {
  if (!open) return;
  const prev = document.activeElement as HTMLElement | null;
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
  document.addEventListener("keydown", onKey);
  panelRef.current?.focus();
  return () => { document.removeEventListener("keydown", onKey); prev?.focus(); };
}, [open, onClose]);
```

### B4 — The training heatmap is invisible to screen readers and unreachable by keyboard

**File:** `src/components/dashboard/activity-heatmap.tsx:190-207`

112 `motion.div` cells with no text, no `role`, no `aria-label`, no `tabIndex`. The only way to
read a day's load is `onMouseEnter` (line 199) writing into a paragraph at line 216 — there is no
`onFocus` equivalent, so the readout is mouse-only. A screen reader hears nothing at all; a
keyboard user cannot reach a single cell. Violates **1.1.1 Non-text Content**, **1.3.1**,
**1.4.1 Use of Colour**, **2.1.1 Keyboard**.

**Fix:** give the grid `role="grid"` with a caption, make each cell a `<button role="gridcell">`
carrying the text it already computes, add `onFocus`/`onBlur` beside the mouse handlers, and make
the footer readout an `aria-live="polite"` region:

```tsx
<button
  type="button"
  aria-label={`${cell.label}: ${cell.level === 0 ? "rest day" : `${cell.workouts} workout${cell.workouts === 1 ? "" : "s"}`}`}
  onFocus={() => !cell.inFuture && setHovered(cell)}
  onBlur={() => setHovered(null)}
  onMouseEnter={() => !cell.inFuture && setHovered(cell)}
  onMouseLeave={() => setHovered(null)}
  …
/>
```
Also add a non-colour channel to the legend (a numeric range per swatch, e.g. "0 · light ·
moderate · hard · max") so level is not carried by opacity alone.

## HIGH

### H1 — Async results are never announced

**Evidence:** the entire app contains **5** `aria-live` / `role="status"` / `role="alert"`
attributes and **0** `aria-busy`, across ~31k lines of components.

Silent surfaces the brief names explicitly:

| Event | File | State today |
|---|---|---|
| Score submitted | `activities/success-screen.tsx` | 0 live regions — the score reveal is rendered visually only |
| Plan regenerated | `hybrid-plan/hybrid-plan-screen.tsx` | 4 error paths, 3 loading states, 0 live regions |
| Leaderboard refreshed / filter changed | `social/leaderboard-panel.tsx` | rows swap under `opacity-50` (line 427) with no announcement and no `aria-busy` |
| Comparison loaded / failed | `social/compare-modal.tsx` | error at 3 sites, none announced |
| Field validation errors | `activities/fields.tsx:29-43` | `FieldError` renders a bare `motion.p` — an athlete who submits an invalid form hears nothing |
| Rest timer reaching zero | `activities/gym-workout-timer.tsx:478-484` | visual + haptic only |

Violates **4.1.3 Status Messages**.

**Fix:** add `role="status" aria-live="polite"` to `FieldError`'s `motion.p` and to each panel's
result container; `role="alert"` for the destructive/error paths; `aria-busy={loading}` on the
leaderboard list at `leaderboard-panel.tsx:427`; and a visually-hidden `role="status"` on the
success screen carrying the final score sentence.

### H2 — `Input`/`Select`/`Textarea` derive `id` from label text, and never link errors

**File:** `src/components/ui/input.tsx:14, 39-40, 52, 81, 92, 112`

```tsx
const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");
```

Two defects. (a) Two fields with the same label on one page (e.g. "Weight" in the profile form and
"Weight" in an activity form section) produce **duplicate DOM ids**, and `<label for>` then binds
to whichever came first. (b) The `hint` (line 39) and `error` (line 40) paragraphs are not
referenced by `aria-describedby`, and the input never gets `aria-invalid` — so a screen reader
reads the field as valid and gives no explanation of the red border. `fields.tsx` already sets
`aria-invalid` correctly (line 84, with a good comment explaining why); `ui/input.tsx` does not.

**Fix:** `const auto = useId(); const inputId = id ?? auto;`, then
`aria-invalid={!!error || undefined}` and
`aria-describedby={error ? errId : hint ? hintId : undefined}` with matching `id`s on the two
paragraphs.

### H3 — Icon-only controls with no accessible name

`lucide-react` sets `aria-hidden="true"` on every icon that has no children and no a11y prop
(`node_modules/lucide-react/dist/cjs/lucide-react.js:92`). That is correct for decoration — but it
means an icon-only button has **no accessible name whatsoever**, not a weak one.

| File:line | Control | Announced as |
|---|---|---|
| `social/compare-modal.tsx:91-97` | `<X>` close button on the Compare dialog | "button" |
| `dashboard/goals-card.tsx:193-195` | `<Button size="sm" variant="ghost"><X/></Button>` — cancels goal editing | "button" |

Violates **4.1.2**. **Fix:** `aria-label="Close"` / `aria-label="Cancel editing goal"`.

The rest of the app's icon buttons are already handled well — `app-shell.tsx:291,347`,
`app-top-bar.tsx:20`, `notification-bell.tsx:62,81` and `gym-workout-timer.tsx:404` all carry
labels, and `notification-bell.tsx:62` even interpolates the unread count. Keep that pattern.

### H4 — Disclosure controls never expose their state

**Evidence:** 3 `aria-expanded` attributes in the whole app.

- `layout/app-shell.tsx:380-392` — the bottom-nav "More" button toggles a sheet with no
  `aria-expanded` / `aria-controls`.
- `retention/notification-bell.tsx:60-75` — same, for the notifications popover.
- `social/leaderboard-panel.tsx:443-455` — the row expands a detail panel; `role="button"` and
  `tabIndex={0}` are there, but no `aria-expanded`.
- `activities/expandable-section.tsx`, `gym/workout-plans-disclosure.tsx` — same pattern.

Violates **4.1.2**. **Fix:** `aria-expanded={moreOpen} aria-controls="more-sheet"` on each
trigger, with the matching `id` on the panel.

### H5 — `role="button"` on a `motion.div` in the leaderboard

**File:** `src/components/social/leaderboard-panel.tsx:443-455`

```tsx
role="button"
tabIndex={0}
onClick={() => toggleExpanded(entry.userId)}
onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") toggleExpanded(entry.userId); }}
```

Better than most hand-rolled buttons — but three problems remain: (a) Space is handled without
`e.preventDefault()`, so pressing Space also scrolls the page; (b) it contains a nested `<Link>`
at line 493, which is an interactive control inside an interactive control — invalid, and the
`stopPropagation` at line 494 papers over it; (c) no `aria-expanded`.

**Fix:** make the *chevron/row-toggle* a real `<button aria-expanded>` sibling of the profile link
rather than making the whole row a pseudo-button, or at minimum add
`if (e.key === " ") e.preventDefault();`.

The two other clickable non-interactive elements — `compare-modal.tsx:72-78` and
`app-shell.tsx:271-277` — are click-catching backdrops. They need `aria-hidden="true"` plus a real
Escape handler (see B3), not `role="button"`.

### H6 — framer-motion animations ignore `prefers-reduced-motion` in 31 files

`globals.css:100-112` zeroes CSS `animation-duration` and `transition-duration` under
`prefers-reduced-motion` — but **framer-motion animates via JS-driven inline transforms and the
Web Animations API, which that CSS block does not touch.** 42 files call `useReducedMotion()`
correctly (`activity-heatmap.tsx:56` and `train-zone-swipe.tsx:83` are good models). 31 do not:

| File:line | Motion | Why it matters |
|---|---|---|
| `onboarding/score-reveal.tsx:156-158` | `animate={{ rotate: 360 }} transition={{ repeat: Infinity }}` | **Worst case** — an unbounded looping rotation. Also violates **2.2.2 Pause, Stop, Hide** since it runs longer than 5s with no control. |
| `layout/app-shell.tsx:407-417` | Every page transition: `x: 12 → 0`, `exit x: -12` | Large-area translation fires on *every* navigation in the app |
| `layout/app-shell.tsx:203-215, 251-257` | `layoutId` spring on the nav indicator | Spring physics on the primary nav |
| `layout/app-shell.tsx:278-283` | "More" sheet slide-up | |
| `activities/success-screen.tsx:115-280` | Four staggered scale/translate reveals | Fires immediately after every logged workout |
| `retention/milestone-toast.tsx` | Toast entrance | |
| `social/leaderboard-panel.tsx:443-446` | Per-row `x: -8` stagger `delay: i * 0.03` | 50 rows cascading |
| `social/feed-panel.tsx`, `challenges-panel.tsx`, `duels-panel.tsx`, `friends-panel.tsx`, `squads-panel.tsx`, `achievements-panel.tsx` | List stagger | |
| `activities/log-launcher.tsx:98-103, 141-144` | Both halves of the launcher | |
| `activities/activity-form.tsx`, `gym-form.tsx`, `fields.tsx:33-40`, `interval-blocks.tsx`, `cardio-sport-picker.tsx` | Field/row enter+exit | |
| `analytics/{dots-gl,fitness-estimates,injury-risk,period-comparison,personal-records-table,premium-gate,race-records,stored-predictions}` | Panel reveals | |
| `marketing/product-showcase.tsx`, `premium/premium-tease.tsx`, `retention/empty-dashboard-hero.tsx`, `profile/profile-form.tsx`, `social/{compare-modal,profile-view}.tsx` | Assorted | |

Violates **2.3.3 Animation from Interactions** (AAA) and, for `score-reveal.tsx:156`,
**2.2.2 Pause, Stop, Hide** (A).

**Fix:** a shared helper so this cannot regress —

```tsx
// src/lib/design/motion.ts
export function useMotionSafe() {
  const reduced = useReducedMotion();
  return {
    fade: reduced ? { initial: false, animate: { opacity: 1 } } : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } },
    stagger: (i: number) => (reduced ? 0 : i * 0.03),
  };
}
```
Apply `reduced ? false : …` to `initial`, and zero every `delay`/`repeat`. `score-reveal.tsx:157`
should become `animate={reducedMotion ? {} : { rotate: 360 }}`.

## MEDIUM

### M1 — Sub-12px type carries essential information throughout

**359 instances** of type below 12px:

| Size | Count | Source |
|---|---|---|
| 9px | 30 | `text-[9px]` |
| 10px | 131 | `text-[10px]` |
| 10px | 116 | `.micro-label` — `globals.css:236-241`, `font-size: 0.625rem` |
| 10.4px | 9 | `.landing-eyebrow` / `.logbook-filter-chip` — `globals.css:437-443, 618-628` |
| 11px | 71 | `text-[11px]` |

WCAG has no absolute minimum size, but three of these carry information with no larger equivalent
anywhere on screen and so fail **1.4.4 Resize Text** in practice once combined with §M2:

- `dashboard/prediction-strips.tsx:102, 156` — the race-distance labels ("1500m", "5K", "10K",
  "HALF", "FULL") and the lift names are **9px uppercase with `tracking-wider`**. These are the
  keys to the numbers beside them; without them the strip is five unlabelled times.
- `dashboard/prediction-strips.tsx:173` — `best 140×3` at 9px, the comparison the whole strip
  exists to draw.
- `activities/log-launcher.tsx:190` — **the sport names on the endurance tiles are 10px.** This is
  the label on the primary destination control.
- `ui/input.tsx:11` and `activities/fields.tsx:22` — the shared form-label class is
  `text-[11px] uppercase tracking-[0.1em/wider]`. Every field label in the app is 11px uppercase
  with letter-spacing, which is the least legible combination available.
- `dashboard/activity-heatmap.tsx:152, 171, 224, 228` — weekday gutter, month markers and the
  legend, all 9px.
- `layout/app-top-bar.tsx:93` — the "Upgrade" link, 10px.
- `layout/app-shell.tsx:335, 370, 384` — bottom-nav labels, 10px (acceptable for a tab bar with
  icons, but noted).

**Fix:** raise the floor to 12px and reserve 11px for genuinely secondary text. Concretely: change
`.micro-label` to `font-size: 0.6875rem` (11px) as a first pass and `0.75rem` (12px) where it
labels a control; promote `prediction-strips.tsx:102,156` and `log-launcher.tsx:190` to
`text-xs` (12px); change the shared label class in `ui/input.tsx:11` and `fields.tsx:22` to
`text-xs` and drop the uppercase transform, which costs ~15% legibility on its own.

### M2 — Text zoom to 200% will clip

**1.4.4 Resize Text** requires no loss of content at 200%. The app is built almost entirely from
fixed-height boxes with `truncate`:

- **46** `truncate` / `line-clamp` instances, several of them on primary labels
  (`app-shell.tsx:340,375`, `sport-comparison-grid.tsx:55`, `prediction-strips.tsx:47,173`).
- `activities/log-launcher.tsx:96` — `h-[calc(100dvh-14rem)]` with `grid-rows-2` and
  `overflow-hidden` on the Lab half (line 105). At 200% the Lab's headline, blurb and CTA cannot
  fit in half a viewport; the `overflow-hidden` clips rather than scrolls.
- `dashboard/activity-heatmap.tsx:216` — `h-4` on the hover readout: a fixed 16px box around
  text that becomes 20px at 200%.
- `gym-workout-timer.tsx:396-398` — the comment states both rows are deliberately `h-8` so the
  layout does not shift. That guarantee breaks under zoom.
- 62 fixed pixel/rem heights on text containers across `dashboard/` and `analytics/` alone.

The one thing done right: `src/app/layout.tsx:61-65` sets no `maximumScale` and no
`userScalable: false`, so pinch-zoom is available. **1.4.4 is not blocked at the viewport level** —
the failures are all layout-level.

**Fix:** replace fixed `h-*` on any box containing text with `min-h-*`; remove `truncate` from
labels that have no other on-screen source (keep it on usernames and activity titles, which have a
detail page); change `log-launcher.tsx:105` from `overflow-hidden` to `overflow-y-auto`.

### M3 — Touch targets below 44×44pt

**2.5.8 Target Size (Minimum)** requires 24×24 CSS px (AA); Apple's HIG — which the App Store
review actually applies — requires 44×44pt. 27 controls measured below 44px tall; the ones under
the 24px AA floor or on high-traffic paths:

| File:line | Control | Height |
|---|---|---|
| `layout/app-top-bar.tsx:91-97` | "Upgrade" link (`py-1`, 10px text) | **~22px** — fails even AA |
| `activities/gym-workout-timer.tsx:484, 508` | "Dismiss" rest, "Set" custom rest (`py-1`, 11px) | **~23px** |
| `social/squads-panel.tsx:31-38` | Invite-code copy button | **~25px** |
| `social/leaderboard-panel.tsx:381-393, 396-405, 412-422` | Metric / age-bracket / weight-class filter chips (`px-3 py-1 text-xs`) | **~25px** |
| `dashboard/goals-card.tsx:184-192` | "Mark complete" | ~29px |
| `activities/logbook-feed.tsx:275` | Filter chip | ~29px |
| `analytics/injury-risk-panel.tsx:139` | Toggle | ~29px |
| `layout/app-top-bar.tsx:17-25` | Back button — `h-9 w-9` | **36×36** |
| `activities/gym-workout-timer.tsx:402` | Play/pause — `h-9 w-9` | **36×36** |
| `social/feed-panel.tsx:233` | `h-9` | 36px |
| `settings/activity-privacy-settings.tsx:138` | `h-7` | 28px |
| `retention/{friend-invite,complete-profile}-banner.tsx:34,32` | Dismiss | ~28px |
| `layout/app-shell.tsx:195, 223, 243` | Sidebar nav rows (`py-2.5`) | ~40px (desktop-only, lower risk) |

`ui/button.tsx:24-29` already gets this right — every size is `min-h-11` or larger, and
`size: "icon"` is `h-12 w-12`. The failures are all hand-rolled `<button className="…">` that
bypass the primitive.

**Fix:** route these through `<Button>`, or add `min-h-11 min-w-11` and use padding to keep the
*visual* chip small while the hit area stays 44px. The back button and timer play/pause should
become `h-11 w-11`.

### M4 — Two unlabelled navigation landmarks; no skip link; missing `<h1>`s

**Files:** `layout/app-shell.tsx:182` (sidebar `<nav>`), `:319` (bottom `<nav>`), `:395`
(`<main>`).

- Both `<nav>` elements are unlabelled, so the landmark list reads "navigation, navigation".
  **Fix:** `aria-label="Primary"` and `aria-label="Bottom tab bar"`.
- No skip link (`grep` finds only 2 `sr-only` uses in the whole app, both in
  `logbook-feed.tsx:313,336`). A keyboard user tabs through 9 sidebar items on every page.
  Violates **2.4.1 Bypass Blocks**. **Fix:** add `<main id="main-content">` at `:395` and a
  first-child skip link in the shell.
- Several authenticated pages have no `<h1>` — `/analytics`, `/social`, `/interference`,
  `/hybrid-plan`, `/reports`, `/profile`. Violates **1.3.1**; `ui/page-header.tsx:31` already
  provides an `<h1>` and should simply be used consistently.
- `dashboard/page.tsx:623` uses `<h1 className="… text-sm">` — the page's only `h1` is 14px, which
  suggests it is being used for styling rather than structure.

### M5 — Focus visibility is correct globally but overridden in one place

`globals.css:408-411` sets `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }`
— good, and `ui/button.tsx:5` correctly pairs `focus-visible:outline-none` with a
`focus-visible:ring-2` replacement. But 22 hand-rolled inputs use bare `focus:outline-none`
(not `focus-visible:`) and replace it only with a **border-colour change**:

`hybrid-plan/intake-fields.tsx:122,181,388,399,451,462,606`,
`hybrid-plan/goals-panel.tsx:294`, `hybrid-plan/intake-wizard.tsx:560`,
`social/leaderboard-panel.tsx:605`, `activities/fields.tsx:74,171`,
`activities/gym-form.tsx:457,1371`, `activities/gym-workout-timer.tsx:506`,
`analytics/upcoming-races-panel.tsx:312,357,384`.

`focus:border-accent` alone is a 1px border change — measured against the surrounding
`border-white/10`, that is well under the **3:1 required by 1.4.11** for a focus indicator, and
`fields.tsx:74` / `gym-form.tsx:457` strip the outline with no ring replacement at all. Violates
**2.4.7 Focus Visible** and **2.4.13 Focus Appearance**.

**Fix:** replace `focus:outline-none` with `focus-visible:outline-none focus-visible:ring-2
focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background` (the
exact string `ui/button.tsx:5` already uses), or simply delete `focus:outline-none` and let the
global `:focus-visible` rule apply.

One more: `globals.css:425` sets `.recharts-tooltip-wrapper { outline: none !important }`. That is
scoped to a non-focusable tooltip wrapper and is harmless, but the `!important` should be narrowed
so it cannot catch a focusable descendant later.

## LOW

### L1 — Alt text is handled correctly

All 6 `<img>` / `next/image` sites are covered: `sidebar-account.tsx:110`,
`social/user-avatar.tsx:37`, `profile/profile-header.tsx:80`,
`onboarding/onboarding-flow.tsx:425,468` all carry meaningful `alt`, and `brand/brand-mark.tsx:20`
correctly uses `alt=""` for the decorative mark while `:81` labels the wordmark "Split Index".
No action.

### L2 — Full-screen backdrop buttons sit ahead of dialog content in the tab order

`activities/delete-activity-modal.tsx:47-52`, `merge-activities-modal.tsx:153` and
`retention/notification-bell.tsx:79-84` each render the backdrop as
`<button aria-label="Close" className="absolute inset-0">`. It works, but the first Tab into an
open dialog lands on an invisible full-screen "Close" button before reaching "Cancel". Once B3
adds real Escape handling, change these to `<div aria-hidden="true" onClick={onClose} />`.

### L3 — `.logbook-filter-chip` idle state is 4.46:1

`globals.css:626` — `color: rgba(255, 255, 255, 0.45)` composites to `#767676`, 4.46:1 against
`#060606`. Marginal fail at 10.4px. Raise to `rgba(255,255,255,0.55)` → 6.0:1.

### L4 — `html { color-scheme: dark }` is unconditional

`globals.css:96`. The cardio zone renders a light surface while the UA is told the page is dark,
so form controls the app does not style (native `<select>` popups, date pickers, autofill
highlights, scrollbars) render dark-on-light inside The Engine. Scope it:
`[data-mode="cardio"] .mode-content { color-scheme: light; }`.

---

# Summary

| Severity | Count | Blocks launch? |
|---|---|---|
| Blocker | 4 | Yes — B1 and B3 make the logging flow and every dialog unusable with a screen reader or keyboard; B2 is a measurable 1.4.3 failure on The Engine's primary CTA |
| High | 6 | Should ship fixed |
| Medium | 5 | Fix before an accessibility conformance claim |
| Low | 4 | Backlog |

Highest-leverage sequence: **B1** (one change in `fields.tsx` fixes 73 fields), **B2** (four lines
in `globals.css:279-290` fixes every cardio-mode component at once), **B3** (one `<Modal>`
primitive fixes five dialogs), **H1** (`aria-live` on ~6 result containers), then **H6** (one
`useMotionSafe` hook applied across 31 files).
