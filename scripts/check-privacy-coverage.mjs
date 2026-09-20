#!/usr/bin/env node
/**
 * Does the privacy policy describe what the app actually collects?
 *
 * The milestone this backs says exactly that, and the check behind it used to
 * grep the policy for any one of four phrases. Matching "health data" once
 * anywhere satisfied it, which meant the policy could fall arbitrarily far
 * behind the schema without anything noticing — and it had. Blocks and reports
 * were added to the database this morning and the policy said nothing about
 * either until this script was written.
 *
 * So the check is a comparison rather than a grep. Each entry below pairs
 * **evidence that the app collects something** with **what the policy has to
 * say about it**. When the evidence is present and the policy is silent, the
 * check fails and names the gap.
 *
 * The consequence is the useful part: adding a table that holds personal data
 * turns this red until somebody writes the paragraph. That is the only
 * mechanism here that scales — nobody remembers to revisit a privacy policy,
 * and guideline 5.1.1(i) plus UK GDPR art. 13 both turn on it being accurate.
 *
 * ## That consequence was not true, and this is the part that makes it true
 *
 * Audited 12 Sep 2026. The sentence above is the claim the milestone note
 * repeats, and the rules below could not deliver it: each rule looks for its
 * OWN evidence, so a table nobody wrote a rule for produces no rule, matches
 * nothing, and the check passes in silence. Adding a table turned this red only
 * if somebody also remembered to add a rule — which is the remembering the
 * mechanism was supposed to replace.
 *
 * The schema holds 50 tables, 45 of them keyed to a user. Six categories had
 * rules. So the check was answering a much smaller question than its own header
 * claimed, and passing.
 *
 * `TABLE_COVERAGE` below closes it from the other end: every user-linked table
 * in the migrations must be named here, and an unnamed one fails. The failure
 * is deliberately about the OMISSION rather than about wording — it asks the
 * person who added the table what the policy now has to say, which is a
 * question only they can answer.
 *
 * Enumerating them found three things the policy is silent on. See `GAPS`.
 *
 * ## Whose schema is this? — 20 Sep 2026
 *
 * Enumerating the working tree answers a slightly different question from the
 * one the milestone asks, and the gap between them cost a day. This checkout is
 * shared by several sessions, so "every table in supabase/migrations" includes
 * tables that exist in no commit. The check went red on two of those and the
 * dashboard reported the venture losing four points on a privacy failure that
 * did not exist. See `draftOnly`: unaccounted tables whose migrations are all
 * uncommitted exit 2 — cannot determine — instead of 1.
 *
 *   node scripts/check-privacy-coverage.mjs
 *
 * Exit codes: 0 covered · 1 a gap in the committed schema · 2 cannot determine.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
export const POLICY = join(ROOT, 'src', 'app', 'privacy', 'page.tsx');
const MIGRATIONS = join(ROOT, 'supabase', 'migrations');

/**
 * Each rule: if `evidence` appears anywhere in the migrations, the policy must
 * contain at least one of `mustSay`.
 *
 * `mustSay` entries are lower-cased substrings, deliberately short. The point
 * is to detect silence, not to police wording — a check that demands an exact
 * sentence gets satisfied by pasting that sentence.
 */
const RULES = [
  {
    what: 'activity comments',
    evidence: /create table[^;]*activity_comments/i,
    mustSay: ['comments you leave', 'comments you write'],
  },
  {
    what: 'blocking other athletes',
    evidence: /create table[^;]*user_blocks/i,
    mustSay: ['block another athlete', 'if you block'],
  },
  {
    what: 'content reports, including reports filed about you',
    evidence: /create table[^;]*content_reports/i,
    mustSay: ['report a comment', 'if you report'],
  },
  {
    what: 'health and fitness data',
    evidence: /heart_rate|health_screening|hrv/i,
    mustSay: ['health data', 'apple health', 'healthkit'],
  },
  {
    what: 'location from tracked sessions',
    evidence: /latitude|gps|route_points/i,
    mustSay: ['location', 'gps'],
  },
  {
    what: 'subscriptions and payment status',
    evidence: /stripe_customer|revenuecat|subscription_status/i,
    mustSay: ['payment information', 'billing history', 'subscription status'],
  },
  {
    what: 'the public profile shown to other athletes',
    evidence: /create (or replace )?view[^;]*public_profiles|create table[^;]*public_profiles/i,
    mustSay: ['public profile', 'leaderboard'],
  },
];

