# New-user navigation rework — change log and revert map

Branch: `feature/new-user-navigation`, cut from `origin/main` at `32876e24`.
Date: 4 October 2026. Nothing here is pushed.

## The problem it answers

New users could not tell what the app does, where each feature lives, or what
to do first. A previous pass gave every destination a plain label and a
one-line description; feedback afterwards was unchanged. The shape was the
problem, not the words:

- Two of the four tab slots (Strength, Endurance) showed two views of one
  thing, each with a toggle to the other.
- Nine destinations, including the two features people pay for, sat behind a
  "More" button in a popover.
- Profile, Settings and Help were two taps away behind an ellipsis.
- A brand-new account landed on nine empty cards.
- Pages introduced themselves by brand name ("The Lab · Strength HQ") rather
  than by what they are.

## What changed, and how to undo each piece

Every item below is independent. Reverting one does not require reverting the
others, except where a dependency is named.

### 1. Navigation shape — `Home · Train · + · Plan · Progress`

| File | Change | Revert |
|---|---|---|
| `src/lib/navigation/app-nav.ts` | Groups are now `primary` / `progress` / `community` / `account`. New `TRAIN_ZONES` (Strength, Endurance), new `/train` and `/progress` primary items, `matchPrefixes` + `navItemMatches()`. `INSIGHTS_NAV` removed. | `git checkout origin/main -- src/lib/navigation/app-nav.ts src/lib/navigation/app-nav.test.ts` and revert items 2–5, which import the new exports. |
| `src/components/layout/app-shell.tsx` | More sheet deleted; tab bar is the four primary items around the `+`; sidebar regrouped (Train zones, Plan, Progress list, Community, Account). Tab memory now keys on `navItemMatches`, so Train returns to whichever half was last open. | `git checkout origin/main -- src/components/layout/app-shell.tsx`. Depends on item 1 being reverted too. |
| `src/app/(app)/train/page.tsx` | New. Server redirect to `/cardio` for endurance-only profiles, else `/gym`. | Delete the file and remove `/train` from `src/lib/security/csp.ts` and `scripts/check-csp-routes.mjs`. |
| `src/lib/security/csp.ts`, `scripts/check-csp-routes.mjs` | `/progress` and `/train` added to the strict-CSP prefix list (both copies; a test keeps them equal). | Remove the two lines from each. |

### 2. Account menu in the top bar

| File | Change | Revert |
|---|---|---|
| `src/components/layout/account-menu.tsx` | New. Avatar button → sheet with `ACCOUNT_NAV` rows and Sign out. Uses `useDialog` for focus trap/Escape. | Delete; restore the `?` link in `app-top-bar.tsx`. |
| `src/components/layout/app-top-bar.tsx` | `?` help link removed (now inside the menu); `AccountMenu` added after the bell. | `git checkout origin/main -- src/components/layout/app-top-bar.tsx`. |
| `src/components/layout/use-account-summary.ts`, `src/lib/auth/sign-out-client.ts` | New. Shared profile fetch + sign-out (including widget clears) for the menu and the sidebar footer. | Delete both and `git checkout origin/main -- src/components/layout/sidebar-account.tsx`. |
| `src/components/layout/sidebar-account.tsx` | Now uses the two shared helpers; no behaviour change. | As above. |

### 3. Progress hub (`/progress`)

| File | Change | Revert |
|---|---|---|
| `src/app/(app)/progress/page.tsx` | New. Three queries: latest index row, session count + last date, friend count. | Delete the directory and `src/components/progress/`. Remove `/progress` from the two CSP lists and from `app-nav.ts`. |
| `src/components/progress/progress-hub.tsx`, `progress-hub.test.ts` | New. Scores strip, then "Look back" / "Community" / "Account" rows rendered from the nav groups with live stats. | As above. |

### 4. First-run Home

| File | Change | Revert |
|---|---|---|
| `src/components/dashboard/first-session-guide.tsx`, `.test.ts` | New. One card with two zone-coloured ways to log, a GPS link, a three-step "what happens next" list, and a 2×2 map of Train / Plan / Progress / +. | Delete both. |
| `src/app/(app)/dashboard/page.tsx` | `isFirstRun = !hasActivities && !hasIndexHistory` returns early with the guide. Returning-user path untouched. `GettingAroundCard` and `EmptyDashboardHero` no longer rendered. | `git checkout origin/main -- src/app/(app)/dashboard/page.tsx` and restore the two deleted files below. |
| `src/components/dashboard/getting-around-card.tsx`, `src/components/retention/empty-dashboard-hero.tsx` | Deleted (no other importers). | `git checkout origin/main -- <path>`. |

### 5. Pages that say what they are

