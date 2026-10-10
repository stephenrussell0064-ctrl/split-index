# Logging-effort plan: revert log

Every change made under the logging-effort plan, with how to undo it. The plan
itself lives in the Claude doc "Split Index Logging Effort Plan"; this file is
the part of it that has to be in the repo, because a revert is a git operation.

Rule for this work: one phase, one branch, several small commits; a tag on main
before each phase; this file updated in the same push. Nothing below is a
rewrite of existing behaviour — every piece is additive and switches off by
removing it.

## Fallback points (tags on origin)

| Tag | Main as of | Undoes |
| --- | --- | --- |
| `pre/phase0-false-claims` | `80167f5b`, 9 Oct 2026 | Everything in this plan |
| `pre/phase2-one-tap-gym` | `77ba6997`, 9 Oct 2026 | Phase 2 and later (keeps Phase 0) |
| `pre/phase1-apple-health` | `a3a7e9a9`, 10 Oct 2026 | Phase 1 (keeps Phases 0 and 2) |

Reset main to a tag only as a last resort — it discards every commit after it,
including unrelated ones. Prefer `git revert` of the specific commits listed
below, which leaves everything else in place.

## Phase 0: honour or remove the claims already made

One commit on main: `77ba6997`. Revert with `git revert 77ba6997`.

| Change | File | Undo |
| --- | --- | --- |
| "Manual entry + CSV import" became "Manual entry" | `src/lib/premium/features.ts` | Put the words back (the `csv_import` flag was never removed) |
| Concept2 PM5 reader deleted | `src/lib/native/pm5-monitor.ts` | `git checkout pre/phase0-false-claims -- src/lib/native/pm5-monitor.ts` |
| PM5 removed from the support page, privacy policy, Bluetooth usage string and Info.plist comments | `src/app/support/page.tsx`, `src/app/privacy/page.tsx`, `ios/App/App/Info.plist` | Revert the commit; the copy guard test still passes either way |
| Provider keys and the sync cron line removed | `.env.example` | Revert the commit. Nothing read them |
| README and readiness docs updated | `README.md`, `docs/pre-launch/app-store-readiness.md`, `docs/pre-launch/app-store-remaining.md` | Revert the commit |

## Phase 2: one-tap prescribed gym logging

Branch `worktree-phase2-one-tap-gym`, built as separate commits so each can be
reverted alone. Dependency order, earliest first; reverting an earlier one
without the later ones will not compile, so revert from the latest backwards.

| Commit | What it adds | Undo |
| --- | --- | --- |
| Parser | `src/lib/scoring/hpe/prescribed-sets.ts` and its test. Pure; reads the prescription text back as exercises. Nothing else changes | Delete the two files |
| Link data path | `hpe_session_id` and `prescribed_sets` on `ActivityFormData`, the activity schema, the form state and payload; migration `088_activities_hpe_session_id.sql`; the activities route checks ownership, writes the link, records the feedback row | `git revert` the commit. In the database: `ALTER TABLE activities DROP COLUMN IF EXISTS hpe_session_id;` — the `prescribed_sets` key in `metadata` needs no DDL and can stay |
| Plan screen | `/api/hpe/plan` returns `activityId` and `feedback` per placement; `PlanSessionView` carries them; `day-detail.tsx` mounts `LogPrescribedControl` (new file) for a lift whose day has arrived | `git revert` the commit. Removes the one-tap button and the "Logged" state; the link column keeps working for the form path |
| Gym form prefill | `/gym/log?hpeSession=<id>` fills the form from the prescription; `?recommend=1` fills loads from the athlete's last set; the form shows a mark on each set still as filled in and a banner naming the plan | `git revert` the commit. The form goes back to blank weights; drafts saved with `prescribed` on a set still restore (the field is optional) |
| Session RPE | `session-feedback-control.tsx` offers a 1-10 row after "Nailed it" or "Came up short", and the saved answer is read back on reload | `git revert` the commit. The route always accepted `sessionRpe`; nothing server-side changes |

### What Phase 2 deliberately does not do

- "Nailed it" on its own never creates an activity. An athlete who logs by hand
  without the link would get the session twice. The one-tap button is the only
  thing that creates one, and it is the button that says so.
- The dashboard and `/gym` "today's session" cards do not get the one-tap
  button. They read the stored plan through `loadLatestStoredPlan`, which does
  not select `hpe_sessions.id`; only the plan screen has the ids. Adding it
  there means widening that select, which is a separate change.
