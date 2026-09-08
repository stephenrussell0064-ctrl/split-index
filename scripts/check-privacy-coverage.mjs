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

function migrationsText() {
  let text = '';
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql'))) {
    text += readFileSync(join(MIGRATIONS, file), 'utf8') + '\n';
  }
  return text;
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

  if (gaps.length === 0) {
    process.stdout.write(
      `privacy policy covers all ${checked} categories of personal data the schema holds\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nThe schema collects these and the privacy policy does not mention them:\n\n` +
      gaps
        .map((g) => `  · ${g.what}\n    policy should say one of: ${g.mustSay.map((p) => `"${p}"`).join(', ')}\n`)
        .join('') +
      `\nGuideline 5.1.1(i) and UK GDPR art. 13 both turn on the policy being accurate.\n` +
      `Add the paragraph to src/app/privacy/page.tsx rather than relaxing this check.\n\n`,
  );
  process.exit(1);
}

main();
