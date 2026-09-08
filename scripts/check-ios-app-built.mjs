#!/usr/bin/env node
/**
 * "App built — Capacitor 8, 5 native plugins, WidgetKit, Live Activities."
 *
 * That sentence is four claims about a native binary. The registry checked it
 * by testing that the directory `ios/` exists.
 *
 * `ios/` exists the moment `npx cap add ios` is run and keeps existing after
 * every subsequent mistake: a plugin file deleted from the target's Sources
 * phase, the widget extension unembedded, `NSSupportsLiveActivities` dropped
 * from Info.plist, a Capacitor major upgrade half-applied, or the project
 * simply not compiling at all. None of those move a directory check, and the
 * first anyone hears about them is an archive that fails or a feature that is
 * silently missing from a TestFlight build.
 *
 * So this builds the thing and reads the product:
 *
 *   node scripts/check-ios-app-built.mjs
 *
 * DerivedData goes to `ios/DerivedData/registry-check` (gitignored) and is
 * reused, so a warm run is about a minute. Simulator SDK and CODE_SIGNING
 * off, because the claim is "it builds and contains what it says", not "it is
 * signed for distribution" — signing is the operator's, behind their account.
 *
 * The binary, not the source. Every assertion below reads the compiled output,
 * because the failures worth catching are exactly the ones where the source
 * still says the right thing and the build no longer carries it.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const IOS = join(ROOT, 'ios', 'App');
const DERIVED = join(ROOT, 'ios', 'DerivedData', 'registry-check');
const PRODUCT = join(DERIVED, 'Build', 'Products', 'Debug-iphonesimulator', 'App.app');

/**
 * The five plugins the title counts.
 *
 * Named individually rather than counted, because "five files under App/"
 * passes when one is deleted and an unrelated one is added, and because a
 * Swift class only reaches Capacitor's runtime plugin registry if it is
 * `@objc` and actually compiled into the binary — which is what an exported
 * `_OBJC_CLASS_$_` symbol proves and a source grep does not.
 */
const APP_PLUGINS = [
  'DailyTrainingPlugin',
  'HeartRateWorkoutPlugin',
  'LiveActivityPlugin',
  'RacePredictionsPlugin',
  'StepCadencePlugin',
];

const failures = [];
const fail = (msg) => failures.push(msg);

function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
}

/** The binary carrying the code. Debug builds split it into a `.debug.dylib`; Release does not. */
function codeBinary(bundleDir, name) {
  const debugDylib = join(bundleDir, `${name}.debug.dylib`);
  return existsSync(debugDylib) ? debugDylib : join(bundleDir, name);
}

