#!/usr/bin/env node
/**
 * Do the numbers in the social posts still follow from the numbers in the app?
 *
 * ## Why this exists, and what `--check` was not doing
 *
 * `social-content.mjs --check` verifies that every post cites a module which
 * exists on disk. That catches a renamed file. It does not read the post.
 *
 * Six calibration posts were drafted on 9 Sep 2026 and four of them stated
 * something the research does not say — a gap attributed to the wrong distance,
 * an error quoted in the wrong direction, and one claim ("women now score
 * lower") that was the opposite of what shipping the change actually did.
 * Every one of those posts passed `--check`, because every one of them cited a
 * real file. A citation is not a fact.
 *
 * So this recomputes the derived figures in those posts from the constants the
 * app scores with and the tables the research recorded, and fails if a post no
 * longer follows from them. The posts are marketing for a measurement tool:
 * the specific way this venture loses is by saying a number in public that its
 * own engine contradicts.
 *
 * ## What it cannot do, stated plainly
 *
 * It checks arithmetic, not meaning. A post that quotes a real ratio and
 * attributes it to the wrong sport or distance passes here — that was one of
 * the four errors, and it was caught by a person reading the tables, not by
 * this. Nothing in this file should be read as "the posts are true".
 *
 *   node scripts/check-post-claims.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { POSTS } from './social-content.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const RESEARCH = readFileSync(join(ROOT, 'docs/pre-launch/calibration-data.md'), 'utf8');
const BENCHMARKS = readFileSync(join(ROOT, 'src/lib/scoring/cardio-benchmarks.ts'), 'utf8');

const failures = [];
const fail = (what, detail) => failures.push({ what, detail });
const post = (day) => POSTS.find((p) => p.day === day);

/** `9:35.8` -> 575.8. The research writes every time this way. */
function seconds(clock) {
  const [m, s] = clock.split(':');
  return Number(m) * 60 + Number(s);
}