/**
 * Every user-linked table, and the clause of the policy that accounts for it.
 *
 * A table is "user-linked" when its definition references a user — `user_id`,
 * `athlete_id`, `profile_id`, `auth.users` and so on. That is a mechanical
 * test, not a legal judgement, and it is the right bar for THIS check: whether
 * the row is about an identifiable person is what UK GDPR art. 13 turns on.
 *
 * The value is the clause of `src/app/privacy/page.tsx` §2 that covers it,
 * quoted closely enough to find. A clause that stops being in the policy fails
 * every table filed under it, which is the point — the categories in §2 are
 * load-bearing and deleting one silently is the failure this guards.
 *
 * `null` means the table holds no personal data. It still has to be listed,
 * because "this one is fine" is a decision somebody made, and an unlisted table
 * is a decision nobody made.
 */
export const TABLE_COVERAGE = {
  // Training data — "contract" in §4, and §2's "Health and fitness data".
  activities: 'workout and activity logs',
  workout_scores: 'performance scores',
  workout_drafts: 'workout and activity logs',
  personal_records: 'performance scores',
  strength_scores: 'performance scores',
  split_index_history: 'performance scores',
  predicted_benchmarks: 'performance scores',
  hybrid_athlete_reports: 'performance scores',
  session_templates: 'workout and activity logs',
  planned_races: 'workout and activity logs',
  body_metrics: 'body metrics',
  sleep_logs: 'recovery metrics',
  recovery_snapshots: 'recovery metrics',
  training_goals: 'training goals',
  training_goal_progress: 'training goals',
  goals: 'training goals',
  leaderboard_entries: 'leaderboard participation',

  // Identity.
  profiles: 'profile details',
  hpe_athlete_profile: 'profile details',

  // Special category — §4's "Your health screening — explicit consent".
  hpe_intake: 'health screening',
  hpe_injury_reports: 'injury history',
  hpe_session_feedback: 'health screening',
  hpe_findings: 'injury risk index',
  hpe_plans: 'ai-generated content',
  hpe_generation_events: 'ai-generated content',
  ai_feedback: 'ai-generated content',

  // Social — §2's "Social features and content you write".
  friends: 'friend connections',
  squads: 'social features',
  squad_members: 'social features',
  challenges: 'social features',
  challenge_participants: 'social features',
  duels: 'social features',
  activity_reactions: 'social features',
  user_achievements: 'social features',
  activity_comments: 'comments you leave',
  user_blocks: 'block another athlete',
  content_reports: 'report a comment',

  // Integrations — §3's "Import and sync activities from connected fitness
  // integrations", and §2's payment clause.
  import_jobs: 'connected fitness integrations',
  integration_connections: 'connected fitness integrations',

  // Operational logs — §2's "Technical and usage data ... logs related to how
  // you use the service".
  security_events: 'logs related to how you use the service',
  hpe_rollout_audit: 'logs related to how you use the service',
  hpe_feature_flags: 'logs related to how you use the service',

  // In-app messages — §2's own bullet, written 13 Sep 2026. Filed under the
  // sentence about who can read them rather than under the heading, because the
  // heading is a label and the disclosure is that only you see them.
  notifications: 'only you can read your notifications',

  // Administrator access — §11's subsection, written 13 Sep 2026. Two tables,
  // two clauses, because they answer different questions and either could be
  // deleted from the policy without the other: `admin_users` is *who holds the
  // role*, `admin_access_log` is *what is written down when it is used*. Filing
  // both under one phrase would let half the disclosure vanish silently.
  admin_users: 'who holds an administrator role',
  admin_access_log: 'administrator access is recorded',

  // No personal data. Reference and catalogue rows, listed so that "fine" is a
  // recorded decision rather than an omission.
  sports: null,
  reference_values: null,
  gym_exercises: null,
  achievements: null,
  hpe_sessions: null,
  article: null,
};

