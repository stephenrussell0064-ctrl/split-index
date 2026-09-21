# Reconciling the migration ledger with production

Written 21 September 2026, the morning App Store approval landed. The runbook
named this as the post-approval task and said explicitly not to attempt it
mid-submission. That condition has lapsed.

Everything in the first section is **measured**, not inferred. The method is
PostgREST with the service-role key, `limit=0` and `Prefer: count=exact`, so
existence and row counts were read and no athlete data was fetched or printed.

---

## 1. What production actually has

`main`'s numbering is what production ran. This is settled by artifact, not by
reading the local `supabase/migrations/` directory — which is a catalogue of
one branch, not of the database.

| Probe | Result | What it settles |
|---|---|---|
| `blocked_users` | exists | main's `057_moderation_block_and_report` ran |
| `user_blocks` | absent | the app-store line's `062_blocks_and_reports` never ran |
| `admin_access_log` | exists | main `062` (= branch `059`, byte-identical) |
| `security_events` | exists | main `063` (= branch `060`, byte-identical) |
| `leaderboard_profiles` to `anon` | denied | main `072` ran |
| `profiles` to `anon` | 0 of 14 rows | main `073` ran — it records every row being readable before |
| `session_templates` | exists | main `075` ran |
| `workout_scores.personal_index` | exists | `077` ran |
| `strength_scores.personal_index` | exists | `077` ran |
| `activity_streams` | exists | `078` ran (through the SQL editor — see §4) |
| `rpc/personal_best_efforts` | responds | `079` ran |
| `hpe_generation_events.endurance_goal_z` | exists | `080` ran |

So production is **main's lineage through 075, plus 076–080 from the app-store
line**. The schema is not behind. The problem is entirely one of file numbering
and ledger rows.

Two probes that look alarming and are not:

- `public_profiles` returns all 10 rows to `anon`. That is the design — `073`
  removes public read from the base tables and routes cross-athlete reads
  through the `public_*` views. The view exposes `username`, `display_name` and
  `injury_status` only; every column from `073`'s sensitive list (date of
  birth, weight, height, gender, max/resting HR, Stripe customer, subscription
  tier) is absent from it.
- `profiles` answers `anon` with HTTP 200. That proves table-level `SELECT`
  only. The row count is 0 of 14, so RLS is holding. A `limit=0` request that
  succeeds is not evidence of a leak, and reporting it as one would be wrong.

`injury_status` being readable without authentication is health-adjacent. It is
presumably the intended social feature; worth a deliberate decision rather than
an assumption.

---

## 2. Where the files disagree

The divergence starts at **057**, not 059. `origin/main` and the app-store line
forked on 6 September 2026 at `adb35c5`; main is +201 commits and the app-store
line +112.

**Six numbers hold different migrations on the two lines:**

| Version | App-store line | `main` | Verdict |
|---|---|---|---|
| 057 | `article9_consent` | `moderation_block_and_report` | branch file is byte-identical to main's `060` |
| 058 | `require_verified_email` | `activity_idempotency` | identical to main's `061` but for one comment naming the renumber |
| 059 | `admin_access_log` | `provisional_index_history` | byte-identical to main's `062` |
| 060 | `security_events` | `article9_consent` | byte-identical to main's `063` |
| 061 | `display_name_is_never_an_email` | `require_verified_email` | **different** from main's `064` — see §3 |
| 062 | `blocks_and_reports` | `admin_access_log` | superseded; creates `user_blocks`, production has main's `blocked_users` |

**Thirteen of main's files are absent from the branch:** 063–075.

**Five of the branch's files are absent from main:** 076–080.

---

## 3. The one file that is not a duplicate

`061_display_name_is_never_an_email` is **not** a renumbering of main's `064`.
Both rewrite `handle_new_user()`; they differ in what they accept:

- main `064` drops the `NEW.email` fallback. A `full_name` that *is* an email
  address is still written to `display_name`, and `display_name` is published
  to `anon` through `public_profiles`.
- the branch version additionally discards a provider-supplied name matching
  `%@%`.

