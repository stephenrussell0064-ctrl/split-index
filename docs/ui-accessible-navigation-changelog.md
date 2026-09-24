# Accessible navigation redesign — change log

Branch: `worktree-ux-accessible-navigation`, branched from `origin/main` at `4428535` on 24 Sep 2026.
Worktree: `.claude/worktrees/ux-accessible-navigation`.

Why: user feedback that the app is too difficult to navigate and that nothing explains what
anything is. This is a *slight* redesign — no layout, colour or feature was removed. Every change
is listed here so any one of them can be reverted on its own.

## How to revert

Nothing is committed. From the worktree:

- One modified file back to `main`: `git checkout origin/main -- <path>`
- One new file: `git rm --cached <path>` is not needed (untracked) — just delete it.
- Everything at once: `git checkout origin/main -- . && git clean -fd src docs scripts`

The table says which changes depend on which. The only hard dependency is the navigation list
(`app-nav.ts`): the shell, the guide page, the dashboard card and their test all import it.

## Changes

### 1. One navigation list, in plain English — NEW `src/lib/navigation/app-nav.ts`

Every destination in the app, each with a plain label, an optional product name, and a
one-sentence description. The shell, the More menu, the sidebar, the guide and the first-run card
all render from this list. Includes three screens that were previously in no menu at all on a
phone: **Logbook** (`/activities`), **Profile** (`/profile`) and **Athlete report** (`/reports` —
linked from nowhere before this).

Guarded by NEW `src/lib/navigation/app-nav.test.ts`: every entry has a page, is on the strict-CSP
list, is labelled in plain words with a full-sentence description; the shell and the guide really
import the list.

To revert: delete both files and revert §2, §5, §6 (they import it).

### 2. App shell — `src/components/layout/app-shell.tsx`

| What | Before | After |
|---|---|---|
| Phone tab labels | Home · **Lab** · + · **Engine** · More | Home · **Strength** · + · **Endurance** · More |
| Sidebar labels | Dashboard · The Lab · The Engine | Home · Strength *(The Lab)* · Endurance *(The Engine)* — product name shown small beside the plain word |
| Sidebar sections | Train · Insights (Recovery, Interference, Hybrid Plan, Analytics, Social, Settings) | Train · Insights (Hybrid Plan, Recovery, Interference, Analytics, Logbook, Athlete report, Social) · Account (Settings, Help & guide). Profile stays in the account block at the foot. |
| Sidebar tagline under the logo | "The Lab · Strength" / "The Engine · Endurance" | "Strength · The Lab" / "Endurance · The Engine" |
| More sheet | Six one-word links | Heading "Everything else"; every row has an icon, its label and a one-line description; two groups (Insights, then Profile / Settings / Help & guide); scrolls on small phones instead of clipping |
| Tab-bar label size | 10px | 11px (the app's own minimum label size) |
| Accessibility | — | `aria-current="page"` on the active tab/sidebar/menu link; icons marked `aria-hidden`; sidebar links carry the description as a `title` |
| Back button | Menu destinations had none; Logbook/Profile did | Same, except `/help` keeps a back button because it is also reached from every "?" |

Unchanged: the + button always opens the launcher; tabs remember the last page under them; the
focus-trapped More dialog (`useDialog`); every layout, spacing and colour.

To revert only the tab names: change `label`/`shortLabel` on the three primary entries in
`app-nav.ts` (the test forbids "The Lab"/"The Engine" as the *label*, so relax that test too).

### 3. Top bar — `src/components/layout/app-top-bar.tsx`

- Mode label "THE LAB" / "THE ENGINE" (11px uppercase) → "Strength · The Lab" / "Endurance · The Engine" at 12px semibold.
- NEW "?" **Help** button (44×44) beside the bell on every screen, linking to `/help`.
- "Upgrade" pill text 10px → 11px.

The entitlement-refresh logic this file is tested for is untouched.

### 4. "?" explanations — NEW `src/components/ui/info-hint.tsx`

A small "?" that opens a focus-trapped sheet (same pattern as the existing score explainers:
`useDialog`, Escape closes, focus returns) with a plain-English explanation and a "Read more in the
guide" link. Used by:

- `src/components/ui/page-header.tsx` — NEW optional `help` / `helpHref` props; renders the "?" beside the title. Pages without `help` are unchanged.
- `src/components/dashboard/index-hero.tsx` — "?" on the Split Index label and on both sub-scores. **Also re-labelled the sub-scores**: "Engine / Endurance score" → "Endurance / The Engine · out of 100"; "Lab / Strength score" → "Strength / The Lab · out of 100".
- `src/app/(app)/interference/page.tsx`, `src/app/(app)/recovery/page.tsx`, `src/components/analytics/analytics-client.tsx`, `src/components/social/social-hub.tsx` — `help` text added to the page header. Nothing else on these pages changed.

To revert a single hint: remove the `help=` prop (or the `<InfoHint>`) at that call site.

### 5. In-app guide — NEW `src/app/(app)/help/page.tsx`

Signed-in page with: Getting around (rendered from the nav list), What the scores mean (Split
Index, Endurance, Strength, "vs everyone / vs you", Recovery, Interference, race and lift
predictions, streak), Logging a workout, Still stuck (support + accessibility statement). Links to
`/how-scoring-works` for the formulas.

Route registration (required — an unregistered authenticated route would ship without the strict
CSP): `"/help"` added to `NONCE_PATH_PREFIXES` in **both** `src/lib/security/csp.ts` and
`scripts/check-csp-routes.mjs` (the test insists the two lists match).

To revert: delete the page, remove `"/help"` from both lists, remove the Help entry from
`app-nav.ts` and the "?" button in §3.

### 6. First-run "how the app is laid out" card — NEW `src/components/dashboard/getting-around-card.tsx`

Shown once on the home page, under the greeting: the three tabs, the + button and More, each with
one line, plus "Open the full guide" / "Got it". Dismissed permanently via localStorage
(`split-index-getting-around-dismissed`); never rendered on the server, so returning users see
nothing flash. Wired in `src/app/(app)/dashboard/page.tsx` (one import, one element).

To revert: delete the component and the two lines in `dashboard/page.tsx`. To show it again for
testing: clear that localStorage key.

## What was deliberately not changed

- Colours, fonts, spacing, card shapes, animations, the bottom-bar layout, the + button behaviour.
- The names "The Lab" and "The Engine" — still on both hub pages' headers, the tab bar's tagline and
  the sub-score captions; they are now the second thing you read rather than the first.
- Gym and cardio hub pages, the log launcher, onboarding.

## Verification

- `tsc --noEmit`: clean.
- `eslint` on every touched directory: clean.
- `vitest` full suite: 3114 of 3115 passed. The one failure was `hpe/engine.test.ts` timing out at
  5 s while `next build` was saturating the machine at the same time; run alone it passed 90/90 in
  11 s. It does not touch any file changed here.
- `npm run build`: clean. `/help` is server-rendered (`ƒ`), the client-bundle scan found no
  secrets, and the CSP route gate reported 13 prerendered routes with none under a nonce prefix.
- Not done: a browser walk-through. This worktree cannot be served by the in-app preview (it always
  serves the main checkout), so the tab bar, More sheet, "?" sheets, guide page and first-run card
  have been checked by type, lint and source-scanning tests only. Open the branch in a real
  browser before merging.
