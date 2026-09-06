# Regression sweep — Split Index

Branch `hybrid-plan-engine`, HEAD `882a5a6`. Method: read the last 150 commit
messages, extract the user-visible invariant each bug-fix commit established,
then check the invariant against the code at HEAD rather than against the
commit that introduced it. Special attention to files the last eight commits
rewrote or deleted.

## Gates

Run at the start of the sweep, against a clean tree at `882a5a6`:

| Gate | Result |
| --- | --- |
| `npx vitest run` | 98 files, 1348 tests, all pass, exit 0 |
| `npx tsc --noEmit` | 0 errors |
| `npx next build` | succeeds, all routes compiled |

All three gates are green. **Every regression in R1-R4 below is invisible to
all three**, which is the point of reading the commits instead of the test
output.

## Working tree, read at the end of the sweep

`git status` was clean when this sweep began. It is not now, and none of the
following is mine — this document is the only file this pass wrote. Another
session is evidently working in this tree concurrently (by the end of the
sweep it had also added `conversions.test.ts`, `format.test.ts`,
`next-rank-card.test.ts`, `056_public_projections.sql`, and flipped
`global_leaderboards` to `free: true` in `src/lib/premium/features.ts`). The
observations below are point-in-time; W1's bad constant was already reverted by
the time I re-checked. **The reasoning in W1 still stands regardless of the
constant**, and W2 was still live at the end.

### W1 — `KG_PER_LB` was set to 1, and nothing caught it

**Severity: high. Bad constant since reverted by another session; the missing
guard it exposed is the durable finding.**

```
src/lib/units/conversions.ts:5
-const KG_PER_LB = 0.45359237;
+const KG_PER_LB = 1;
```

`npx vitest run` reported every test passing with this in place — 1356 of
1356. There was no test over `lbToKg` / `kgToLb` at all. The one thing that
looks like a guard is worse than absent, and that part has not changed:

`src/lib/scoring/unit-consistency-check.ts:90-123` scores a bench press at
`benchKg` and again at `lbToKg(kgToLb(benchKg))`, then asserts the two indexes
match. That is `x` against `f⁻¹(f(x))` — an identity for **any** value of
`KG_PER_LB`, including 1 and including 0. It is also a `tsx` script, not a
vitest file, so `npm test` and the new CI gate never execute it. A check that
cannot fail, wired to a runner that never calls it.

The imperial entry path was therefore completely unguarded: a user entering
220 lb would have been scored as 220 kg. `conversions.test.ts` has since
appeared untracked; `unit-consistency-check.ts` should still either be deleted
or rewritten to assert against literals, because as written it will keep
looking like coverage that does not exist.

### W2 — A vendored skill's test file breaks the suite

**Severity: medium — it breaks the CI gate added two commits ago.**

`.claude/skills/reelfarm/scripts/match.test.mjs` is untracked and matches
vitest's default include glob, so `npx vitest run` now reports
`Test Files 1 failed | 99 passed` and exits non-zero. The file calls
`process.exit(0)` at top level, which vitest treats as a suite failure.

`vitest.config.ts` sets no `include` and no `exclude`, so anything named
`*.test.*` anywhere in the repo outside `node_modules` is collected. `2c4cefe`
made `npm test` a blocking CI job on the strength of the suite being green;
this makes it red on a file that is not application code. Either scope
`include` to `src/**` or add `.claude/**` to `exclude`.

### W3 — Untracked `src/lib/social/public-projections.test.ts`

New test file, +8 tests, passing. Presumably WP1 of the hardening brief in
progress. No action; noted so it is not mistaken for part of `882a5a6`.

---

## Invariant table

`yes` = upheld and a test would catch its removal. `untested` = upheld, but
enforced only by a comment — nothing fails if the next edit removes it.
`NO` = broken at HEAD.

