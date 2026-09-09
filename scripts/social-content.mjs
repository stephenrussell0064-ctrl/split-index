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
 * on *volume*, not on starting: twenty posts written out in full can be
 * posted by hand during a review window at no cost. This generates those.
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
 * Twenty posts. Fourteen for a typical review window, then the calibration
 * series added 9 Sep 2026 — see the comment above day 15.
 *
 * Ordered so the first week can run without the app being live: each of those
 * stands on the idea rather than on a screen recording, because there is no
 * approved build to record. The second week assumes there is.
 */
export const POSTS = [
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
  /*
   * Days 15 to 20 — the calibration series.
   *
   * Added 9 Sep 2026 after two days spent measuring the female-male
   * performance gap across six sports. Every one of these is a finding from
   * `docs/pre-launch/calibration-data.md` and the audit that followed it, and
   * three of them are admissions. That is deliberate: the app's whole claim is
   * that its numbers are measured rather than assumed, and the only way to make
   * that credible is to show the working including the parts where the working
   * was wrong.
   *
   * None needs a live app. They run during review, or after it.
   */
  {
    day: 15,
    hook: 'Our app assumed women row 20% slower than men. The logbook says 14%. We had never checked.',
    body:
      'The 2025 Concept2 2k logbook — 9,561 men, 2,545 women — puts the median gap at 14%, and 18% at the slow end. ' +
      'Our table said 20% and 26%. It had never been measured; it came from a brief. Corrected, the women\u2019s table ' +
      'sits up to 107 points closer to the men\u2019s, which is a real cost to a real user\u2019s score. ' +
      'We would rather be right than flattering.',
    show: 'Old ratio and logbook ratio at each percentile, sample size under each.',
    source: 'scripts/check-row-sex-table-sourced.mjs',
    needsLiveApp: false,
  },
  {
    day: 16,
    hook: 'The male-female running gap does not widen as people get slower. It narrows.',
    body:
      '35 million race results. The gap sits flat at about 19% from the 30th percentile to the 80th, then narrows to ' +
      '14.6% in the slowest tenth. Why? The back of a mass 5k is walkers of both sexes, and walking speed differs ' +
      'between the sexes far less than running speed does. Most scoring assumes the gap keeps widening. ' +
      'The largest dataset available says it does not.',
    show: 'The percentile curve: flat through the middle, turning down at the left end.',
    source: 'docs/pre-launch/calibration-data.md',
    needsLiveApp: false,
  },
  {
    day: 17,
    hook: 'On a SkiErg the gap widens all the way down. On a road race it does not. Same people.',
    body:
      'Concept2 logbook 2025, SkiErg 1000 m: the female-male gap runs 1.216 at the 80th percentile to 1.322 at the 5th. ' +
      'It widens the whole way down. Running reverses at the bottom. The difference is that the slow tail of a road race ' +
      'is full of walkers and an erg piece has no walking equivalent — you cannot stroll a 1k. ' +
      'If an app uses one sex factor for every sport, it is wrong in at least one of them.',
    show: 'Two curves on one axis: SkiErg widening, running turning back.',
    source: 'src/lib/scoring/cardio-benchmarks.ts',
    needsLiveApp: false,
  },
  {
    day: 18,
    hook: 'Median watts per kilo is identical between men and women. Cycling speed is not.',
    body:
      'Cycling Analytics: 3.80 W/kg at twenty minutes for both sexes at the median. Identical. And yet women are ' +
      'meaningfully slower over a flat 20k. Both are true, because flat time-trial speed is set by absolute power ' +
      'against aerodynamic drag, not by power per kilo. The clearest example we found of a statistic that is correct ' +
      'and answers a different question than the one being asked.',
    show: 'Two riders, same W/kg, different finishing times, drag equation between them.',
    source: 'docs/pre-launch/calibration-data.md',
    needsLiveApp: false,
  },
  {
    day: 19,
    hook: 'We nearly shipped a number that was right about the wrong distance.',
    body:
      'Our SkiErg sex factor was wrong, so we replaced it with the best-sourced figure in our research: 1.246, ' +
      'measured at every percentile. Then we noticed the app benchmarks the SkiErg at 2000 m and that figure was ' +
      'measured at 1000 m. At 2000 m the logbook says 1.164. Using the 1000 m one sets a median woman\u2019s benchmark ' +
      'at 10:16 when the median woman actually skis 9:36 — forty seconds of free credit, handed to her for being ' +
      'exactly average, by a number that looked better sourced than the one it replaced.',
    show: '1.246 and 1.164 with their distances stamped under them, and 10:16 against 9:36.',
    source: 'scripts/check-cardio-calibration-sourced.mjs',
    needsLiveApp: false,
  },
  {
    day: 20,
    hook: 'Cycling is the one sport where the elite gap is bigger than the recreational gap. Nobody knows why.',
    body:
      'Running, swimming, rowing and skiing all show the same shape: the sex gap is narrowest among elites and wider ' +
      'among recreational athletes — running goes 12% at the top to 19% in the middle of the field. Cycling runs the ' +
      'other way: 12.6% at the UCI hour record, 9.8% across 823,459 IRONMAN 70.3 bike splits. ' +
      'We have no explanation, only two large well-measured numbers that disagree with every other sport. So our ' +
      'cycling factor is the least certain thing in the app, and we say so in the code rather than in a footnote.',
    show: 'Four sports pointing one way, cycling pointing the other.',
    source: 'docs/pre-launch/calibration-data.md',
    needsLiveApp: false,
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
      'not on starting: these posts can be recorded and posted by hand for nothing.',
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
