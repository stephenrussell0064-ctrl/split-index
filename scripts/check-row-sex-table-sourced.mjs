#!/usr/bin/env node
/**
 * Does the women's rowing anchor table agree with the only measured rowing
 * distribution?
 *
 * ## Why this is separate from check-cardio-calibration-sourced.mjs
 *
 * Every other sport is scored by a male curve plus one female scalar, so that
 * check compares five numbers against five bands. Rowing is the exception: it
 * has its own sex-specific anchor tables, so the "sex factor" is not a constant
 * anywhere — it is implied by the ratio between two tables, percentile by
 * percentile, and has to be recomputed to be seen at all.
 *
 * That is most of the reason this went unexamined. There was no number to
 * disagree with.
 *
 * ## What was wrong
 *
 * Each row of `ROW_2K_ANCHORS_FEMALE` was annotated "sourced sex ratio". §4b
 * of `docs/pre-launch/calibration-data.md` lists that same column as "Existing
 * app calibration — given in brief". It was an assumption wearing the word
 * sourced, which is the fault SKI_FROM_ROW_PACE had when it claimed to be
 * "Validated: 7:00 row ≈ 7:16 ski" against itself.
 *
 * §3c measured it: the 2025 Concept2 logbook at 2000 m, 9,561 men and 2,545
 * women — the best-sampled sex-split distribution in the document for any
 * sport. It is near flat, 1.127 to 1.152, about two points of widening across
 * its whole range. The app's tables imply 1.145 rising to 1.261.
 *
 * The table was rebased onto that data on 8 September 2026 and this now passes.
 *
 * ## What it judges, and what it will not
 *
 * Every anchor is compared at equal MALE TIME rather than at the same
 * percentile label. That is the point: the logbook population is
 * fitness-enthusiast and the app's is general, so a "50th percentile" means
 * different things in each, while a 7:46.8 row means the same thing in both.
 *
 * Four of the six anchors fall inside the measured range and are judged. The
 * range reaches the fast end only because of the world-record pair — until
 * that was added, the two quickest anchors were outside the data and went
 * unjudged, which is how the fast end of a table nobody could see went
 * unchecked.
 *
 * The 20th and 5th are slower than anything measured and are reported as
 * unjudged rather than assessed. §5 is explicit that extrapolating a sex
 * gradient past its data is unsupported — for swimming it notes two defensible
 * extrapolations that disagree by six points — so this asserts nothing there.
 * The source carries the extrapolation and says so on the line; a check that
 * pretended to verify it would be inventing authority.
 *
 * ## What a failure means
 *
 * Not that the app is broken. It means women's rowing is being scored against
 * a standard the project's own measurement does not support, and the fix is
 * either to rebase the table or to write down why the measurement is being
 * overridden. Both are real answers. The word "sourced" on an assumption was
 * not.
 *
 *   node scripts/check-row-sex-table-sourced.mjs
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = join(ROOT, 'src/lib/scoring/cardio-benchmarks.ts');
const RESEARCH = join(ROOT, 'docs/pre-launch/calibration-data.md');

/**
 * Measured F:M against male ability. Male seconds → ratio.
 *
 * §3c is the C2 logbook 2025 at 2000 m, 9,561 men and 2,545 women. The first
 * row is the world-record pair, which was already sitting in
 * WORLD_RECORD_SECONDS.row in the source and is what lets this judge the fast
 * anchors at all — without it the two quickest were outside the range and went
 * unjudged, which is how a table nobody could see got a fast end nobody
 * checked.
 */
const MEASURED = [
  { label: 'C2 2000 m world records', male: 333.4, ratio: 381.1 / 333.4 },
  { label: '§3c logbook 90th', male: 408.4, ratio: 1.131 },
  { label: '§3c logbook 75th', male: 433.6, ratio: 1.127 },
  { label: '§3c logbook 50th', male: 466.8, ratio: 1.137 },
  { label: '§3c logbook 25th', male: 511.1, ratio: 1.152 },
];

