import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * A comment that names a test file must name one that exists.
 *
 * FOUR OF THEM DID NOT. Every one stated a specific guarantee, in the file the
 * guarantee was about, in the voice of something already settled:
 *
 *   auth-errors.ts       "auth-errors.test.ts asserts the two are byte-identical,
 *                        so splitting them again fails the build rather than
 *                        quietly reopening the oracle."
 *   article9.ts          "consent-gate.test.ts asserts that boundary in both
 *                        directions."
 *   activity.ts          "activity-schema.test.ts holds them together."
 *   intake.ts            "TIER_2_FULLY_TYPED below is asserted in
 *                        intake-schema.test.ts so it stays complete."
 *
 * Three of the four claims turned out to be true and merely unchecked. The
 * fourth was false: `authErrorMessage` consulted its message map only when the
 * provider had said nothing useful, so sign-in answered "Invalid login
 * credentials" or "User not found" depending on whether the account existed —
 * the account-enumeration oracle that comment says is closed, open the whole
 * time, on an app holding health data.
 *
 * That is the cost being guarded against. A claim like this is read as a
 * finding: the next person sees the property is covered and looks elsewhere,
 * and the comment is doing the opposite of its job — it is not neutral
 * documentation debt, it actively spends someone's attention.
 *
 * SCOPE. Only citations in non-test source, and only names ending .test.ts(x).
 * A test file naming another test file is usually describing a relationship
 * between suites rather than promising coverage, and is left alone.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url)).replace(/[/\\]$/, "");

/** Every filename of the form `something.test.ts` that appears in the tree. */
function existingTestFiles(): Set<string> {
  const names = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name));
      else if (/\.test\.tsx?$/.test(entry.name)) names.add(entry.name);
    }
  };
  walk(SRC);
  return names;
}

function citations(): { file: string; cited: string }[] {
  const found: { file: string; cited: string }[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
      const src = readFileSync(full, "utf8");
      for (const [, cited] of src.matchAll(/([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.test\.tsx?)/g)) {
        found.push({ file: full.slice(SRC.length).replace(/\\/g, "/"), cited });
      }
    }
  };
  walk(SRC);
  return found;
}

describe("a comment that cites a test", () => {
  it("cites one that exists", () => {
    const existing = existingTestFiles();
    const broken = citations()
      .filter(({ cited }) => !existing.has(cited))
      .map(({ file, cited }) => `${file} cites ${cited}, which does not exist`);

    // Named rather than counted. The name is the whole finding: it says which
    // guarantee is unbacked, and the file it sits in says what that guarantee
    // was supposed to be.
    expect(broken).toEqual([]);
  });

  it("finds the citations it is meant to be checking", () => {
    /*
      The way this guard fails silently: a regex that stops matching finds
      nothing, reports nothing, and passes forever. There are real citations in
      the tree — if this ever hits zero, the pattern above is broken rather
      than the codebase being clean.
    */
    expect(citations().length).toBeGreaterThan(0);
  });
});
