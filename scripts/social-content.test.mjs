#!/usr/bin/env node
/**
 * Tests for the social-content grounding rule.
 *
 * The rule is that every post cites a module that exists. The test that matters
 * is that a citation to a *renamed or deleted* file is caught — that is how a
 * post ends up claiming a feature the app no longer has, and it is invisible
 * from reading the post.
 */

import { ungrounded } from './social-content.mjs';

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'ok  ' : 'FAIL'} ${description}\n` +
      (ok ? '' : `       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`),
  );
}

const root = new URL('..', import.meta.url).pathname;

check(
  'a post citing a real module is grounded',
  ungrounded([{ day: 1, source: 'src/lib/scoring/interference.ts' }], root),
  [],
);

check(
  'a post citing a file that does not exist is caught',
  ungrounded([{ day: 2, source: 'src/lib/scoring/does-not-exist.ts' }], root).map((p) => p.day),
  [2],
);

check(
  'a post citing nothing is caught',
  ungrounded([{ day: 3 }], root).map((p) => p.problem),
  ['no source cited'],
);

check(
  'the trailing note after an em dash is not treated as part of the path',
  ungrounded([{ day: 4, source: 'src/lib/scoring/interference.ts — MIN_PAIRED_SESSIONS = 3' }], root),
  [],
);

check(
  'a prose citation with no path is allowed through',
  // "PRICING" is a claim about the product, not about a module, and demanding
  // a file for it would push someone to invent one.
  ungrounded([{ day: 5, source: 'PRICING' }], root),
  [],
);

process.stdout.write(`\n  ${failures ? `${failures} failed` : 'all passed'}\n\n`);
process.exit(failures ? 1 : 0);