/**
 * How far the app may sit from the measured ratio.
 *
 * The two populations genuinely differ — the logbook is fitness-enthusiast,
 * this table is general — and §4 establishes the sex gap moves with ability,
 * so some divergence is expected and this is not asking for a match. Three
 * points is roughly one and a half times the total widening the logbook shows
 * across its entire range, which is as much slack as the data can justify.
 */
const TOLERANCE = 0.03;

/** A row of one of the anchor tables. */
function anchors(src, name) {
  const block = new RegExp(`const ${name}: Anchor\\[\\] = \\[([\\s\\S]*?)\\];`).exec(src);
  if (!block) return null;
  return [...block[1].matchAll(/\[\s*([\d.]+),\s*(\d+)\s*\]/g)].map((m) => ({
    seconds: Number(m[1]),
    score: Number(m[2]),
  }));
}

/** The logbook ratio at a given male time, interpolated within its range. */
export function logbookRatioAt(maleSeconds) {
  const sorted = [...MEASURED].sort((a, b) => a.male - b.male);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (maleSeconds < first.male || maleSeconds > last.male) return null; // outside the data
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (maleSeconds >= a.male && maleSeconds <= b.male) {
      const t = (maleSeconds - a.male) / (b.male - a.male);
      return a.ratio + (b.ratio - a.ratio) * t;
    }
  }
  return last.ratio;
}

export function compare(male, female) {
  return male.map((m, i) => {
    const f = female[i];
    const implied = f.seconds / m.seconds;
    const measured = logbookRatioAt(m.seconds);
    return {
      score: m.score,
      maleSeconds: m.seconds,
      implied,
      measured,
      // Tails are outside the logbook and deliberately not judged.
      judged: measured !== null,
      off: measured === null ? null : implied - measured,
    };
  });
}

const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

function main() {
  const src = readFileSync(SOURCE, 'utf8');
  const research = readFileSync(RESEARCH, 'utf8');

  // The band is only worth asserting while the research still says it.
  const QUOTE = '| 50th | 7:46.8 | 8:50.7 | 1.137 |';
  if (!research.includes(QUOTE)) {
    process.stderr.write(
      `The §3c row this check is built on is no longer in calibration-data.md:\n  ${QUOTE}\n\n` +
        `Re-read §3c and update MEASURED here, or this is asserting numbers nobody sourced.\n\n`,
    );
    process.exit(2);
  }

  const male = anchors(src, 'ROW_2K_ANCHORS_MALE');
  const female = anchors(src, 'ROW_2K_ANCHORS_FEMALE');
  if (!male || !female || male.length !== female.length) {
    process.stderr.write('Could not read both rowing anchor tables from cardio-benchmarks.ts.\n');
    process.exit(2);
  }

  const rows = compare(male, female);
  const judged = rows.filter((r) => r.judged);
  const failures = judged.filter((r) => Math.abs(r.off) > TOLERANCE);

  if (failures.length === 0) {
    process.stdout.write(
      `the women's rowing table matches the C2 logbook within ${TOLERANCE} ` +
        `across the ${judged.length} anchors the logbook covers\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nThe women's rowing anchors do not agree with the only measured rowing distribution.\n\n` +
      `§3c is the 2025 Concept2 logbook at 2000 m: 9,561 men, 2,545 women. Its F:M\n` +
      `ratio is near flat, 1.127 to 1.152. These anchors imply a much steeper one.\n\n`,
  );
  for (const r of failures) {
    process.stderr.write(
      `  at a male anchor of ${mmss(r.maleSeconds)} (score ${r.score})\n` +
        `    this table implies  ${r.implied.toFixed(3)}\n` +
        `    the logbook measures ${r.measured.toFixed(3)}\n` +
        `    women's anchor is ${((r.implied - r.measured) * r.maleSeconds).toFixed(1)}s more generous\n`,
    );
  }
  process.stderr.write(
    `\n${rows.length - judged.length} anchors sit outside the logbook's range and are not judged —\n` +
      `extrapolating a sex gradient past its data is what §5 calls unsupported.\n\n` +
      `§4b lists the app's ratios as "given in brief", not measured. Either rebase the\n` +
      `table onto §3c, or write down in the source why the logbook is being overridden.\n` +
      `The second is a real answer; the word "sourced" on an assumption was not.\n\n`,
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