| Commit | Invariant | Holds? | Evidence |
| --- | --- | --- | --- |
| 882a5a6 | An unfinished health section must not produce a capped, half-ramped block | **NO** | `src/lib/scoring/hpe/safety.ts:158-165` vs `src/lib/scoring/hpe/intake-record.ts:530-534` |
| 882a5a6 / de59425 / safety.ts header | "The screen must produce referrals, not just refusals… the referral is shown either way" | **NO** | `src/components/hybrid-plan/hybrid-plan-screen.tsx:321,348` — referrals render only inside `if (!data.generated)` |
| 882a5a6 | Current injury caps at 88% of 1RM, recent at 95%, neither halves the ramp | partial | `src/lib/scoring/hpe/constants.ts:635-640` correct; surgery default at `:634` (0.8) and `safety.ts:164` (0.5) override both |
| 882a5a6 | The home page's race strip and the iOS widget are built from one `raceLadder` | yes | `src/app/(app)/dashboard/page.tsx:355-390` — one `raceLadder`, both consumers |
| 882a5a6 | The `+` picker must reach every sport (Gym no longer ninth/below the fold) | untested | `src/components/activities/log-launcher.tsx:80,100` — gym explicit + 8 endurance = all 9 of `SPORTS` |
| 882a5a6 | `GPS_OPTIONS` must not get ahead of the tracker's `GPS_SPORTS` | untested | `log-launcher.tsx:34-38` vs `src/app/(app)/cardio/gps-run/page.tsx:64-68` — two hand-kept lists, agree today |
| 882a5a6 | The band variant must not lose a state's only call to action | yes | `src/components/dashboard/todays-session-card.tsx:282,306` — `PlanLink` still renders in both no-plan states |
| 882a5a6 | Vacuous fixture: surgery, not injury, was producing the asserted `0.5` | fixed | `src/lib/scoring/hpe/engine.test.ts:276` now pins `surgeryLast6Months: false` |
| adb35c5 | On-ramp anchor floors at half of active running volume, can only rise, never above what was held | yes | `src/lib/scoring/hpe/onramp-floor.test.ts:57-76` |
| adb35c5 | A week's endurance budget floors at `MIN_ENDURANCE_SESSION_MIN`; zero stays zero | yes | `src/lib/scoring/hpe/macrocycle.ts:123`, `onramp-floor.test.ts:86` |
| f8421c0 | "Nothing in this plan will ask you to run" only when the modality is not running | yes | `src/lib/scoring/hpe/modality.ts`, `plan-notes.test.ts` |
| f8421c0 | The ACWR below-floor note must not fire on the taper | yes | `src/lib/scoring/hpe/engine.ts` + `plan-notes.test.ts` |
| ff705b2 | Weekly volume divisor is the window ending TODAY, floored at a week, capped at `HISTORY_WEEKS` | yes | `src/lib/scoring/hpe/diagnostics-volume-window.test.ts` |
| ff705b2 | `diagnose` stays pure — no clock; the window is passed in by the loader | yes | `src/lib/scoring/hpe/load-profile.ts` |
| 7eee12b | Target total and current total are summed over the SAME lift set; a targeted lift with no 1RM leaves reachability `null`, not `false` | yes | `src/lib/scoring/hpe/feasibility-strength-basis.test.ts` |
| 7eee12b | Priority is derived by counting DOMAINS, not individual targets | yes | `src/app/api/hpe/plan/route.ts` |
| 850c797 / e1c76e9 | Nothing reads `training_goals`; `/api/hpe/plan` takes priority from hybrid-plan targets | yes | grep: no reader outside migration 055 |
| f632576 | One ruler for best-ever 1RM — `strength_scores`, the same table the leaderboard reads | yes | `src/lib/activities/all-time-one-rm.ts:76-81`, `all-time-one-rm.test.ts:38` |
| f632576 | `gym_exercises.estimated_1rm_kg` must not be used comparatively | yes | only reader is `api/gym-exercises/history` |
| 882a5a6 | `fetchBestLoggedSbdSets` reads `weight_kg` (what was on the bar), never the flat e1RM column | untested | `all-time-one-rm.ts:111-149` — new function, no test |
| bcf8041 / 5547f40 | Edit/merge/unmerge pass `recentActivityRows`, so the index cannot collapse to one session | untested | `src/lib/activities/score-and-persist.ts:405,445` |
| 5547f40 | Profile index recomputes from the newest surviving history row, on INSERT/UPDATE/DELETE | untested | `supabase/migrations/054_profile_index_follows_latest_session.sql` (SQL, unreachable from vitest) |
| 88c568a | Rank the number the page actually shows, not the stored one | yes | `src/app/(app)/dashboard/page.tsx:564-567` ranks `headlineValue` |
| 88c568a | Never "Top 0%" or "Top 100%" | yes | `src/lib/retention/rank.ts:62-64`, `src/lib/retention/top-percent.test.ts` |
| 88c568a | The rank card's gap must go through `formatIndex` (was off by ten) | untested | `src/components/retention/next-rank-card.tsx:80,111` |
| 88c568a / 9515fa6 | Today's session reads the STORED plan; a dashboard load must never write one | yes | `src/components/dashboard/todays-session-data.ts:91-108` (read-only) + its test |
| e50a692 | The dashboard headline is always the combined Split Index | yes | `src/app/(app)/dashboard/page.tsx:523-524` |
| 8c6521a | Upcoming Races sits below readiness/coach/interference/trend | yes | `src/app/(app)/dashboard/page.tsx:828` |
| 149ec9b | Route restore: clears on `/login` and `/auth/*`, path only, 6h cap, `/admin` excluded | yes | `src/lib/native/last-route.ts:42,58-71,80-90,124-127` + `last-route.test.ts` |
| 979ad6c | Derived chips always mounted at fixed height; the typed row must not move | untested | `src/components/activities/gym-form.tsx` (layout, no test harness) |
| fc92be9 | `createSetRow()` / `createExerciseRow()` take no argument — no silent prefill | yes | `src/components/activities/form-state.ts:428,440-446` |
| ae6e572 | The Lab's live score must keep calling `scoreStrength`, not the legacy V2 engine | untested | `src/components/activities/gym-form.tsx:26,608` (guardrail comment only) |
| 00bd5d2 / c97ea28 | Routes truncated 200m from each end at the write boundary | yes | `src/lib/scoring/gps-track.ts` + `gps-track.test.ts` |
| f710b30 | An injury reported to the Hybrid Plan must NEVER auto-publish to the social profile | untested | `src/components/profile/injury-status-card.tsx:105` is the only writer of `profiles.injury_status` |
| f710b30 | `injury_status` is read through `parseInjuryStatus`, never cast from the row | untested | `src/lib/social/queries.ts:30,426`, `src/app/(app)/profile/page.tsx:59` |
| 4914f88 | Swimming reads `/100m` everywhere — no hand-rolled per-km copies | yes | `raw-stats-panel.tsx:49`, `merge-activities-modal.tsx:64` both call `formatSportPace`; `format-sport-pace.test.ts:21` |
| 4914f88 | The decay note is explanatory only — `predicted5kSeconds` untouched | yes | `src/app/(app)/dashboard/page.tsx:285-292` |
| 6c0cd67 | Counts render plain; only index scores go through `formatIndex` | untested | `src/components/profile/profile-header.tsx:55-63,127,143` |
| 5965fe2 / e93a6f0 | The widget publishes `calibrating`/`noData` explicitly and is gated on the same values the app shows | yes | `src/app/(app)/dashboard/page.tsx:314-390` |
| 2de463a | Route and fleet script call the same `recomputeUser` | untested | `src/lib/activities/recompute-user.ts` (has a test file, but the "one implementation" property is not asserted) |
| 37d598c | `allTimeOneRM` / `currentOneRM` / `oneRM` stay three distinct values | yes | `src/lib/scoring/one-rm-all-time-vs-current.test.ts` |
| bc0a78d / 8c53c5a | A recompute/merge/unmerge must not report a score it never saved | yes | route tests present and passing |
| topPercent, feasibility, macrocycle, ACWR, Riegel-by-sport, swim/row rebasing, tier gates, LEA suppression | as committed | yes | 1348 passing tests across `src/lib/scoring/**` |

