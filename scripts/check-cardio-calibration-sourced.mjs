#!/usr/bin/env node
/**
 * Are the cardio sex factors and the ski conversion the numbers the research
 * actually supports?
 *
 * ## Why this exists
 *
 * The registry milestone "Swimming, cycling, SkiErg and female-athlete scoring
 * calibrated" was checked by testing that
 * `docs/pre-launch/calibration-data.md` exists on disk.
 *
 * That document's own second line is:
 *
 *     **Status:** raw sourced research. No scoring decisions made here.
 *
 * It is the INPUT to the calibration. It would sit there unchanged if every
 * anchor table in the app were deleted, and the milestone would still have
 * read green. It also, in several places, says the opposite of what the
 * milestone claims — §3d says the app's ski constant "looks too low", §5 gives
 * SkiErg F:M ratios the app does not use, and §5 puts cycling's only two
 * sourced ratios nowhere near the app's.
 *
 * So this compares the constants the app actually scores with against the
 * bands the research concluded, and names the section each band comes from.
 *
 * ## What a failure means
 *
 * Not "the app is broken" — every athlete still gets a score. It means a
 * number is being presented as calibrated that the project's own research
 * says is not, and the fix is either to move the constant or to write down
 * why the research is being overridden. Both are cheap. Leaving it green was
 * the expensive option.
 *
 *   node scripts/check-cardio-calibration-sourced.mjs
 *
 * ## Why this is a script and not a vitest file
 *
 * It fails today, on purpose. Put in the suite it would red-line the separate
 * `tests-green` milestone and CI with it, which would say "the code is broken"
 * about something that is a calibration decision nobody has taken yet. One
 * milestone should go red here, and it is this one.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SOURCE = join(ROOT, 'src/lib/scoring/cardio-benchmarks.ts');
const RESEARCH = join(ROOT, 'docs/pre-launch/calibration-data.md');

/**
 * Each band is read off `calibration-data.md` §5 (and §3d for the ski pace
 * conversion), which is the only sourced sex-ratio research this project has.
 *
 * The bands are deliberately generous — the width of the sourced percentile
 * range, not a point estimate — because the app applies ONE flat scalar across
 * a whole population and no single number can be right at every percentile.
 * A constant outside its band is not a rounding disagreement; it is calibrated
 * against a different population from the one the anchor table now uses.
 *
 * `quote` is a string that must still appear in the research document. Without
 * it these bands would be a second, unsourced set of magic numbers, drifting
 * away from the document they claim to come from.
 */