function build() {
  try {
    sh(
      'xcodebuild',
      [
        '-project', join(IOS, 'App.xcodeproj'),
        '-scheme', 'App',
        '-sdk', 'iphonesimulator',
        '-destination', 'generic/platform=iOS Simulator',
        '-configuration', 'Debug',
        '-derivedDataPath', DERIVED,
        'build',
        'CODE_SIGNING_ALLOWED=NO',
      ],
      { cwd: IOS, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    return true;
  } catch (err) {
    const out = `${err.stdout ?? ''}${err.stderr ?? ''}`;
    const errors = out.split('\n').filter((l) => /error:/.test(l)).slice(0, 20);
    fail(
      `the iOS app does not build.\n` +
        (errors.length ? errors.map((l) => `    ${l.trim()}`).join('\n') : `    ${out.slice(-2000)}`),
    );
    return false;
  }
}

/**
 * Capacitor 8, from the resolved package graph rather than the range in
 * package.json.
 *
 * Split out as a pure function on purpose. This is the one assertion in the
 * file that cannot be reached by mutating the repo: Package.swift pins
 * `exact: "8.5.0"`, so editing Package.resolved is an equivalent mutant —
 * xcodebuild re-resolves and overwrites it — and editing Package.swift makes
 * resolution fail before this runs, which goes red for a different reason and
 * with a misleading message.
 *
 * It is not dead code. It fires on a machine that can reach the network and
 * resolves a genuine Capacitor 7, which is exactly the half-applied major
 * upgrade this file exists to catch. But "cannot be exercised by mutation" and
 * "works" are different claims, and the second was never demonstrated. Now it
 * takes the parsed JSON and returns the problem or null, so
 * `check-ios-app-built.test.mjs` can hand it a Capacitor 7 graph directly.
 */
export function capacitorMajorProblem(resolved) {
  const pins = resolved?.pins ?? resolved?.object?.pins ?? [];
  const cap = pins.find((p) => (p.identity ?? p.package ?? '').includes('capacitor-swift-pm'));
  if (!cap) {
    return 'capacitor-swift-pm is not in the resolved package graph — this is not a Capacitor app';
  }
  const version = cap.state?.version ?? '';
  if (!/^8\./.test(version)) {
    return `the title says Capacitor 8; the build resolved capacitor-swift-pm ${version || '(no version)'}`;
  }
  return null;
}

function checkCapacitorMajor() {
  const resolvedPath = join(
    IOS,
    'App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved',
  );
  if (!existsSync(resolvedPath)) {
    fail('no Package.resolved — cannot tell which Capacitor the build linked');
    return;
  }
  const problem = capacitorMajorProblem(JSON.parse(readFileSync(resolvedPath, 'utf8')));
  if (problem) fail(problem);
}

function checkPlugins() {
  const binary = codeBinary(PRODUCT, 'App');
  if (!existsSync(binary)) {
    fail(`no app binary at ${binary}`);
    return;
  }
  const symbols = sh('nm', ['-g', binary]);
  for (const plugin of APP_PLUGINS) {
    // Exported ObjC class symbol. A Swift class that lost its `@objc`, or a
    // file dropped from the Sources build phase, has no such symbol — and
    // Capacitor cannot register a plugin it cannot find by name.
    if (!symbols.includes(`_OBJC_CLASS_$_${plugin}`)) {
      fail(`${plugin} is not an exported ObjC class in the built binary — Capacitor will not register it`);
    }
  }
}

function checkWidgetExtension() {
  const appex = join(PRODUCT, 'PlugIns', 'SplitIndexWidgetsExtension.appex');
  if (!existsSync(appex)) {
    // Building the extension is not the same as embedding it. An extension
    // that compiles and is not embedded ships an app with no widgets.
    fail('SplitIndexWidgetsExtension.appex is not embedded in App.app — the app ships without widgets');
    return;
  }
  const point = sh('plutil', [
    '-extract', 'NSExtension.NSExtensionPointIdentifier', 'raw', '-o', '-',
    join(appex, 'Info.plist'),
  ]).trim();
  if (point !== 'com.apple.widgetkit-extension') {
    fail(`the embedded extension is "${point}", not a WidgetKit extension`);
  }
  const linked = sh('otool', ['-L', codeBinary(appex, 'SplitIndexWidgetsExtension')]);
  if (!linked.includes('WidgetKit.framework')) {
    fail('the widget extension binary does not link WidgetKit');
  }
}

function checkLiveActivities() {
  let supports = '';
  try {
    supports = sh(
      'plutil',
      ['-extract', 'NSSupportsLiveActivities', 'raw', '-o', '-', join(PRODUCT, 'Info.plist')],
      // A missing key is the failure this function reports; plutil's own
      // stderr about it would just be noise above the sentence that explains it.
      { stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
  } catch {
    supports = '';
  }
  if (supports !== 'true') {
    // Without this key iOS refuses to start an activity at runtime, and the
    // LiveActivityPlugin fails silently on device while every test passes.
    fail('NSSupportsLiveActivities is not true in the built Info.plist — iOS will refuse to start a Live Activity');
  }
  const appLinked = sh('otool', ['-L', codeBinary(PRODUCT, 'App')]);
  if (!appLinked.includes('ActivityKit.framework')) {
    fail('the app binary does not link ActivityKit — nothing can start a Live Activity');
  }
  const appex = join(PRODUCT, 'PlugIns', 'SplitIndexWidgetsExtension.appex');
  if (existsSync(appex)) {
    const widgetLinked = sh('otool', ['-L', codeBinary(appex, 'SplitIndexWidgetsExtension')]);
    if (!widgetLinked.includes('ActivityKit.framework')) {
      // The app can start one; without this there is nothing to draw it.
      fail('the widget extension does not link ActivityKit — a started Live Activity has no UI');
    }
  }
}

function main() {
  if (!build()) {
    process.stderr.write(`\n${failures.join('\n\n')}\n\n`);
    process.exit(1);
  }

  checkCapacitorMajor();
  checkPlugins();
  checkWidgetExtension();
  checkLiveActivities();

  if (failures.length === 0) {
    process.stdout.write(
      `App.app builds; Capacitor 8, ${APP_PLUGINS.length} native plugins registered, ` +
        `WidgetKit extension embedded, Live Activities supported\n`,
    );
    process.exit(0);
  }

  process.stderr.write(
    `\nThe iOS app does not contain what the milestone says it does:\n\n` +
      failures.map((f) => `  - ${f}`).join('\n') +
      `\n\n`,
  );
  process.exit(1);
}

/*
 * Guarded so the module can be imported without building the iOS app.
 *
 * It was a bare `main()`. Importing `capacitorMajorProblem` from the test file
 * therefore kicked off xcodebuild and called process.exit before a single
 * assertion ran — the test "passed" by never executing. The same shape of bug
 * bit the venture-control permission gate earlier today, where importing it for
 * a test blocked on a stdin that never closed.
 */
if (import.meta.url === `file://${process.argv[1]}`) main();