/**
 * Tables the policy does not account for, found by enumerating rather than by
 * anyone noticing. Each fails until the paragraph exists.
 *
 * These are not wording quibbles. §2 is a list of what is collected, and a table
 * absent from the whole document is a disclosure an athlete was owed and did not
 * get.
 *
 * ## Emptied 13 Sep 2026, and what writing the paragraphs changed
 *
 * The three entries here — `notifications`, `admin_access_log`, `admin_users` —
 * were written up on 12 Sep and are now in `TABLE_COVERAGE` above, against the
 * clauses that cover them.
 *
 * Reading the schema before writing changed the wording materially in both
 * directions, which is the argument for stating a gap as a question rather than
 * as presumed wording:
 *
 *  - The note here said staff access to athlete data is recorded, "which means
 *    staff can access it". True, and on its own it would have produced a
 *    paragraph saying our staff can read your health data. They cannot, via that
 *    route: `/api/hpe/admin/fleet` is aggregate-only and `assertNoIdentifiers`
 *    rejects its own response if a UUID or an email address appears in it. The
 *    honest disclosure is narrower and more useful than the gap implied — one
 *    view, across all accounts, showing counts and averages and no rows.
 *  - It is also WIDER in one place the gap did not reach. `admin_access_log` and
 *    `security_events` are `ON DELETE SET NULL`, so they outlive a deletion
 *    request by ceasing to name the account rather than by going. Nothing in §9
 *    said so. That is an art. 17 disclosure found only by following the table
 *    into `src/app/api/account/delete/route.ts`.
 *
 * An empty GAPS is the intended steady state. A table added without a paragraph
 * lands in `unaccounted` above, not here — here is for a gap somebody has looked
 * at and written down.
 */
export const GAPS = {};

/**
 * The policy as prose, for substring matching.
 *
 * Three transformations, each answering a way JSX hides a phrase that is on the
 * page:
 *
 *   &apos; → '      "comments&apos; you leave" is the policy saying it
 *   tags → space    a <strong> mid-sentence otherwise splits the phrase
 *   whitespace      Prettier wraps prose at 90 columns, so any clause longer
 *                   than a few words contains a newline and an indent run in the
 *                   source and none on the page
 *
 * The third one is easy to forget and expensive to forget. On 13 Sep 2026 a
 * mutation test tried to prove three new clauses were load-bearing by deleting
 * each from the file with a literal `perl -0pi -e s///`. Two substitutions
 * matched nothing — the phrases wrap across lines in the source — so the check
 * passed, and the passing check read exactly like a clause that did not matter.
 * The instrument was broken, not the check. Exported so a test can assert this
 * directly rather than a later reader having to rediscover it.
 */
export function normalisePolicy(source) {
  return source
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Each migration file, in the order the database would apply them. */
function migrationFiles() {
  return readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ path: join(MIGRATIONS, file), sql: readFileSync(join(MIGRATIONS, file), 'utf8') }));
}

function migrationsText() {
  return migrationFiles()
    .map((f) => f.sql)
    .join('\n');
}

/**
 * Every table, and the migration that first created it.
 *
 * The check used to report an unaccounted table by name alone, which is the
 * question but not the place to answer it — and, more importantly, not enough
 * for anyone to tell whether the table is part of the venture or part of
 * somebody's afternoon. See `draftOnly` below for why that distinction is load
 * bearing. First definition wins: a table created once and altered later is
 * introduced by its CREATE, and that is the file a reader wants.
 */
