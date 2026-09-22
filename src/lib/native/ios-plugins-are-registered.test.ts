import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A Swift file on disk that Xcode has never been told about does not exist.
 *
 * WHAT HAPPENED. `c3418ee` added `SpeechPlugin.swift`, the
 * `registerPluginInstance(SpeechPlugin())` call in MainViewController, and the
 * four `project.pbxproj` entries that make Xcode compile it. All four entries
 * were then LOST in the merge `93bb7c1`, and main has not built for iOS since:
 *
 *     Cannot find 'SpeechPlugin' in scope
 *     The file "App.swiftmodule" couldn't be opened because there is no such file.
 *
 * The second error is a cascade of the first — the module never compiled, so
 * nothing downstream could link against it.
 *
 * WHY THE MERGE ATE IT, because this is the part that will happen again. A
 * pbxproj object id must be unique within the file, and both sides of that
 * merge had hand-allocated the SAME PAIR from the same `AA01F1E2C3D4B5A60000…`
 * sequence:
 *
 *     …0301 / …0302   SpeechPlugin.swift            (venture/b7, c3418ee)
 *     …0301 / …0302   SplitIndexWidgets/GymTimerIntents.swift  (app-store line)
 *
 * Same ids, different files. Git saw one side's version of the same lines
 * rather than a conflict, kept GymTimerIntents, and SpeechPlugin's four entries
 * vanished with no marker to resolve and nothing in the diff to notice. A
 * TypeScript suite cannot see it, `tsc` cannot see it, and the web build is
 * completely unaffected — it only appears when someone opens Xcode.
 *
 * So this file asserts the two things that would each have caught it: every
 * plugin source is registered, and no object id is defined twice.
 */

const IOS_APP = fileURLToPath(new URL("../../../ios/App", import.meta.url));
const PBXPROJ = `${IOS_APP}/App.xcodeproj/project.pbxproj`;

function pbxproj(): string {
  return readFileSync(PBXPROJ, "utf8");
}

/** Swift sources that live directly in the App target's own directory. */
function appSwiftFiles(): string[] {
  return readdirSync(`${IOS_APP}/App`)
    .filter((f) => f.endsWith(".swift"))
    .sort();
}

describe("every Swift source in the iOS App target is registered with Xcode", () => {
  const project = pbxproj();

  it.each(appSwiftFiles())("%s is in the project file", (file) => {
    expect(
      project.includes(file),
      `${file} exists on disk but no project.pbxproj entry compiles it. Xcode will report ` +
        `"Cannot find '<Type>' in scope" and then fail to emit App.swiftmodule.`
    ).toBe(true);
  });

  it.each(appSwiftFiles())("%s is in the Sources build phase, not merely referenced", (file) => {
    // A PBXFileReference alone puts the file in the navigator and compiles
    // nothing. The `in Sources */` suffix is the build-phase entry.
    expect(
      project.includes(`${file} in Sources */`),
      `${file} is referenced but not in PBXSourcesBuildPhase — it will show in Xcode's file ` +
        `tree and still not be compiled, which is the more confusing half of this failure.`
    ).toBe(true);
  });

  it("registers SpeechPlugin specifically, since this is the one that was lost", () => {
    // Named rather than left to the sweep above: a future edit that deletes
    // the file AND its entries together would pass the parameterised tests by
    // having nothing to check, while MainViewController still calls it.
    const mvc = readFileSync(`${IOS_APP}/App/MainViewController.swift`, "utf8");
    if (mvc.includes("SpeechPlugin(")) {
      expect(
        project.includes("SpeechPlugin.swift in Sources */"),
        "MainViewController instantiates SpeechPlugin but the project does not compile it."
      ).toBe(true);
    }
  });
});

describe("no two pbxproj objects share an id", () => {
  /**
   * The collision above was invisible because git resolves identical ids as
   * the same line. Two objects defined under one id is always a bug, and it is
   * the state that makes a merge silently pick one file over another.
   */
  it("defines every object id exactly once", () => {
    const ids = new Map<string, string[]>();
    for (const line of pbxproj().split("\n")) {
      // An object definition: `\t\t<24-hex-id> /* comment */ = {isa = …`
      const m = /^\t\t([0-9A-F]{24}) \/\* (.+?) \*\/ = \{/.exec(line);
      if (!m) continue;
      ids.set(m[1], [...(ids.get(m[1]) ?? []), m[2]]);
    }

    expect(ids.size, "no object definitions matched — the parser has drifted from the format").toBeGreaterThan(10);

    const collisions = [...ids.entries()]
      .filter(([, names]) => names.length > 1)
      .map(([id, names]) => `${id} is used by: ${names.join(" AND ")}`);

    expect(collisions).toEqual([]);
  });

  it("hands every build-file entry a fileRef that actually exists", () => {
    // The other half of a botched merge: an entry left pointing at an id the
    // merge removed. Xcode opens the project and silently drops the file.
    const project = pbxproj();
    const defined = new Set([...project.matchAll(/^\t\t([0-9A-F]{24}) \/\* .+? \*\/ = \{/gm)].map((m) => m[1]));
    const dangling = [...project.matchAll(/fileRef = ([0-9A-F]{24}) \/\* (.+?) \*\//g)]
      .filter((m) => !defined.has(m[1]))
      .map((m) => `${m[2]} points at missing fileRef ${m[1]}`);

    expect(dangling).toEqual([]);
  });
});