const BANDS = [
  {
    what: 'FEMALE_CARDIO_FACTORS.run',
    read: (src) => number(src, /FEMALE_CARDIO_FACTORS[\s\S]*?\brun:\s*([\d.]+)/),
    min: 1.12,
    max: 1.2,
    where: '§5 cross-sport reference — running 1.121 elite to 1.191 recreational median',
    quote: '| Running 5 km | 1.121 (WR/top-20) | 1.191 (RunRepeat 50th) | 1.6× |',
  },
  {
    what: 'FEMALE_CARDIO_FACTORS.swim',
    read: (src) => number(src, /FEMALE_CARDIO_FACTORS[\s\S]*?\bswim:\s*([\d.]+)/),
    // The swim anchor table was rebased from club swimmers to the general
    // population; the factor was not moved with it. 1.065 is the ratio between
    // two world records. The population this table now scores sits at ~1.09
    // (95th) to ~1.14 (50th).
    min: 1.09,
    max: 1.15,
    where: '§5 swimming — 1.09 at the 95th (USMS Top 2%), ~1.14 at the 50th',
    quote: 'SOURCED — USMS 500 free SCY "Top 2%" tier (1.092)',
  },
  {
    what: 'FEMALE_CARDIO_FACTORS.cycle',
    read: (src) => number(src, /FEMALE_CARDIO_FACTORS[\s\S]*?\bcycle:\s*([\d.]+)/),
    min: 1.09,
    max: 1.13,
    where: '§5 cycling — the only two sourced numbers are 1.126 (UCI Hour Record) and 1.098 (IM 70.3 bike mean)',
    quote: 'SOURCED — UCI Hour Record, both sexes (§2a)',
  },
  {
    what: 'FEMALE_CARDIO_FACTORS.ski',
    read: (src) => number(src, /FEMALE_CARDIO_FACTORS[\s\S]*?\bski:\s*([\d.]+)/),
    /*
     * The band that was nearly wrong, and would have been a worse error than
     * the one it was written to catch.
     *
     * This first read 1.21-1.28, from §5's SkiErg table — the only fully
     * sourced sport in that section, 1.246 at the median. But §5's SkiErg
     * table is measured at 1000 m, and this app benchmarks SkiErg at 2000 m
     * (BENCHMARK_DISTANCES.ski). The 2000 m ratio is in §3b and it is 1.164.
     *
     * Scoring a 2000 m effort with a 1000 m sex ratio puts a median female
     * skier about 30 seconds fast on her row-equivalent — further from the
     * truth than the inherited rowing factor of 1.187 it was meant to replace.
     * The band has to come from the distance the anchor table actually scores.
     */
    min: 1.15,
    max: 1.19,
    where: '§3b SkiErg 2000 m, C2 logbook 2025 — 1.164 at the median, 1.171 at the 75th, 1.188 at the 90th; the app benchmarks ski at 2000 m, so §5 (1000 m) is the wrong table',
    quote: '| 50th | 8:14.5 | 9:35.8 | 1.164 |',
  },
  {
    what: 'SKI_FROM_ROW_PACE',
    read: (src) => number(src, /SKI_FROM_ROW_PACE\s*=\s*([\d.]+)/),
    // §3d, men's column, across the percentiles this app actually scores
    // (75th and below). The 90th's 1.028 is excluded: the app is calibrated to
    // the general population, not to the top decile.
    min: 1.045,
    max: 1.06,
    where: "§3d — the C2 logbook gives 1.045-1.059 for men across the 75th-25th, and says the app's assumption \"looks too low\"",
    quote: 'The 1.0357 assumption looks too low',
  },
];

function number(src, pattern) {
  const m = src.match(pattern);
  return m ? Number(m[1]) : null;
}

function main() {
  const src = readFileSync(SOURCE, 'utf8');
  const research = readFileSync(RESEARCH, 'utf8');
  const failures = [];

  for (const band of BANDS) {
    if (!research.includes(band.quote)) {
      // The band is only as good as the row it was read from. If the document
      // has moved on, the band is stale and must not be trusted either way.
      failures.push(
        `${band.what}: the research row this band came from is no longer in calibration-data.md\n` +
          `      looked for: ${band.quote}\n` +
          `      re-read ${band.where} and update the band, or the check is asserting a number nobody sourced`,
      );
      continue;
    }

    const value = band.read(src);
    if (value === null) {
      failures.push(
        `${band.what}: not found in cardio-benchmarks.ts — renamed or removed, and this check cannot see it any more`,
      );
      continue;
    }

    if (value < band.min || value > band.max) {
      failures.push(
        `${band.what} = ${value}, outside the sourced ${band.min}-${band.max}\n` +
          `      ${band.where}`,
      );
    }
  }

  if (failures.length === 0) {
    process.stdout.write(
      `every cardio sex factor and the ski pace conversion sit inside the band ` +
        `docs/pre-launch/calibration-data.md sources for them\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nThese constants are not what the project's own research says they should be:\n\n` +
      failures.map((f) => `  - ${f}`).join('\n\n') +
      `\n\nThe milestone says swimming, cycling, SkiErg and female-athlete scoring are\n` +
      `calibrated. docs/pre-launch/calibration-data.md is the research for that work and\n` +
      `says of itself: "raw sourced research. No scoring decisions made here." The\n` +
      `decisions were never made. Either move the constants onto the sourced values, or\n` +
      `write down in the source why the research is being overridden — the second is a\n` +
      `real answer, silence is not.\n\n`,
  );
  process.exit(1);
}

main();
