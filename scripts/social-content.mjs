#!/usr/bin/env node
/**
 * Daily short-form posts for the review window, staged for a person to post.
 *
 * ## Why this exists now rather than after approval
 *
 * The dashboard's own model rates "start posting before approval, not after" as
 * the single largest lever on Split Index — £1,561 of base-case revenue inside
 * the 91-day window, because an audience built during review is an audience on
 * launch day instead of a standing start. The milestone was nevertheless
 * `dependsOn: ['approved']`, which encodes exactly the behaviour the lever says
 * costs that money, and hid it from the ranking entirely.
 *
 * The other stated blocker was a paid ReelFarm subscription. That is a blocker
 * on *volume*, not on starting: fourteen posts written out in full can be
 * posted by hand during a two-week review at no cost. This generates those.
 *
 * ## The rule every post obeys
 *
 * **Each post cites the module that backs its claim.** Fitness content invents
 * physiology constantly and this app is a measurement tool — the one thing it
 * cannot afford is to say something on TikTok that its own engine does not do.
 * A post with no `source` is a post that does not go out, and `--check` fails
 * the build rather than shipping one.
 *
 * Nothing here posts anything. It writes files.
 *
 *   node scripts/social-content.mjs            # write the queue
 *   node scripts/social-content.mjs --check    # verify every post is grounded
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const QUEUE = join(homedir(), 'Projects', 'venture-projects', 'queue', 'social', 'split-index');

/**
 * Fourteen posts — one per day of a typical review window.
 *
 * Ordered so the first week can run without the app being live: each of those
 * stands on the idea rather than on a screen recording, because there is no
 * approved build to record. The second week assumes there is.
 */
