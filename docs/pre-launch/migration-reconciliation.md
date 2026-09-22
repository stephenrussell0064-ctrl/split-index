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
| `rpc/personal_best_efforts` to `anon` | denied | `082` ran |
| `public_activity_strength_scores` | exists, `anon` denied | `083` ran |
| `viewer_is_blocked_with(uuid)` | exists | `084` ran |
| `pg_default_acl` for `postgres`/`r` | no `anon` | `085` ran |

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

### 4.2 The ledger did not exist — created and backfilled — DONE

This section originally said "repair the ledger". There was no ledger to repair.

`supabase_migrations.schema_migrations` **did not exist on production.** A direct
reference returned `42P01`, and scanning `information_schema.tables` for
`%migration%` found only `auth.schema_migrations`, `realtime.schema_migrations`
and `storage.migrations` — Supabase's own internal tables, none of them the
project's.

This database had **never been touched by `supabase db push`.** All 81
migrations were applied by hand through the SQL editor. That single fact
explains every "applied out of band" oddity recorded elsewhere in this file:
nothing was out of band, because there was no band.

It also meant `db push` was the most dangerous command available. With no
history table the CLI treats every migration as unapplied, and would have
re-run the lot against a live database — including `073`'s policy drops and
`064`'s `DROP VIEW ... CASCADE`.

**What was done, 21 Sep 2026.** Two SQL-editor scripts, because `supabase db
diff` needs Docker to build a shadow database and Docker is not installed on
this machine:

1. A schema check standing in for `db diff`: all 73 objects the migrations
   create — 61 relations, 12 functions — probed against `to_regclass` and
   `pg_proc`. Four relations came back missing. Two (`training_goals`,
   `training_goal_progress`) were *correctly* absent, dropped by
   `055_drop_training_goal_tables.sql`; their absence is evidence 055 ran. Two
   (`import_jobs`, `integration_connections`) were real: **`003_integrations.sql`
   never ran.** Harmless — no application code touches either table, and
   `oauth_sync` is a gated feature key with no call sites and no line in the
   advertised Premium list.
2. The ledger created with the DDL copied verbatim out of the CLI binary
   (v2.117.0), and the 81 migrations recorded as applied. Confirmed: 81 rows.

`003` is recorded as applied deliberately. It creates three enum types with
bare `CREATE TYPE` — Postgres has no `IF NOT EXISTS` for types — so letting
`db push` run it would abort the whole push if those types already exist. **The
integrations schema will therefore never be created by `db push`.** When
Strava/Garmin sync is built it needs a fresh migration at 086 or above, not a
revival of 003; delete `003_integrations.sql` at that point rather than leave a
file that claims to have run.

`002b_apply_missing.sql` is **not** in the ledger and cannot be. The CLI's
version pattern is `/^([0-9]+)_(.*)\.sql$/` — digits only — so `002b` never
parses as a version and the file is invisible to `db push` permanently. If its
contents matter it must be renamed to a real version number.

### 4.3 Apply 081 — DONE

Applied by hand on 21 Sep 2026, before the ledger existed, and recorded in the
backfill above.

---

### 4.4 Record 082–085 as they were applied — DONE

The ledger was created in §4.2 and immediately started going stale: four
migrations were applied after it and none was written down. That is the same
failure it exists to prevent, so the rule now is that a migration is not done
until it has a row in §1.

| Migration | What it did | How its row in §1 was chosen |
|---|---|---|
| `082_revoke_best_effort_functions_from_anon` | took EXECUTE on the best-effort functions away from `anon` | the probe asks `anon` to execute one and expects a denial, which is the thing the migration changed |
| `083_friend_activity_strength_scores` | the friend-visible lift detail behind the social feed — `security_invoker = off`, revoked from `PUBLIC` and `anon`, granted to `authenticated` | existence alone would not settle it, so the probe checks the grant as well; a view that exists but is anon-readable would mean the migration half-ran |
| `084_blocking_is_enforced_by_the_database` | moved blocking from application code into the database — `viewer_is_blocked_with()` plus policies on comments and reactions | the function is the thing every new read path is supposed to filter with, so its existence is the useful signal |
| `085_new_objects_are_not_public_by_default` | removed `anon` from `postgres`'s default privileges on tables in `public` | see the caveat below |

**The caveat on 085, recorded because it changes how much the row is worth.**
Its effect was inferred, not watched. The evidence is that Supabase sets
`postgres` and `supabase_admin` identically at project creation, and afterwards
`supabase_admin`'s default still lists `anon` while `postgres`'s does not — an
asymmetry something had to create, and no migration in this repo has ever
executed an `ALTER DEFAULT PRIVILEGES` except this one.

That reasoning was very nearly used to draw the opposite conclusion. Reading
the clean `postgres` row *after* the migration had been applied looked exactly
like evidence the migration was never needed, and the recommendation at that
moment was to delete it. Cause was mistaken for absence of cause. If a later
session finds grounds to believe the `pg_default_acl` reading predates the
apply, this row is the one to revisit — the others rest on probes that answer
for themselves.

**What the guard now buys.** A new view in `public` is unreachable until
someone writes an explicit `GRANT`. Confirmed on 22 Sep 2026: the only view in
`public` that `anon` can select is `public_profiles`, which is granted by name
in `064` and is meant to be public. Every table returned `rls_on = true`.

---

## 5. Where this leaves the project

Steps 1 to 4 are done. The files are renumbered to match production and the
ledger exists. It records 85 migrations: the 81 backfilled in §4.2, plus
`082`–`085` added in §4.4 as they were applied.

**One step remains, and it needs the database password:**

```
supabase link --project-ref qoohyneotupuxrkwyeup
supabase migration list
```

Every one of the 81 should show as applied on both the local and remote side.
Only once that list reads clean is `db push` safe to use for new work — and the
first time, run `db push --dry-run` and read what it proposes. It should propose
nothing. Anything it offers to apply is a disagreement worth understanding
before it runs.

From here, new migrations follow the ordinary flow: write the file numbered
above every branch and tag, then `db push`. The era of pasting into the SQL
editor is over, and with it the class of problem this document records.

Never renumber a migration that has already been applied, and never number new
work off the current branch's highest — number it above every branch and tag.
Two sessions both numbered new work `064` on 19–20 Sep; renaming one to `065`
swapped one collision for another.