Production runs main's `064`, so the stricter rule is not live. Measured on
21 Sep 2026: **zero** rows in `profiles` or `public_profiles` hold a
`display_name` containing "@". This is a latent path, not an active exposure.

The correct file already existed as `070_display_name_never_an_email_at_source.sql`
on `integrate/migration-ledger`, where its number collides with main's
`070_account_deletion_survives_index_sync.sql`. It has been brought across as
**`081_display_name_never_an_email_at_source.sql`**, renumbered above every
version used on any branch or tag (080 was the maximum, checked rather than
recalled). It also re-asserts the revoke of `EXECUTE` from `PUBLIC`, `anon` and
`authenticated`, which neither `061` nor `064` does.

---

## 4. What remains, and why it was not done automatically

### 4.1 Renumber to match production — DONE

Done on `integrate/main-and-app-store-line`, and **not** as the merge this
section originally proposed.

The merge was attempted first, in a throwaway worktree so the shared checkout
was never touched. It conflicts in **83 files and over 200 hunks** — both lines
independently evolved `gps-run-client` (45 hunks), `settings-client` (15), the
billing and auth screens, and the HPE engine. Resolving that blind would
silently revert security work, so it was aborted.

It is also more than this problem needs. The migrations directory describes the
*database*, not the branch's features, and the database is main's. So the fix
is a renumbering, not an integration:

- main's 057–075 brought across, all 19 byte-identical to main;
- four of the six collisions were the same file under a lower number and are
  renames (`057→060`, `058→061`, `059→062`, `060→063`); `058` differed only in
  a comment naming the renumber;
- `062_blocks_and_reports` deleted — it creates `user_blocks`, a second answer
  to blocking that production never took. Its only reader,
  `api/moderation/block`, has no callers and now points at `blocked_users`,
  whose `UNIQUE (blocker_id, blocked_id)` satisfies the same upsert;
- `061` superseded by `081` (§3), and the tests that pinned the scrub repointed;
- five tests that pin migration filenames updated, plus `profile_usernames`
  added to the expected view set — it is main's seventh projection, added by
  `073` rather than by `056` with the other six.

Result: a gapless 001–081 matching production's numbering. Verified in the
worktree — 147 files, 2145 tests, `tsc` clean.

**Still open: main's 201 commits of application code.** That is a separate
decision, and it probably runs the other way — the app-store line into main,
main being trunk.

### 4.2 Repair the ledger

`078_activity_streams` reached production through the Supabase SQL editor,
which writes **no row** to `supabase_migrations.schema_migrations`. A `db push`
will therefore run it again. Its header records that it is re-runnable, but the
ledger should say what is true:

```
supabase migration repair --status applied 078
```

Check the others the same way before pushing anything. The ledger could not be
read while writing this: it lives in the `supabase_migrations` schema, which
PostgREST does not expose, and the CLI is not linked — linking needs an access
token and a database password, which is not something to hand to an agent.
**Read the ledger yourself before the first `db push`,** and treat §1 as
evidence about the *schema*, which is a different question from what the ledger
records.

### 4.3 Then apply 081

`081` is additive, idempotent, and independent of the merge. It can go first if
the merge is deferred.

---

## 5. Order that avoids the known traps

1. Read `supabase_migrations.schema_migrations` and write the real list down.
   Nothing below is safe until this has been done by a person with the
   credentials.
2. `supabase migration repair --status applied` for anything applied out of
   band — `078` at minimum.
3. Take `integrate/main-and-app-store-line` (§4.1) onto whichever branch is
   deploying. It is a renumbering only; no application code moves with it.
4. Apply `081`. It is additive and idempotent, and its part 2 is expected to
   update zero rows.
5. Only then `supabase db push`, and read what it proposes before confirming.
   If it offers to apply anything numbered 057–075, stop: the ledger and the
   files still disagree and step 1 was skipped or misread.

Never renumber a migration that has already been applied, and never number new
work off the current branch's highest — number it above every branch and tag.
Two sessions both numbered new work `064` on 19–20 Sep; renaming one to `065`
swapped one collision for another.
