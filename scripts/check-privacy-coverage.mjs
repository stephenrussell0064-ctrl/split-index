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
 *   node scripts/check-privacy-coverage.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const POLICY = join(ROOT, 'src', 'app', 'privacy', 'page.tsx');
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
 * These are not wording quibbles. The policy's §2 is a list of what is
 * collected, and none of these appears anywhere in the document — "notification",
 * "admin" and "audit" are absent from all 13,375 characters of it.
 */
export const GAPS = {
  notifications:
    'The app stores notifications sent to an athlete, including their content. §2 lists what is ' +
    'collected and says nothing about them; the word "notification" does not appear in the policy.',
  admin_access_log:
    'Staff access to athlete data is recorded, which means staff can access it. An athlete reading ' +
    'this policy would not learn that. Art. 13 transparency is about who sees the data, not only ' +
    'what is stored — and "admin" appears nowhere in the document.',
  admin_users:
    'The same question from the other side: a table of who holds that access. Either it belongs in ' +
    'the same paragraph as admin_access_log, or somebody records here why it does not.',
};

function migrationsText() {
  let text = '';
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    text += readFileSync(join(MIGRATIONS, file), 'utf8') + '\n';
  }
  return text;
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
  const schema = migrationsText();
  // Tag text and JSX entities would otherwise hide a phrase that is present:
  // "comments&apos; you leave" is the policy saying it.
  const policy = readFileSync(POLICY, 'utf8')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();

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
      unaccounted.map((t) => `  · ${t}\n`).join('') +
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

  out +=
    `Guideline 5.1.1(i) and UK GDPR art. 13 both turn on the policy being accurate.\n` +
    `Add the paragraph to src/app/privacy/page.tsx rather than relaxing this check.\n\n`;

  process.stderr.write(out);
  process.exit(1);
}

// Guarded so the test file can import `tablesIn` and the coverage map without
// the check running — and calling process.exit inside the test runner.
if (import.meta.url === `file://${process.argv[1]}`) main();