- RIR and RPE are never filled in from the prescription. The band is a target
  and the rating is a report.
- The feedback row is written only when every set was logged untouched. Any
  edit leaves the three buttons to the athlete, because an edit inside the
  prescribed band is not "came up short".

### Behaviour that is unchanged for everyone not using it

- A session typed from nothing sends a request body byte-identical to before:
  neither new key is present, no `hpe_sessions` read happens.
- A database that has not applied migration 088 still saves every session.
  A linked one is saved without the link and the server log names the
  migration.

## Phase 1: Apple Health read import

Branch `worktree-phase1-apple-health`, tag `pre/phase1-apple-health` on
`a3a7e9a9`. Reverses the September brief for Apple Health only; the amendment
is written into `docs/MASTER-BRIEF.md` §9 in the same branch.

| Commit | What it adds | Undo |
| --- | --- | --- |
| Samples and mapping | `src/lib/health/samples.ts` — the batch schema and the pure mapping from Apple's vocabulary (workout type → sport, daily means, nightly sleep hours, own-bundle filter). No callers outside the phase | Delete the file and its test |
| Storage | Migration `089_apple_health_import.sql`: `recovery_snapshots.source`, `health_imports`, `health_import_state`. `003_integrations.sql` becomes a no-op stub (it never ran; the ledger records it as applied; a gap would trip `migration-numbering.test.ts`) | `git revert`, then `DROP TABLE IF EXISTS health_imports; DROP TABLE IF EXISTS health_import_state; ALTER TABLE recovery_snapshots DROP COLUMN IF EXISTS source;`. Imported rows survive (find them by `activities.source = 'apple_health'` and the uuids in `health_imports` first) |
| Server | `/api/health/import` (GET state, PUT connect, POST batch, DELETE disconnect); `lib/recovery/data.ts` builds the HRV baseline per source and reports `hrvSource` | `git revert`. The HRV card falls back to one baseline over every row |
| Native | `ios/App/App/HealthImportPlugin.swift` (read-only HealthKit queries), four `project.pbxproj` entries under ids `B7E4A1C2D3F4056789ABCD01/02`, the `registerPluginInstance` line in `MainViewController.swift`, the rewritten `NSHealthShareUsageDescription` in `Info.plist` | `git revert`. Ships only with an App Store build, so until one is cut the plugin is not on any phone |
| Web | `lib/native/health-import.ts` bridge, `lib/health/sync-client.ts`, `components/health/apple-health-card.tsx` (Recovery page and Settings), `components/health/health-auto-sync.tsx` mounted in the app shell, the Apple Health bullet on `/privacy` | `git revert`. On the web the card renders nothing (Recovery) or a note (Settings); removing it removes a card, not a flow |
| Docs | `MASTER-BRIEF.md` §9 amendment, `app-store-readiness.md` HealthKit rows, this file | `git revert` |

### What Phase 1 deliberately does not do

- No background delivery. The app is a WebView, so there is no JavaScript to
  hand samples to while it is in the background; syncing happens on launch
  and on resume, throttled to once a quarter hour. The
  `healthkit.background-delivery` entitlement therefore stays unused and is
  still an open item on the App Store readiness checklist.
- No strength workouts. A watch records no sets, reps or loads, and a gym
  session without exercises cannot be scored. They are read, recorded as seen,
  and skipped.
- No onboarding step. The brief's "no connect-your-watch step" still holds;
  the card is on the Recovery page and in Settings and asks once.
- No Android. Health Connect is a second native plugin; the web side is ready
  for it (the batch schema is platform-neutral) but nothing reads it yet.
- Sleep is stored (`recovery_snapshots.sleep_hours`) and not yet scored.
  Reading it into the recovery score is a scoring change, not an import one.
- Nothing is written to Apple Health. `requestAuthorization` asks for read
  types only.

### Behaviour that is unchanged for everyone not using it

- An athlete who never connects sees no new network traffic: the auto-sync
  checks a per-device hint before asking the server, and the server answers
  "not connected" to anything else.
- A typed HRV for a day is never overwritten by an import for that day.
- A session already logged by hand within ten minutes of an imported workout
  of the same sport is treated as that session, never a second one.
- The app's own GPS run (which starts a HealthKit workout session for the
  AirPods sensor) is filtered out by bundle id in Swift and again on the
  server.
