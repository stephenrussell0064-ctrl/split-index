#!/usr/bin/env node
/**
 * Which of these modules can a real person actually reach?
 *
 * ## Why this exists
 *
 * Ported from `checkedtutors/scripts/audit-reachability.mjs`, written there on
 * 12 Sep after the commission was found being computed in two places — one
 * floored under a paragraph explaining why, one rounded, and the rounded one
 * was what a tutor saw. The diagnosis written first was "the fix landed in code
 * nothing calls". That was wrong, and this audit is what proved it wrong.
 *
 * The question it answers is the one the codebase could not: **is the tested
 * path the one that runs?** A module can be correct, covered, mutation-verified
 * and unreachable, and every instrument in the repository will call it healthy.
 *
 * ## What reachable means here
 *
 * Next.js App Router. The entry points are every file under `src/app` — pages,
 * layouts, route handlers, and server actions, each of which is its own entry
 * point — plus `src/proxy.ts`, which Next runs on every matched request.
 *
 * `scripts/` is handled separately rather than mixed in. A build-time gate is
 * not user-reachable and should not be counted as if it were, but a module that
 * only a gate uses is a different thing from a module nothing uses at all, and
 * collapsing the two would hide both.
 *
 * Unreachable is not the same as wrong. A module built ahead of its caller is
 * unreachable and fine. What this gives is the list, so each line is a decision
 * somebody made rather than a fact nobody checked.
 *
 * ## Deliberately an audit, not a check
 *
 * It reads imports with a regex, so a dynamic `import(path)` assembled from a
 * variable is invisible and its target would be reported as unreachable. A gate
 * that fails a correct build is a gate the repository learns to ignore — the
 * same reasoning that keeps `audit-unrendered-state.mjs` an audit in the
 * control project.
 *
 *   node scripts/audit-reachability.mjs
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'src');
const SCRIPTS = join(ROOT, 'scripts');

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs', '.js', '.jsx'];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (EXTENSIONS.some((e) => entry.name.endsWith(e))) out.push(full);
  }
  return out;
}

/** A test file is not an entry point, and being imported by one proves nothing. */
const isTest = (file) => /\.(test|spec)\.[a-z]+$/.test(file);

/**
 * A module that declares itself runnable, e.g.
 *
 *     // Run with: npx tsx src/lib/scoring/sanity-check.ts
 *
 * The first run of this audit reported nine of these as "reached by nothing at
 * all". They are the scoring sanity checks, each a CLI with its own invocation
 * written at the top of it, and each genuinely an entry point — nothing imports
 * them because they are the thing you run.
 *
 * Reporting them would have been the same mistake this audit exists to catch,
 * in the other direction: a list that is mostly wrong is a list nobody reads,
 * and the nine would have buried whatever else is in it.
 *
 * The test is deliberately that the file names ITSELF. A header mentioning some
 * other path is documentation, not an entry point.
 */
function declaresItselfRunnable(file, source) {
  const path = relative(ROOT, file);
  return source.includes(path) && /\b(npx tsx|tsx|node)\s+\S*/.test(source);
}

export function resolveImport(fromFile, spec) {
  let base;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec);
  else return null;

  // Only extensions this audit reasons about. A bare `import "./globals.css"`
  // resolves to a real file and is not a module whose reachability means
  // anything — counting it made the checkedtutors version's totals disagree
  // with the list printed underneath them.
  for (const candidate of [
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => join(base, 'index' + e)),
    base,
  ]) {
    if (!EXTENSIONS.some((e) => candidate.endsWith(e))) continue;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

export function importsIn(source) {
  const specs = [];
  const patterns = [
    /\bimport\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bexport\s[^'"]*?from\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) specs.push(m[1]);
  return specs;
}

/** Everything reachable from these roots, following imports transitively. */
export function closureFrom(roots) {
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    reached.add(file);
    let source;
    try {
      source = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const spec of importsIn(source)) {
      const target = resolveImport(file, spec);
      if (target && !reached.has(target)) queue.push(target);
    }
  }
  return reached;
}

function main() {
  const all = walk(SRC).filter((f) => !isTest(f));

  const selfRunnable = all.filter((f) => {
    try {
      return declaresItselfRunnable(f, readFileSync(f, 'utf8'));
    } catch {
      return false;
    }
  });

  const appEntries = all.filter(
    (f) => f.startsWith(join(SRC, 'app')) || f === join(SRC, 'proxy.ts'),
  );
  const scriptEntries = walk(SCRIPTS).filter((f) => !isTest(f));

  const fromApp = closureFrom(appEntries);
  const fromScripts = closureFrom(scriptEntries);

  const fromSelfRunnable = closureFrom(selfRunnable);

  const unreachable = all.filter((f) => !fromApp.has(f)).sort();
  const onlyScripts = unreachable.filter((f) => fromScripts.has(f) && !fromSelfRunnable.has(f));
  const onlyCli = unreachable.filter((f) => fromSelfRunnable.has(f));
  const nothing = unreachable.filter((f) => !fromScripts.has(f) && !fromSelfRunnable.has(f));
  const rel = (f) => relative(ROOT, f);

  const hasTests = (file) =>
    EXTENSIONS.flatMap((e) => [
      file.replace(/\.[a-z]+$/, `.test${e}`),
      file.replace(/\.[a-z]+$/, `.spec${e}`),
    ]).some((t) => existsSync(t));

  process.stdout.write(
    `\n  ${all.length - unreachable.length} of ${all.length} modules under src/ are reachable ` +
      `from the app.\n  ${appEntries.length} entry points (src/app/** and src/proxy.ts).\n\n`,
  );

  if (onlyCli.length) {
    process.stdout.write(
      `  Hand-run CLIs, and what only they use (${onlyCli.length}) — each names its own\n` +
        `  invocation in its header, so nothing importing them is the point:\n\n`,
    );
    for (const f of onlyCli) process.stdout.write(`    ${rel(f)}\n`);
    process.stdout.write('\n');
  }

  if (onlyScripts.length) {
    process.stdout.write(
      `  Reached only by a build-time gate in scripts/ (${onlyScripts.length}) — ` +
        `not user-reachable,\n  which for a gate is correct:\n\n`,
    );
    for (const f of onlyScripts) process.stdout.write(`    ${rel(f)}\n`);
    process.stdout.write('\n');
  }

  if (nothing.length === 0) {
    process.stdout.write('  Nothing else is unreachable.\n\n');
    return;
  }

  process.stdout.write(`  Reached by nothing at all (${nothing.length}):\n\n`);
  for (const f of nothing) {
    // A tested module nobody can reach is the exact shape worth finding: the
    // tests pass, the audit trail reads well, and none of it runs.
    process.stdout.write(`    ${rel(f)}${hasTests(f) ? '   [has tests]' : ''}\n`);
  }
  process.stdout.write(
    `\n  Unreachable is not the same as wrong — a module built ahead of its caller is\n` +
      `  both. What matters is that each line here is a decision somebody made.\n\n` +
      `  Read it beside the reachable twin of anything surprising: a fix applied to an\n` +
      `  unreachable module is a fix that has never run.\n\n`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
