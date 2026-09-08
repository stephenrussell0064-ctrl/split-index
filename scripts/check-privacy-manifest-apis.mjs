#!/usr/bin/env node
/**
 * Does the privacy manifest declare the required-reason APIs the app uses?
 *
 * ## Why this is a check and not a comment
 *
 * The manifest already says this, and says it well:
 *
 *   "File-timestamp, disk-space and system-boot-time categories are
 *    deliberately absent: nothing in the app or the widgets calls those APIs.
 *    Verified by grep for creationDate / modificationDate / attributesOfItem
 *    across both targets."
 *
 * That was true when it was written. It is a one-time verification recorded in
 * prose, and the next Swift file, Capacitor plugin or widget that reads a file
 * timestamp will not update it. The failure is not subtle but it is late:
 * ITMS-91053 rejects the upload automatically, before a human sees the build,
 * and the message names a category rather than a line of code.
 *
 * Both directions matter, and the manifest's own first rule says why:
 * over-declaring is as wrong as under-declaring, because the manifest must
 * match the App Store Connect answers exactly. So this fails on a category
 * used but not declared, and on one declared but unused.
 *
 *   node scripts/check-privacy-manifest-apis.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IOS = join(ROOT, 'ios', 'App');
const MANIFEST = join(IOS, 'App', 'PrivacyInfo.xcprivacy');

/**
 * Apple's five required-reason categories, and the symbols that trigger them.
 *
 * Deliberately narrow. A category declared without cause is a rejection in its
 * own right, so a pattern that fires on the word "date" would do real harm —
 * it would push somebody to declare a category they do not need, which is the
 * failure this is trying to prevent from the other side.
 */
const CATEGORIES = [
  {
    name: 'NSPrivacyAccessedAPICategoryFileTimestamp',
    patterns: [/\bcreationDate\b/, /\bmodificationDate\b/, /\battributesOfItem\b/, /\bcontentModificationDateKey\b/, /\bcreationDateKey\b/, /\bNSURLContentModificationDateKey\b/],
  },
  {
    name: 'NSPrivacyAccessedAPICategorySystemBootTime',
    patterns: [/\bsystemUptime\b/, /\bmach_absolute_time\b/, /\bNSProcessInfo\.processInfo\.systemUptime\b/],
  },
  {
    name: 'NSPrivacyAccessedAPICategoryDiskSpace',
    patterns: [/\bvolumeAvailableCapacity\b/, /\bsystemFreeSize\b/, /\bsystemSize\b/, /\bvolumeTotalCapacity\b/],
  },
  {
    name: 'NSPrivacyAccessedAPICategoryActiveKeyboards',
    patterns: [/\bactiveInputModes\b/],
  },
  {
    name: 'NSPrivacyAccessedAPICategoryUserDefaults',
    patterns: [/\bUserDefaults\b/, /\bNSUserDefaults\b/],
  },
];

function swiftSources(dir, acc = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const entry of entries) {
    // Pods carry their own manifests; a dependency's API use is the
    // dependency's to declare, and reading them here would produce findings
    // nobody in this repo can act on.
    if (entry.name === 'Pods' || entry.name === 'build' || entry.name === 'DerivedData') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) swiftSources(full, acc);
    else if (/\.(swift|m|h)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

/** Strip comments, so a category discussed in prose is not read as a use. */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

export function manifestApiProblems(iosDir = IOS, manifestPath = MANIFEST) {
  const manifest = readFileSync(manifestPath, 'utf8');
  const declared = new Set(
    [...manifest.matchAll(/<string>(NSPrivacyAccessedAPICategory\w+)<\/string>/g)].map((m) => m[1]),
  );

  const used = new Map();
  for (const file of swiftSources(iosDir)) {
    const text = code(readFileSync(file, 'utf8'));
    for (const category of CATEGORIES) {
      if (category.patterns.some((p) => p.test(text)) && !used.has(category.name)) {
        used.set(category.name, relative(iosDir, file));
      }
    }
  }

  const problems = [];
  for (const [name, where] of used) {
    if (!declared.has(name)) {
      problems.push({
        kind: 'undeclared',
        category: name,
        detail: `used in ${where} and not declared — ITMS-91053 rejects the upload for this`,
      });
    }
  }
  for (const name of declared) {
    if (!used.has(name)) {
      problems.push({
        kind: 'unused',
        category: name,
        detail:
          'declared and not used anywhere in the app or widget sources. The manifest must match the App Store Connect answers exactly, so over-declaring is its own rejection',
      });
    }
  }

  return problems;
}

function main() {
  const problems = manifestApiProblems();

  if (problems.length === 0) {
    process.stdout.write(
      'the privacy manifest declares exactly the required-reason APIs the sources use\n',
    );
    process.exit(0);
  }

  process.stderr.write(
    '\nThe privacy manifest and the iOS sources disagree:\n\n' +
      problems.map((p) => `  ${p.category}\n    ${p.detail}\n`).join('\n') +
      '\nEdit ios/App/App/PrivacyInfo.xcprivacy. Both directions are rejections:\n' +
      'a category used but not declared, and one declared but not used.\n\n',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