const POSTS = [
  {
    day: 1,
    hook: 'Your training app is comparing you to strangers.',
    body:
      'Every percentile you have been shown came from a population. People whose sleep, job, injury history and training age you know nothing about. ' +
      'Split Index scores you against your own history first. Then it tells you where that sits.',
    show: 'Two columns: "vs 40,000 strangers" and "vs you in March". Same athlete, different answer.',
    source: 'src/lib/scoring/percentile-framework.ts',
    needsLiveApp: false,
  },
  {
    day: 2,
    hook: 'Leg day is costing you a minute a mile. Or it is not. Nobody has measured yours.',
    body:
      'Everyone quotes the interference effect at you like a fixed rule. It is not fixed. It varies hugely between people. ' +
      'Split Index measures yours from your own sessions. How your runs actually go one, two and three days after you squat.',
    show: 'A three-day decay curve built from one athlete\'s real sessions.',
    source: 'src/lib/scoring/interference.ts — LOOKBACK_DAYS_STRENGTH_EFFECT_ON_CARDIO',
    needsLiveApp: false,
  },
  {
    day: 3,
    hook: 'Three sessions and you know your own interference number.',
    body:
      'Most analytics want a full training block before they tell you anything. This needs three paired sessions. ' +
      'Low enough to get a real answer in a fortnight. High enough that you are not reading noise.',
    show: 'The number appearing after the third session.',
    source: 'src/lib/scoring/interference.ts — MIN_PAIRED_SESSIONS = 3',
    needsLiveApp: false,
  },
  {
    day: 4,
    hook: 'A 21 minute 5k at 24 is not a 21 minute 5k at 52.',
    body:
      'Athletics has age graded results for decades. Training apps mostly ignore it. ' +
      'Every benchmark here is age graded, which changes who is actually ahead.',
    show: 'Same time, two ages, two completely different standings.',
    source: 'src/lib/scoring/cardio-benchmarks.ts — age grading',
    needsLiveApp: false,
  },
  {
    day: 5,
    hook: 'Your marathon prediction is built on a formula about elite runners.',
    body:
      'Riegel\'s exponent is 1.06. That came from a paper about elites. Yours is not 1.06. ' +
      'Split Index works out your exponent from your own races, so the prediction stops drifting after your first long effort.',
    show: 'Two predicted marathon times. Textbook, and yours.',
    source: 'src/lib/scoring/riegel-k-personalization.test.ts',
    needsLiveApp: false,
  },
  {
    day: 6,
    hook: 'Hybrid training has one honest question. What are you giving up?',
    body:
      'Every hour running is an hour not lifting. You are always trading something. ' +
      'Split Index puts a number on your trade so you can decide whether you want it.',
    show: 'Strength and endurance moving opposite ways across one block.',
    source: 'src/lib/scoring/index-engine.ts — computeIndexes',
    needsLiveApp: false,
  },
  {
    day: 7,
    hook: 'Most fitness apps give you a number no matter how little they have seen.',
    body:
      'Split Index weights every figure by how much of your training it has actually got. ' +
      'You get a straight answer on what it knows and what it is still building, so you can trust the numbers it does give you.',
    show: 'An early estimate marked as thin, then the same figure firming up.',
    source: 'src/lib/scoring/index-engine.ts — sideEvidence',
    needsLiveApp: false,
  },
  {
    day: 8,
    hook: 'Day one of a hybrid block against day forty.',
    body: 'Same athlete, six weeks apart. Both went up. The interesting part is which one went up faster and what it cost.',
    show: 'Screen recording of the timeline across the block.',
    source: 'src/lib/scoring/timeline.ts',
    needsLiveApp: true,
  },
  {
    day: 9,
    hook: 'Readiness scores are usually a guess with a number on it.',
    body: 'This one comes from what you actually did. Your load, your rest days, and the sessions you have historically performed badly after.',
    show: 'The readiness figure next to the inputs behind it.',
    source: 'src/lib/scoring/readiness.ts',
    needsLiveApp: true,
  },
  {
    day: 10,
    hook: 'Injury flags that are more than "you did a lot".',
    body: 'Volume spikes are the easy signal and everyone uses them. The shape of the ramp is the harder one, and that is what this watches.',
    show: 'A ramp that passes on weekly volume and flags on shape.',
    source: 'src/lib/scoring/injury-risk.ts',
    needsLiveApp: true,
  },
  {
    day: 11,
    hook: 'Your swim, bike, run and lift do not belong on one scale.',
    body: 'So they are not on one. Each is measured against its own standards first, then combined. Flatten them too early and the number means nothing.',
    show: 'The per discipline breakdown behind a single index.',
    source: 'src/lib/scoring/cardio-benchmarks.ts',
    needsLiveApp: true,
  },
  {
    day: 12,
    hook: 'What a hybrid report card actually looks like.',
    body: 'Not forty widgets. One page. Where you are strong, what you are trading away, and what the next block should do about it.',
    show: 'The report card, scrolled through.',
    source: 'src/lib/scoring/hybrid-report.ts',
    needsLiveApp: true,
  },
  {
    day: 13,
    hook: 'Is this just Strava with extra steps?',
    body: 'Strava tells you what you did. Split Index tells you what it cost you and what it bought you. Different question, different app.',
    show: 'Talking head, then the interference view.',
    source: 'src/lib/scoring/interference.ts',
    needsLiveApp: true,
  },
  {
    day: 14,
    hook: 'It is live.',
    /*
     * The launch post carries more than the others on purpose. Most people
     * seeing it will not have seen days 1 to 13, so it has to say what the app
     * is before it asks for anything — and every feature named is taken from
     * FREE_TIER_FEATURES and PREMIUM_TIER_FEATURES verbatim, because a launch
     * post that oversells the tier is the one that gets refunded.
     */
    body:
      'Split Index measures what hybrid training is actually costing you. Log your lifts and your runs. ' +
      'It tells you where you are strong, where you are giving something up, and what your next block should do about it.\n\n' +
      'Logging is free. So is your current index and your last seven days.\n\n' +
      '£29.99 a year gets the rest. Injury risk before it becomes an injury. ' +
      'Race predictions built from your own pace curve instead of a generic formula. ' +
      'Eight week projections. The full strength index with DOTS and IPF GL.\n\n' +
      'Built for people doing both. Link in bio.',
    show:
      'Open on the App Store page. Cut to logging a lift, then a run, then the index moving. ' +
      'End on the report card so the last frame is the thing they are buying.',
    source: 'PRICING — src/lib/premium/features.ts',
    needsLiveApp: true,
  },
];

