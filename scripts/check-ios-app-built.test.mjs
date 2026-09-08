#!/usr/bin/env node
/**
 * Tests for the one assertion in check-ios-app-built.mjs that mutation cannot
 * reach.
 *
 * Every other claim in that file is provable by breaking the app: drop an
 * `@objc` annotation and the plugin symbol disappears from the binary; remove
 * the .appex from the Embed phase and it stops being embedded; delete
 * NSSupportsLiveActivities and the built plist loses it. Each of those was
 * confirmed by doing it.
 *
 * The Capacitor major version is different. Package.swift pins `exact:
 * "8.5.0"`, so editing Package.resolved is an equivalent mutant — xcodebuild
 * re-resolves and overwrites the edit — and editing Package.swift makes
 * resolution fail before the assertion runs, which goes red for the wrong
 * reason with a message about the network rather than about Capacitor.
 *
 * So the assertion could not be shown to work, only shown to be unreachable.
 * Those are different things, and the gap matters: a half-applied Capacitor
 * major upgrade is precisely what it is there for, and on a machine that can
 * resolve packages it is the only thing that would catch one.
 *
 * Run: node scripts/check-ios-app-built.test.mjs
 */

import { capacitorMajorProblem } from './check-ios-app-built.mjs';

const pin = (version, identity = 'capacitor-swift-pm') => ({
  identity,
  kind: 'remoteSourceControl',
  location: 'https://github.com/ionic-team/capacitor-swift-pm.git',
  state: { revision: 'abc123', version },
});

let failures = 0;
function check(description, fn) {
  let ok;
  try {
    ok = fn();
  } catch (err) {
    ok = `threw: ${err.message}`;
  }
  if (ok !== true) failures++;
  process.stdout.write(
    `  ${ok === true ? 'ok  ' : 'FAIL'} ${description}\n` + (ok === true ? '' : `       ${ok}\n`),
  );
}

check('accepts the Capacitor 8 the project actually pins', () => {
  return capacitorMajorProblem({ pins: [pin('8.5.0')] }) === null || 'rejected 8.5.0';
});

check('accepts any 8.x, since the pin can move within the major', () => {
  const bad = ['8.0.0', '8.12.3'].filter((v) => capacitorMajorProblem({ pins: [pin(v)] }) !== null);
  return bad.length === 0 || `rejected ${bad.join(', ')}`;
});

check('REJECTS a Capacitor 7 resolution — the case mutation cannot produce', () => {
  /*
   * The whole point of the file. A machine that can reach the network, with
   * Package.swift loosened to a range, resolves 7.x and builds cleanly: five
   * plugins still export, the widget still embeds, Live Activities still
   * declared. Every other assertion passes and the app is on the wrong major.
   */
  const problem = capacitorMajorProblem({ pins: [pin('7.4.0')] });
  return (problem !== null && /Capacitor 8/.test(problem) && /7\.4\.0/.test(problem)) ||
    `got ${JSON.stringify(problem)}`;
});

check('rejects a graph with no Capacitor in it at all', () => {
  const problem = capacitorMajorProblem({ pins: [pin('1.0.0', 'some-other-package')] });
  return (problem !== null && /not a Capacitor app/.test(problem)) || `got ${JSON.stringify(problem)}`;
});

check('rejects a pin carrying no version, rather than reading it as 8', () => {
  // A branch or revision pin has no `version`. Empty string must not slip
  // through the /^8\./ test as "close enough".
  const problem = capacitorMajorProblem({ pins: [{ identity: 'capacitor-swift-pm', state: { revision: 'abc' } }] });
  return (problem !== null && /no version/.test(problem)) || `got ${JSON.stringify(problem)}`;
});

check('reads the older object.pins schema too', () => {
  // Package.resolved v1 nests under `object`. Xcode still writes v1 in some
  // configurations, and a check that silently saw zero pins would report "not
  // a Capacitor app" about an app that is one.
  return capacitorMajorProblem({ object: { pins: [pin('8.5.0')] } }) === null || 'v1 schema rejected';
});

check('matches on the `package` key as well as `identity`', () => {
  const p = { package: 'capacitor-swift-pm', state: { version: '8.5.0' } };
  return capacitorMajorProblem({ pins: [p] }) === null || 'package-key pin rejected';
});

check('does not throw on an empty or malformed file', () => {
  // A truncated Package.resolved must report a problem, not crash the check.
  for (const input of [{}, { pins: [] }, null, undefined]) {
    const problem = capacitorMajorProblem(input);
    if (problem === null) return `accepted ${JSON.stringify(input)}`;
  }
  return true;
});

check('does not mistake a 18.x or 80.x for an 8.x', () => {
  // `/^8\./` is anchored and dot-terminated; these must fail. Written down
  // because a looser `startsWith("8")` would pass both.
  const bad = ['18.0.0', '80.1.0'].filter((v) => capacitorMajorProblem({ pins: [pin(v)] }) === null);
  return bad.length === 0 || `accepted ${bad.join(', ')}`;
});

process.stdout.write(`\n  ${9 - failures}/9 passed\n\n`);
process.exit(failures ? 1 : 0);
