#!/usr/bin/env node
/**
 * Tests for the privacy-manifest API check.
 *
 * Both directions are rejections and both are tested. An undeclared category is
 * ITMS-91053, which bounces the upload automatically. An over-declared one is a
 * mismatch with the App Store Connect answers, which is its own rejection and
 * is the more tempting mistake — "declare it to be safe" is exactly the instinct
 * the manifest's own first rule warns against.
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { manifestApiProblems } from './check-privacy-manifest-apis.mjs';

const root = mkdtempSync(join(tmpdir(), 'manifest-'));
mkdirSync(join(root, 'App'), { recursive: true });

const manifestPath = join(root, 'App', 'PrivacyInfo.xcprivacy');

function manifest(...categories) {
  writeFileSync(
    manifestPath,
    `<plist><dict><key>NSPrivacyAccessedAPITypes</key><array>` +
      categories
        .map(
          (c) =>
            `<dict><key>NSPrivacyAccessedAPIType</key><string>${c}</string>` +
            `<key>NSPrivacyAccessedAPITypeReasons</key><array><string>CA92.1</string></array></dict>`,
        )
        .join('') +
      `</array></dict></plist>`,
    'utf8',
  );
}

function swift(name, contents) {
  writeFileSync(join(root, 'App', name), contents, 'utf8');
}

let failures = 0;
function check(description, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  process.stdout.write(
    `  ${ok ? 'ok  ' : 'FAIL'} ${description}\n` +
      (ok ? '' : `       expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`),
  );
}

const problems = () => manifestApiProblems(root, manifestPath).map((p) => `${p.kind}:${p.category}`).sort();

// The real shape: UserDefaults used and declared, nothing else either way.
manifest('NSPrivacyAccessedAPICategoryUserDefaults');
swift('Plugin.swift', 'let defaults = UserDefaults(suiteName: "group.co.uk.splitindex.app")');
check('a manifest matching the sources is clean', problems(), []);

/*
 * The ITMS-91053 case. A new plugin reads a file timestamp; nobody remembers
 * the manifest; the upload is rejected automatically before a human sees it.
 */
swift('NewPlugin.swift', 'let d = try FileManager.default.attributesOfItem(atPath: p)');
check(
  'a required-reason API used but not declared is caught',
  problems(),
  ['undeclared:NSPrivacyAccessedAPICategoryFileTimestamp'],
);
rmSync(join(root, 'App', 'NewPlugin.swift'));

/*
 * The other direction, and the more tempting mistake. "Declare it to be safe"
 * produces a manifest that does not match the App Store Connect answers, which
 * is a rejection of its own.
 */
manifest('NSPrivacyAccessedAPICategoryUserDefaults', 'NSPrivacyAccessedAPICategoryDiskSpace');
check(
  'a category declared but never used is caught',
  problems(),
  ['unused:NSPrivacyAccessedAPICategoryDiskSpace'],
);

// A category discussed in a comment is not a use. The real manifest reasons at
// length about the categories it deliberately omits, and the sources may too.
manifest('NSPrivacyAccessedAPICategoryUserDefaults');
swift(
  'Documented.swift',
  '// We deliberately avoid systemUptime and volumeAvailableCapacity here.\n/* attributesOfItem is not called. */\nlet d = UserDefaults.standard',
);
check('a category named only in comments is not treated as used', problems(), []);

rmSync(root, { recursive: true, force: true });
process.stdout.write(`\n  ${failures ? `${failures} failed` : 'all passed'}\n\n`);
process.exit(failures ? 1 : 0);