/**
 * Every post must cite a module, and that module must exist.
 *
 * The second half is what makes this more than a comment. A citation to a file
 * that was renamed or deleted is how a post ends up claiming a feature the app
 * no longer has, and nobody would notice from reading the post.
 */
export function ungrounded(posts = POSTS, root = ROOT) {
  const problems = [];
  for (const post of posts) {
    if (!post.source) {
      problems.push({ day: post.day, problem: 'no source cited' });
      continue;
    }
    const path = post.source.split(' —')[0].trim();
    if (!path.includes('/')) continue; // A prose citation like "PRICING".
    if (!existsSync(join(root, path))) {
      problems.push({ day: post.day, problem: `cites ${path}, which does not exist` });
    }
  }
  return problems;
}

function render(post) {
  return [
    `## Day ${post.day} — ${post.hook}`,
    '',
    post.needsLiveApp
      ? '> Needs the app live. Hold until approval.'
      : '> Can run during review — stands on the idea, not on a screen recording.',
    '',
    `**Caption**`,
    '',
    `${post.hook}`,
    '',
    post.body,
    '',
    `**On screen**  ${post.show}`,
    '',
    `**Backed by**  \`${post.source}\``,
    '',
  ].join('\n');
}

function main() {
  const problems = ungrounded();

  if (process.argv.includes('--check')) {
    if (problems.length === 0) {
      process.stdout.write(`all ${POSTS.length} posts cite a module that exists\n`);
      process.exit(0);
    }
    process.stderr.write(
      '\nThese posts are not grounded in anything:\n\n' +
        problems.map((p) => `  day ${p.day}: ${p.problem}\n`).join('') +
        '\nA post that cites nothing is a post inventing physiology. Fix the citation\n' +
        'or drop the post.\n\n',
    );
    process.exit(1);
  }

  if (problems.length > 0) {
    process.stderr.write('Refusing to stage: run --check.\n');
    process.exit(1);
  }

  mkdirSync(QUEUE, { recursive: true });

  const duringReview = POSTS.filter((p) => !p.needsLiveApp);
  const afterLaunch = POSTS.filter((p) => p.needsLiveApp);

  writeFileSync(
    join(QUEUE, 'README.md'),
    [
      '# Split Index — short-form posts, staged',
      '',
      `${POSTS.length} posts. **Nothing here has been posted.** These are written out for a person`,
      'to record and publish.',
      '',
      '## Why now, before approval',
      '',
      'The dashboard rates starting before approval as the largest single lever on this',
      `venture — £1,561 of base-case revenue inside the window, because an audience built`,
      'during review is an audience on launch day rather than a standing start.',
      '',
      `**${duringReview.length} of these need no live app** and can run during review. The`,
      `remaining ${afterLaunch.length} assume an approved build.`,
      '',
      'The ReelFarm subscription was recorded as the blocker. It is a blocker on volume,',
      'not on starting: fourteen posts can be recorded and posted by hand for nothing.',
      '',
      '## The rule these follow',
      '',
      'Every post cites the module that backs its claim, and `--check` fails if a cited',
      'file does not exist. This app is a measurement tool; the one thing it cannot',
      'afford is to claim something on TikTok that its own engine does not do.',
      '',
      '---',
      '',
      '# Can run during review',
      '',
      ...duringReview.map(render),
      '# Hold until the app is live',
      '',
      ...afterLaunch.map(render),
    ].join('\n'),
    'utf8',
  );

  writeFileSync(join(QUEUE, 'posts.json'), JSON.stringify(POSTS, null, 2) + '\n', 'utf8');

  process.stdout.write(
    `\n  ${POSTS.length} posts staged to ${QUEUE}\n` +
      `  ${duringReview.length} can run now, ${afterLaunch.length} need the app live\n` +
      `  posted: 0 — this writes files and nothing else\n\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