---

## Live regressions, most severe first

### R1 — The safety screen's referrals are now rendered nowhere

**Severity: high (safety content).** Introduced by `882a5a6`.

`882a5a6` deleted the "Read this first" and "Before you start" cards from
`hybrid-plan-screen.tsx`. Those cards were the only render site for
`safety.advisories`, `safety.warnings` and — on the generated path —
`safety.referrals`.

The remaining referral render site is inside the refusal branch:

- `src/components/hybrid-plan/hybrid-plan-screen.tsx:321` — `if (!data.generated) {`
- `src/components/hybrid-plan/hybrid-plan-screen.tsx:348` — `{referrals.length > 0 && (`

But the health screen no longer refuses anything — that was the deliberate
reversal in `de59425`, restated at `src/lib/scoring/hpe/safety.ts:67-90`. So on
every health path the plan generates, and the referral is on the branch that
never runs. A grep across `src/app` and `src/components` finds no other reader
of `advisories` or `referrals`.

What this means in practice:

- An athlete who ticks **exertional chest pain or a positive PAR-Q** has their
  plan capped to `MEDICAL_CLEARANCE_INTENSITY_CEILING` (0.65) and gets
  `referrals.push("GP / sports physician")` — and sees neither the advisory
  ("it is the one thing on this form worth a GP appointment this week") nor
  the referral anywhere in the app.