/** 616.1 -> "10:16". Posts quote whole seconds; scoring is not to a tenth. */
function clock(total) {
  const whole = Math.round(total);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * Pull one row out of one numbered section's table.
 *
 * The section is part of the address, not decoration. `| 50th |` starts five
 * different rows in that document and `1.164` appears against more than one
 * distance; a pattern that takes whichever it finds first is exactly how a post
 * ends up quoting a real figure about the wrong thing, which is the error this
 * file was written after making.
 */
function row(section, label, cells) {
  const start = RESEARCH.indexOf(`### ${section}`);
  if (start === -1) return null;
  const next = RESEARCH.indexOf('\n### ', start + 1);
  const within = RESEARCH.slice(start, next === -1 ? undefined : next);

  const pattern = new RegExp(`^\\|\\s*${label}\\s*\\|${'\\s*([^|]+?)\\s*\\|'.repeat(cells)}`, 'm');
  const match = within.match(pattern);
  return match ? match.slice(1).map((c) => c.trim()) : null;
}

/*
 * ---------------------------------------------------------------------------
 * Claim 1 — day 19, the SkiErg distance mix-up.
 *
 * The post says using the 1000 m sex factor at 2000 m sets a median woman's
 * benchmark at 10:16 when the median woman actually skis 9:36. Both figures are
 * derived, so both rot silently if either table is re-read.
 * ---------------------------------------------------------------------------
 */
{
  const ski2k = row('3b.', '50th', 3); // | 50th | 8:14.5 | 9:35.8 | 1.164 |
  const wrong = RESEARCH.match(/\|\s*C2 logbook 2025, 50th\s*\|\s*[\d.]+\s*\|\s*([\d.]+)\s*\|/);

  if (!ski2k || !/^\d+:\d/.test(ski2k[0]) || !wrong) {
    fail('day 19', 'the §3b 2000 m row or the §5 1000 m ratio is no longer readable in the research');
  } else {
    const men = seconds(ski2k[0]);
    const womenMeasured = seconds(ski2k[1]);
    const womenIfWrongFactor = men * Number(wrong[1]);
    const body = post(19).body;

    for (const [figure, why] of [
      [clock(womenIfWrongFactor), `the 1000 m factor ${wrong[1]} applied to the men's 2000 m median ${ski2k[0]}`],
      [clock(womenMeasured), `the measured women's 2000 m median ${ski2k[1]}`],
      [wrong[1], 'the 1000 m factor itself'],
      [ski2k[2], 'the 2000 m factor itself'],
    ]) {
      if (!body.includes(figure)) fail('day 19', `does not say ${figure} — ${why}`);
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * Claim 2 — day 15, what correcting the rowing ratios cost.
 *
 * "the women's table sits up to 106 points closer to the men's."
 *
 * That number is the largest score difference between the shipped women's
 * anchors and a hypothetical table built from the men's anchors and the OLD
 * ratios. It is a statement about the table, so it is computed the way the
 * table is read: linear interpolation between anchors. It is deliberately NOT
 * the change a user saw in their score — the men's anchors were rebased in the
 * same week, and the net effect on a woman's score was upward. The first draft
 * of this post claimed the opposite and it would have been a lie in public.
 * ---------------------------------------------------------------------------
 */
{
  /*
   * Each anchor carries the percentile it was read at in its own trailing
   * comment, and that label is how the rows are addressed below. Counting
   * positions instead would silently point at a different percentile the moment
   * a row is added — the first draft of this check did exactly that, and
   * reported the 80th percentile's ratio as the median's.
   */
  const anchors = (name) => {
    const block = BENCHMARKS.match(new RegExp(`${name}: Anchor\\[\\] = \\[([\\s\\S]*?)\\];`));
    if (!block) return null;
    const rows = [...block[1].matchAll(/\[\s*([\d.]+)\s*,\s*(\d+)\s*\][^\n]*?—\s*(\d+)(?:st|nd|rd|th)\b/g)];
    return rows.map((m) => [Number(m[1]), Number(m[2]), Number(m[3])]);
  };
  const male = anchors('ROW_2K_ANCHORS_MALE');
  const female = anchors('ROW_2K_ANCHORS_FEMALE');
  // The final `\d+\.\d+` rather than `[\d.]+` is load-bearing: the list ends a
  // sentence, and a looser class swallows the full stop into `1.261.`, which
  // Number() turns into NaN. NaN then compares false against everything and the
  // whole comparison below silently stops testing anything.
  const stated = RESEARCH.match(/ratios of\s+((?:[\d.]+\s*\/\s*)+\d+\.\d+)/);

  if (!male || !female || !stated) {
    fail('day 15', 'the rowing anchor tables or the research note recording the old ratios cannot be read');
  } else {
    const oldRatios = stated[1].split('/').map((n) => Number(n.trim()));

    if (male.length !== female.length || male.length !== oldRatios.length) {
      fail('day 15', `the two anchor tables and the ${oldRatios.length} recorded old ratios no longer line up`);
    } else if (![...male.flat(), ...female.flat(), ...oldRatios].every(Number.isFinite)) {
      fail('day 15', 'a parsed anchor or ratio is not a number — the comparison below would compare nothing');
    } else {
      const interpolate = (table, s) => {
        if (s <= table[0][0]) return table[0][1];
        if (s >= table[table.length - 1][0]) return table[table.length - 1][1];
        const i = table.findIndex(([t], k) => k < table.length - 1 && s >= t && s <= table[k + 1][0]);
        const [a, aScore] = table[i];
        const [b, bScore] = table[i + 1];
        return aScore + ((bScore - aScore) * (s - a)) / (b - a);
      };

      const wouldHaveBeen = male.map(([s, score], i) => [s * oldRatios[i], score]);

      /*
       * Evaluated at the knots, not by sampling the range.
       *
       * Both tables are piecewise linear, so their difference is too, and the
       * largest value of a piecewise-linear function is always at one of its
       * corners. Sampling would give the same answer here only by luck — a
       * 0.5-second step missed it by 0.13 and rounded the post's headline
       * figure down by a point.
       */
      const knots = [...wouldHaveBeen, ...female]
        .map(([s]) => s)
        .filter((s) => s >= female[0][0] && s <= female[female.length - 1][0]);
      const widest = Math.max(...knots.map((s) => interpolate(wouldHaveBeen, s) - interpolate(female, s)));

      const points = Math.round(widest);
      const body = post(15).body;
      if (!body.includes(`${points} points`)) {
        fail('day 15', `says something other than "${points} points", which is what the two tables now differ by`);
      }

      // The gap percentages the post quotes, at the median and at the slow end,
      // located by the percentile each anchor is labelled with.
      const median = male.findIndex(([, , percentile]) => percentile === 50);
      const slowest = male.findIndex(([, , percentile]) => percentile === 5);
      if (median === -1 || slowest === -1) {
        fail('day 15', 'the rowing anchors no longer record which percentile each row was read at');
      }
      const pct = (r) => `${Math.round((r - 1) * 100)}%`;
      const measured = female.map(([s], i) => s / male[i][0]);
      for (const [figure, why] of median === -1 || slowest === -1 ? [] : [
        [pct(oldRatios[median]), 'the old ratio at the median'],
        [pct(measured[median]), 'the measured ratio at the median'],
        [pct(oldRatios[slowest]), 'the old ratio at the slow end'],
        [pct(measured[slowest]), 'the measured ratio at the slow end'],
      ]) {
        if (!body.includes(figure)) fail('day 15', `does not say ${figure} — ${why}`);
      }
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * Claim 3 — every ratio quoted anywhere is a ratio the research recorded.
 *
 * Weaker than the two above and worth having anyway: a three-decimal number in
 * a post is always a sex ratio lifted from a table, and the cheap failure is
 * one that was rounded, mistyped, or invented on the way into a sentence.
 * ---------------------------------------------------------------------------
 */
for (const p of POSTS) {
  for (const ratio of new Set(p.body.match(/\b\d\.\d{3}\b/g) ?? [])) {
    if (!RESEARCH.includes(ratio)) {
      fail(`day ${p.day}`, `quotes the ratio ${ratio}, which appears nowhere in the research`);
    }
  }
}

if (failures.length === 0) {
  process.stdout.write(
    `\n  ${POSTS.length} posts: every derived figure still follows from the shipped constants\n` +
      '  (arithmetic only — this cannot tell whether a real number is attached to the right sport)\n\n',
  );
  process.exit(0);
}

process.stdout.write('\n  A post no longer follows from the app:\n\n');
for (const { what, detail } of failures) process.stdout.write(`  ${what}: ${detail}\n`);
process.stdout.write(
  '\n  Either the post is wrong, or a constant moved and the post was not revisited.\n' +
    '  Both are fixed by hand — this is a claim about the product, not a test fixture.\n\n',
);
process.exit(1);
