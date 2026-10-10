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
