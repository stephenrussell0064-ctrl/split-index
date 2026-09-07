import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * WP6.3 and WP12.7 — the same rule, arrived at from two directions.
 *
 *   WP6.3:  "the underlying value must be absent from the response payload
 *            entirely — a blurred number present in the JSON is not gated, it
 *            is decorated."
 *   WP12.7: "blurred premium previews must not be readable by a screen reader."
 *
 * Both are the same sentence: if the value is in the DOM, it is not gated. So
 * one change closes both, and one test guards it.
 *
 * WHAT WAS WRONG
 * --------------
 * `PremiumGate` rendered the real children behind `blur-[2px] opacity-40` with
 * no `aria-hidden` at all. A CSS filter is not a gate — the value was in the
 * page source, one devtools toggle from being visible, and announced verbatim
 * by a screen reader, which does not apply `blur`. An athlete using VoiceOver
 * was read the premium numbers while a sighted athlete was asked to pay.
 *
 * `PremiumTease` did carry `aria-hidden`, which is better, and was still wrong
 * for the other half: `aria-hidden` stops the announcement, not the exposure.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const COMPONENTS = join(ROOT, "src/components");

/**
 * Source with comments removed.
 *
 * Every one of these assertions matches on code shape, and this file's own
 * documentation quotes the removed pattern verbatim to explain it — which the
 * first version promptly flagged as an offender. Same mistake the WP2 bundle
 * scanner and the WP5 error guard each made once: prose describing a bug is not
 * the bug, and a detector that cannot tell the difference gets deleted.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function read(path: string): string {
  return stripComments(readFileSync(join(ROOT, path), "utf8"));
}

const GATE = read("src/components/analytics/premium-gate.tsx");
const TEASE = read("src/components/premium/premium-tease.tsx");

describe("a locked panel does not render what it is hiding", () => {
  it("PremiumGate returns before touching children when locked", () => {
    // The early return is the whole mechanism: children are reached only on
    // the unlocked path.
    expect(GATE).toMatch(/if \(!locked\) return <>\{children\}<\/>;/);
    /*
     * And after that statement, `children` is never referenced again.
     *
     * Sliced from the end of the LINE, not from a byte offset into it — the
     * first version used `+ 20`, which landed in the middle of the early return
     * and so matched that statement's own `{children}`.
     */
    const earlyReturn = GATE.indexOf("if (!locked)");
    const afterEarlyReturn = GATE.slice(GATE.indexOf("\n", earlyReturn));
    expect(afterEarlyReturn).not.toContain("{children}");
  });

  it("PremiumTease never renders children at all", () => {
    // The prop is kept so the call sites need not all change in the same
    // commit, and is deliberately not rendered.
    expect(TEASE).toMatch(/children:\s*_unrenderedPreview/);
    expect(TEASE).not.toContain("{children}");
  });

  it.each([
    ["PremiumGate", GATE],
    ["PremiumTease", TEASE],
  ])("%s no longer blurs a real value into the page", (_name, source) => {
    // `blur` on the panel chrome (backdrop-blur) is fine; blur applied to the
    // children is the pattern being removed.
    expect(source).not.toMatch(/blur-\[?\d*px?\]?[^"]*">\s*\{children\}/);
    expect(source).not.toMatch(/select-none[^"]*blur/);
  });

  it("labels the locked region for anyone who cannot see the lock icon", () => {
    for (const source of [GATE, TEASE]) {
      expect(source).toMatch(/aria-label=\{`\$\{(feature|title)\} — available with Premium`\}/);
    }
  });

  it("hides the decorative placeholder from assistive technology", () => {
    // The placeholder bars carry no information. The lock message does, and is
    // deliberately NOT hidden.
    expect(GATE).toMatch(/opacity-\[0\.07\][^>]*aria-hidden/);
  });

  it("does not shape the placeholder from the data it is hiding", () => {
    // A placeholder whose bar heights follow the real values is the same leak
    // with an extra step. These are fixed literals.
    expect(GATE).toMatch(/\[40, 65, 30, 80, 55, 70, 45, 60\]/);
    expect(GATE).not.toMatch(/children[\s\S]{0,80}map\(/);
  });
});

describe("no other component blurs a premium value into the DOM", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (/\.tsx$/.test(full)) out.push(full);
    }
    return out;
  }

  /**
   * The pattern, not the component. Someone reaching for `blur` plus
   * `select-none` around real content is rebuilding the bug by hand rather than
   * importing it, and that is the version no amount of fixing these two files
   * would catch.
   */
  it("has no blur-plus-select-none preview anywhere", () => {
    const offenders: string[] = [];
    for (const file of walk(COMPONENTS)) {
      const src = readFileSync(file, "utf8");
      for (const line of stripComments(src).split("\n")) {
        if (/select-none/.test(line) && /\bblur-/.test(line)) {
          offenders.push(relative(ROOT, file));
        }
      }
    }
    expect(
      [...new Set(offenders)],
      `these blur content rather than withholding it — a CSS filter is not a gate:\n  ${offenders.join("\n  ")}`
    ).toEqual([]);
  });
});