- An athlete with **two or more low-energy-availability flags** gets
  `"Registered sports dietitian"` and the eating-disorder helpline pushed into
  `referrals` (`safety.ts:224-225`) and sees neither. The file's own reasoning
  at `safety.ts:210-216` is that "the referral is the intervention" and that
  refusing the plan "loses the athlete at exactly the moment the app has a
  reason to keep talking to them". The plan is no longer refused, and the
  referral is no longer shown either.
- The **pregnancy/postpartum** advisory and the **acute weight cut + same-day
  race** advisory are likewise computed and discarded.

This is invisible to the suite because the tests are library-level. Notably
`engine.test.ts:1134` — *"still refers, because the referral is the actual
intervention"* — asserts `safetyScreen(...).referrals` contains a dietitian and
the helpline, and passes. The function still returns them; nothing renders them.

Both halves of `882a5a6` are individually defensible (the cards genuinely did
fire on unanswered questions, and the owner asked for them out). The regression
is that the referral list went out with them, and nothing in the file that
removed them mentions referrals — the removal comment at
`hybrid-plan-screen.tsx:460-481` lists what is *not* removed
(`intensityCeiling`, `rampMultiplier`, `showBodyweightGuidance`) and does not
notice that referrals were only ever rendered there.

**Fix shape:** render `data.safety.referrals` on the generated path too —
somewhere calmer than a card above the plan, as that comment itself suggests.
The chest-pain advisory in particular should not be reachable only through the
API response.

### R2 — An unanswered health section still produces a capped, half-ramped block

**Severity: medium-high.** The stated fix in `882a5a6` is incomplete.

`882a5a6`'s own message: *"for anyone who had not finished the health section
they fired on answers never given — `injuryLast12Weeks` resolves to true until
answered, so an unfinished form produced an injury warning and a capped block…
the injury dials are turned down to where they belong: a current injury caps at
88% of 1RM rather than 75%, a recent one at 95%, and **neither halves the ramp
any more**."*

Both injury dials were duly softened (`constants.ts:635-640`). But
`surgeryLast6Months` reaches `safetyScreen` by the **identical**
`conservative(..., true)` default:

```
src/lib/scoring/hpe/intake-record.ts:530
      surgeryLast6Months: conservative(
        record.surgeryLast6Months,
        "Recent surgery is assumed until you answer otherwise, which adds a clearance prompt.",
        true
      ),
```

and it was left at the old numbers:

```
src/lib/scoring/hpe/safety.ts:158-165
  if (s.surgeryLast6Months) {
    warnings.push("Surgery within 6 months: loads are held below maximal and the ramp is halved. …");
    intensityCeiling = Math.min(intensityCeiling, RECENT_SURGERY_INTENSITY_CEILING);  // 0.8
    rampMultiplier = Math.min(rampMultiplier, 0.5);
  }
```

So an athlete who has not completed the health section still gets a **0.80
intensity ceiling** (tighter than the 0.88 the current-injury dial was
deliberately loosened to) and a **halved ramp**, on a question they were never
asked. That is precisely the outcome `882a5a6` set out to eliminate.

Two aggravating details:

1. The warning text asserts *"Surgery within 6 months"* as a statement of fact
   about someone who gave no answer. The LEA branch immediately below
   (`safety.ts:226-235`) exists specifically to distinguish suppressing on a
   guess from *asserting* on one, using `leaScreenAnswered`. There is no
   equivalent `safetyDone` distinction for surgery — the flag is a plain
   boolean and the caller cannot tell the two apart.
2. Because of R1, that warning is now rendered nowhere, so the athlete cannot
   even see why their block is capped. The `resolveSafetyFlags` "assumed" note
   does surface, but on the **Diagnostic tab**
   (`hybrid-plan-screen.tsx:519`), not beside the plan.

The new test added by the same commit pins the current behaviour rather than
catching it: `programming.test.ts` asserts `intensityCeiling >= 0.8` and
`rampMultiplier >= 0.5` with all three flags set true, so it cannot
discriminate the surgery dial from the injury dials.

**Fix shape:** either give surgery an `answered` companion the way LEA has one,
or bring the unanswered-default ceiling/ramp for surgery in line with the
injury dials and reserve 0.8/0.5 for an explicit "yes".

### R3 — Two Split Index numbers on one page