| File | Change | Revert |
|---|---|---|
| `src/components/layout/train-zone-swipe.tsx` | Segments read "Strength / The Lab" and "Endurance / The Engine"; full-width on phones. | `git checkout origin/main -- <path>` |
| `src/app/(app)/gym/page.tsx`, `src/app/(app)/cardio/page.tsx` | H1 "Strength" / "Endurance" with brand name in the eyebrow and a one-line subtitle on all sizes. "Endurance Blend" → "Endurance score". | `git checkout origin/main -- <path>` |
| `src/components/activities/log-launcher.tsx` | Label order plain-first; "Log a workout". | `git checkout origin/main -- <path>` |
| `src/app/(app)/activities/page.tsx` | H1 "Logbook" (matches the nav) with a subtitle. | `git checkout origin/main -- <path>` |
| `src/components/analytics/analytics-client.tsx` | PageHeader subtitle added. | `git checkout origin/main -- <path>` |
| `src/components/social/social-hub.tsx`, `src/app/(app)/social/page.tsx` | PageHeader subtitle; `?tab=` query selects the opening tab (`initialTab` prop, validated). | `git checkout origin/main -- <both>` |
| `src/app/(app)/settings/settings-client.tsx` | Sentence under the title instead of a label. | `git checkout origin/main -- <path>` |
| `src/app/(app)/help/page.tsx` | "Getting around" rewritten for the new shape (tabs, the two halves of Train, the Progress page, behind your avatar). | `git checkout origin/main -- <path>`; depends on item 1. |

### 6. Running the native shell against a local build (found while verifying)

| File | Change | Revert |
|---|---|---|
| `src/lib/security/csp.ts` | `upgrade-insecure-requests` is now production-only in both policies, and the dev `connect-src` also allows `ws:`/`wss:`. WebKit, unlike Chrome, upgrades `http://localhost` subresources and does not treat `'self'` as covering the HMR websocket, so a Capacitor WebView pointed at a dev server rendered unstyled HTML. Production output is byte-for-byte unchanged (`csp.test.ts`, `proxy-csp.test.ts`). | `git checkout origin/main -- src/lib/security/csp.ts` |
| `next.config.ts` | HSTS header is production-only (WebKit stores it for localhost and then refuses plain HTTP for two years); `allowedDevOrigins: ["127.0.0.1"]`. Dev only; production headers unchanged. | `git checkout origin/main -- next.config.ts` |

Even with these, Next's dev client forces a document reload shortly after
load inside the WebView, which Capacitor reports as a cancelled navigation and
answers with its offline page. The simulator check was therefore done against
`next build` + `next start` behind a local HTTPS proxy with a CA installed via
`xcrun simctl keychain add-root-cert` — the same conditions as production.

### 7. Hybrid Plan screen: the plan first, the prose folded

| File | Change | Revert |
|---|---|---|
| `src/components/hybrid-plan/hybrid-plan-screen.tsx` | The rebuild notice and the "Is the target realistic?" notes moved from above the tabs to `<details>` cards under the plan (`FoldedNotes`), shut by default with a one-line summary. Subtitle shortened. The medical referral stays above the plan. | `git checkout origin/main -- <path>` |
| `src/components/hybrid-plan/day-detail.tsx` | "Why this session?" no longer opens by itself on a one-session day; the engine identifier caption under the finding text is gone. | `git checkout origin/main -- <path>` |

### 8. Running score: median anchor re-sourced

| File | Change | Revert |
|---|---|---|
| `src/lib/scoring/cardio-benchmarks.ts` | Two anchors move. The 5 km median goes from 30:00 (a "reasoned middle point") to 31:28, RunRepeat's 34-million-result men's median, which the same comment already cited. Then, on Stephen's decision to aim a 50:00 10 km at 70, the 80th-percentile anchor goes 21:45 → 22:47 (the sources put the 75th at ~23:00, so this is the generous edge of what they support). 95th and 99th unchanged. Effect at age 30: 50:00 10 km 66.7 → 70.0; 60:00 10 km 56.4 → 60.2; half at 5:30/km 64.1 → 67.5; 5 km at 4:00/km 80.5 → 81.7; a 19:00 5 km race unchanged. | `git checkout origin/main -- src/lib/scoring/cardio-benchmarks.ts docs/pre-launch/calibration-data.md` and the five tests that pin the anchors (`cardio-benchmarks-{run,row,swim}.test.ts`, `cardio-sex-calibration.test.ts`). |

Tried and rejected: softening the effort-curve exponent (2.2 → 2.0) lifts runs whose heart rate shows restraint by 0.2–0.7 of a point, but moves the one validated tempo data point (6 km at 4:06, 178 bpm) out of its pinned range. The reported session itself (10 km at 5:00/km, 180 bpm) sits at or above the model's sustainable-intensity ceiling, so no heart-rate lever can touch it; it is scored purely against the population table, which is what this change moves.

### 9. Merge of `origin/main` (the "App UI and performance fixes" session)

Merged at `f2dc8ab8`. Conflicts in the Strength/Endurance page headers (took the new one-strip layouts from main, kept the plain-word headings) and the sidebar (kept the Plan group). The two new `loading.tsx` skeletons from main were relabelled to match the headings.

## Verified

- `npx tsc --noEmit`: clean.
- `npx vitest run`: 242 files, 3191 tests, all passing (includes the nav,
  CSP, accessibility and no-sideways-scroll suites).
- Browser and iOS Simulator checks are recorded in the session report.

## Not changed on purpose

- The Hybrid Plan stays premium-only for generation (decided 21 Sep); the
  Plan tab shows the existing "Built with Premium" explanation to free users.
- `/hybrid-plan/monitoring` still has no inbound link, and the data-export
  API still has no UI. Both were found during the audit and are noted for a
  follow-up rather than bolted on here.
- `src/components/dashboard/zone-panels.tsx` still says "Strength HQ"; it is
  not rendered anywhere.