export function tableSources(files) {
  const source = new Map();
  for (const { path, sql } of files) {
    for (const table of tablesIn(sql).keys()) if (!source.has(table)) source.set(table, path);
  }
  return source;
}

/**
 * Files git reports as modified, added or untracked — absolute paths.
 *
 * Empty when this is not a repository or git is unavailable: we cannot
 * attribute anything, so nothing is excused and the failure stands.
 */
function uncommittedFiles() {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: ROOT, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '-z', '-uall'], { cwd: ROOT, encoding: 'utf8' });
    return new Set(
      status
        .split('\0')
        .filter((entry) => /^[ MADRCU?!][ MADRCU?!] /.test(entry))
        .map((entry) => join(root, entry.slice(3))),
    );
  } catch {
    return new Set();
  }
}

/**
 * True only when there is something to report and EVERY table reported is
 * defined in a file that is not committed.
 *
 * ## Why this exists, and why it does not weaken the check
 *
 * 20 Sep 2026. This check went red and the dashboard reported Split Index
 * dropping four points on a privacy-policy failure. The policy had not changed
 * and had no gap: at HEAD the check passed, accounting for all 45 user-linked
 * tables. Both tables it named were defined only in an UNTRACKED migration that
 * a concurrent session was still writing. The check was right about what it
 * read and wrong about whose schema it was reading — the same fault, in the
 * same week, that `tests-green` was red for twice.
 *
 * That matters more here than it looks. b7 is an App Store blocker at revenue
 * proximity 5, and a red one is read as "the policy is inaccurate, submission
 * is at risk". Spending an operator's attention on a disclosure for a table
 * that exists in no commit is the expensive direction of this error.
 *
 * Unanimity, so a real omission can never hide behind a draft: one unaccounted
 * table whose migration IS committed and the whole thing exits 1 as before. An
 * empty working tree cannot trigger it — every path fails the membership test
 * against an empty set. A table whose defining file cannot be identified at all
 * counts as committed, which keeps the failure red; the safe direction.
 *
 * It says "don't know" (exit 2), not "fine" (exit 0). The registry opts in to
 * that per check — see `unverifiedOn` in venture-projects/registry/ventures.mjs.
 */
export function draftOnly(tables, sources, uncommitted) {
  if (!tables.length) return false;
  return tables.every((t) => sources.has(t) && uncommitted.has(sources.get(t)));
}

/**
 * Every table in the migrations, and whether its definition references a user.
 *
 * A table created and later altered appears once; if any definition of it is
 * user-linked, it is user-linked. Deliberately generous — a table wrongly
 * called personal costs somebody one line in TABLE_COVERAGE, and a table
 * wrongly called impersonal costs an athlete a disclosure they were owed.
 */
export function tablesIn(schema) {
  const USER_COLUMN = /\buser_id\b|\bathlete_id\b|\bprofile_id\b|auth\.users|\bowner_id\b|\bactor_id\b|\breporter_id\b/;
  const found = new Map();
  const re = /create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
  for (const m of schema.matchAll(re)) {
    const name = m[1].toLowerCase();
    found.set(name, (found.get(name) ?? false) || USER_COLUMN.test(m[2].toLowerCase()));
  }
  return found;
}