**Severity: low. Pre-existing, not introduced by `882a5a6`,** but it is the
exact defect class `88c568a` named ("the dashboard ranked a number it never
displayed") and it survived that fix.

The hero renders `headlineValue` — `liveIndexes?.headline ?? current.split_index`
(`dashboard/page.tsx:524`). `getGlobalRankPercentile` was correctly moved onto
that value (`:566`). But three consumers further down still read the stored
snapshot:

- `dashboard/page.tsx:814` — `GoalsCard currentIndex={current.split_index}`,
  which renders `formatIndex(currentIndex)` beside the goal target
  (`goals-card.tsx:359,367`) and seeds the suggested target (`:207`).
- `dashboard/page.tsx:809-810` — `FocusWeekCard` endurance/strength.
- `dashboard/page.tsx:574` — `weakerSide`, which drives the greeting line.

Whenever anything was freshly scored this request, the hero and the goals card
show different Split Index values on the same screen.

### R4 — Vacuous assertion still present in `engine.test.ts:231`

**Severity: low (test quality, not product behaviour).**

The fixture the brief flagged is fixed at `engine.test.ts:276`. The same class
survives one test above it:

```
src/lib/scoring/hpe/engine.test.ts:231-249
  it("holds prescribed loads under the ceiling the screen set", () => {
    … calibrationState({ safety: { ...DEFAULT_SAFETY_FLAGS, currentInjuryLimiting: true } })
    expect(ceiling).toBeLessThan(1);
```

`DEFAULT_SAFETY_FLAGS` sets `surgeryLast6Months: true` (`intake.ts:113`), which
alone pins the ceiling at 0.80 — below the 0.88 the `currentInjuryLimiting`
flag contributes. Delete `currentInjuryLimiting: true` and the test still
passes. It measures that the clamp is applied at all, not that the current-injury
answer applies it. Same fix as `:276`: pin `surgeryLast6Months: false`.

---

## Highest-value missing regression tests

Ranked by (damage if it regresses) × (likelihood the next edit breaks it).

1. **The safety screen's output reaches the athlete.** A render-level test over
   `HybridPlanScreen` asserting that, on a **generated** plan whose
   `safety.referrals` is non-empty, the referral strings appear in the output.
   R1 is a whole class of bug — API returns it, UI drops it — and nothing in
   1348 tests can see across that seam. Highest value in this document.

2. **Unanswered ≠ answered-yes, for every safety flag.** A table-driven test
   over `resolveSafetyFlags(parseIntakeRow(null))` → `safetyScreen`, asserting
   the ceiling and ramp an athlete gets for an *entirely blank* health section.
   Pin the numbers. That single test catches R2 and would have caught the
   original `injuryLast12Weeks` defect the day it was written.

3. **Each safety flag moves the dial on its own.** Parameterise
   `safetyScreen` over one flag at a time with every other flag pinned
   `false`, asserting the specific constant each is supposed to produce. This
   makes R4 and its whole family structurally impossible — no test can pass on
   a neighbouring flag's contribution when only one flag is set.

4. **One index per page.** Assert `dashboard/page.tsx` feeds `GoalsCard`,
   `FocusWeekCard` and `weakerSide` from the same value the hero renders.
   Cheapest as a unit test over an extracted `dashboardIndexes()` helper — the
   extraction is most of the fix for R3.

5. **`GPS_OPTIONS` ⊆ `GPS_SPORTS`.** Three lines. Two hand-maintained lists in
   two files with a comment between them saying they must agree
   (`log-launcher.tsx:33`); when they drift, the `+` button links to a tracker
   that silently falls back to running.

6. **The `+` picker reaches every sport.** Assert `LogLauncher` covers
   `SPORTS` exactly. The rewrite happened to keep all nine; the next sport
   added to `SPORTS` will not appear unless someone remembers two files.

7. **`fetchBestLoggedSbdSets` reads `weight_kg`, and only for SBD.** New in
   `882a5a6`, untested, and sitting in the one file whose header warns at
   length about reading the wrong 1RM column.

8. **`score-and-persist` passes `recentActivityRows`.** The defect it fixes
   (`bcf8041`) corrupted the whole peer-rank pool and took two commits and a
   database migration to unwind. It is currently held by a comment.

9. **`profiles.injury_status` has exactly one writer.** A grep-style guard that
   no HPE path writes it. The privacy consequence of getting this wrong —
   health data auto-published to a page other people read — is out of
   proportion to the cost of the test.

10. **Counts never go through `formatIndex`.** `profile-header.tsx` splits
    `indexStats` from `countStats` by convention only; a fourth stat added to
    the wrong array reproduces "2.9 PRs" exactly.

11. **`lbToKg(220)` is about 99.8, not 220.** One assertion against a literal.
    `unit-consistency-check.ts` cannot substitute for it (W1) and never runs.
    Not ranked higher only because it guards an uncommitted change; as a
    permanent test it is three lines for a whole unguarded input path.