function main() {
  const files = migrationFiles();
  const schema = files.map((f) => f.sql).join('\n');
  const sources = tableSources(files);
  const policy = normalisePolicy(readFileSync(POLICY, 'utf8'));

  const gaps = [];
  let checked = 0;

  for (const rule of RULES) {
    if (!rule.evidence.test(schema)) continue; // The app does not collect it.
    checked++;
    if (!rule.mustSay.some((phrase) => policy.includes(phrase))) {
      gaps.push(rule);
    }
  }

  /*
   * The half the rules could not do: start from the schema, not from the list.
   *
   * A rule only fires on evidence it names, so a table nobody wrote a rule for
   * was invisible. Here every user-linked table has to be accounted for, and
   * the default for an unknown one is failure.
   */
  const unaccounted = [];
  const clauseMissing = [];
  const known = new Set(Object.keys(TABLE_COVERAGE));
  let userLinked = 0;

  for (const [table, isUserLinked] of tablesIn(schema)) {
    if (!isUserLinked) continue;
    userLinked++;
    if (table in GAPS) continue; // Reported separately, with the question.
    if (!known.has(table)) {
      unaccounted.push(table);
      continue;
    }
    const clause = TABLE_COVERAGE[table];
    if (clause !== null && !policy.includes(clause)) {
      clauseMissing.push({ table, clause });
    }
  }

  const openGaps = [...tablesIn(schema).keys()].filter((t) => t in GAPS);

  if (gaps.length === 0 && unaccounted.length === 0 && clauseMissing.length === 0 && openGaps.length === 0) {
    process.stdout.write(
      `privacy policy covers all ${checked} categories and accounts for all ${userLinked} ` +
        `user-linked tables in the schema\n`,
    );
    process.exit(0);
  }

  let out = '\n';

  if (gaps.length) {
    out +=
      `The schema collects these and the privacy policy does not mention them:\n\n` +
      gaps
        .map((g) => `  · ${g.what}\n    policy should say one of: ${g.mustSay.map((p) => `"${p}"`).join(', ')}\n`)
        .join('') +
      '\n';
  }

  if (unaccounted.length) {
    out +=
      `${unaccounted.length} table(s) hold data keyed to a user and nothing here says what the\n` +
      `policy tells that person about them:\n\n` +
      unaccounted
        .map((t) => {
          const from = sources.get(t);
          return `  · ${t}${from ? `\n    added by ${relative(ROOT, from)}` : ''}\n`;
        })
        .join('') +
      `\n  Add each to TABLE_COVERAGE in this script, naming the clause of §2 that covers it —\n` +
      `  or \`null\` if it holds no personal data, which is a decision worth recording either way.\n\n`;
  }

  if (clauseMissing.length) {
    out +=
      `The policy clause these tables were filed under is no longer in the policy:\n\n` +
      clauseMissing.map((c) => `  · ${c.table} was covered by "${c.clause}"\n`).join('') +
      '\n';
  }

  if (openGaps.length) {
    out +=
      `${openGaps.length} known gap(s), found by enumerating the schema on 12 Sep 2026:\n\n` +
      openGaps.map((t) => `  · ${t}\n    ${GAPS[t]}\n`).join('') +
      `\n  Write the paragraph, then delete the entry from GAPS and file the table in\n` +
      `  TABLE_COVERAGE under the clause you wrote.\n\n`;
  }

  /*
   * Is this the venture's schema, or somebody's working copy?
   *
   * Only asked when the unaccounted tables are the ONLY complaint. A missing
   * policy clause or a known gap is about the committed policy regardless of
   * what is in the tree, and stays red.
   */
  const onlyUnaccounted = unaccounted.length > 0 && !gaps.length && !clauseMissing.length && !openGaps.length;
  if (onlyUnaccounted && draftOnly(unaccounted, sources, uncommittedFiles())) {
    process.stderr.write(
      out +
        `NOT A POLICY GAP — every table above is defined in a migration that is not\n` +
        `committed in this checkout. This is a draft in the working tree, not the\n` +
        `venture's schema, so the answer is "cannot determine" rather than "the policy\n` +
        `is wrong". It goes red the moment the migration is committed, which is when\n` +
        `the disclosure is owed and when the person who wrote it is there to write it.\n\n`,
    );
    process.exit(2);
  }

  out +=
    `Guideline 5.1.1(i) and UK GDPR art. 13 both turn on the policy being accurate.\n` +
    `Add the paragraph to src/app/privacy/page.tsx rather than relaxing this check.\n\n`;

  process.stderr.write(out);
  process.exit(1);
}

// Guarded so the test file can import `tablesIn` and the coverage map without
// the check running — and calling process.exit inside the test runner.
if (import.meta.url === `file://${process.argv[1]}`) main();
