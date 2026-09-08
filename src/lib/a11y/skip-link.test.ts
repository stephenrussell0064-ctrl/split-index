import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MAIN_CONTENT_ID } from "@/lib/a11y/main-content";
import { stripComments, walkSource } from "@/lib/testing/source-scan";

/**
 * The skip link has to have somewhere to go, on the page you are actually on.
 *
 * WHAT WENT WRONG, AND WHY THE FIRST TEST FOR IT PASSED
 * ----------------------------------------------------
 * keyboard-operability.test.ts already asserted that the skip link's target
 * exists. It asked whether ANY file in the app renders `id="main-content"`, one
 * did — app-shell.tsx — and the test went green.
 *
 * But app-shell wraps only the authenticated routes. On the landing page,
 * /login, /signup, /privacy, /terms, /accessibility and /how-scoring-works the
 * root layout still rendered "Skip to main content" as the first thing in the
 * tab order, and it pointed at nothing. Four of those were checked in a live
 * browser before this was written: `document.getElementById("main-content")`
 * returned null on /, /login, /accessibility and /privacy. WCAG 2.4.1.
 *
 * The lesson is the reusable part. "Something renders this" and "this page
 * renders this" are different questions, and a scanner that asks the first will
 * pass forever while a whole route group is broken. Anything the root layout
 * renders is owed by EVERY page, so the check has to be per page.
 *
 * WHAT THIS CANNOT SEE
 * --------------------
 * It follows imports one level: a page satisfies the rule by rendering the
 * target itself or by importing a module that does. A target three components
 * deep would be reported as missing. That is the safe direction — a false
 * failure is read and fixed, a false pass is not — and no page in this app
 * needs the depth.
 */

const APP = "src/app";

/** Every route module a visitor can land on, outside the authenticated shell. */
function publicRouteModules(): string[] {
  return walkSource(APP, /\.tsx$/)
    .filter((f) => !/\.test\.tsx$/.test(f))
    .filter((f) => /\/(page|not-found|error)\.tsx$/.test(f))
    // `(app)` is the authenticated group; its layout renders AppShell, which
    // renders the target once for every page inside it.
    .filter((f) => !f.includes("(app)"))
    .map((f) => f.replace(/\\/g, "/"));
}

/** Local modules a file imports, resolved to paths on disk. */
function localImports(file: string, code: string): string[] {
  const out: string[] = [];
  for (const m of code.matchAll(/from\s+"([^"]+)"/g)) {
    const spec = m[1]!;
    const base = spec.startsWith("@/")
      ? resolve("src", spec.slice(2))
      : spec.startsWith(".")
        ? resolve(dirname(file), spec)
        : null;
    if (!base) continue;
    for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx")]) {
      if (existsSync(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/** Does this module render the skip link's target, by id or via the shared props? */
function rendersTarget(code: string): boolean {
  return (
    new RegExp(`id="${MAIN_CONTENT_ID}"`).test(code) ||
    /\bmainContentProps\b/.test(code)
  );
}

describe("skip link", () => {
  it("gives every public route somewhere to skip to", () => {
    const missing: string[] = [];
    for (const file of publicRouteModules()) {
      const code = stripComments(readFileSync(file, "utf8"));
      if (rendersTarget(code)) continue;
      const viaImport = localImports(file, code).some((dep) =>
        rendersTarget(stripComments(readFileSync(dep, "utf8")))
      );
      if (!viaImport) missing.push(relative(".", file));
    }
    expect(missing).toEqual([]);
  });

  /*
    The link and the target were two separately written strings, in two files,
    one of which is rendered far more often than the other. They agreed, which
    is why the missing-target bug was invisible — the failure was never a typo.
    Sharing the constant is not what fixed the bug; it is what stops the NEXT
    version of it, where someone renames one half.
  */
  it("builds the link's href from the same constant as the target", () => {
    const layout = stripComments(readFileSync("src/app/layout.tsx", "utf8"));
    expect(layout).toMatch(/href=\{SKIP_LINK_HREF\}/);
    expect(layout).not.toMatch(new RegExp(`href="#${MAIN_CONTENT_ID}"`));
  });

  /*
    `<main>` is not focusable, so without tabIndex the browser scrolls to the
    anchor and leaves focus where it was — the next Tab returns to the skip link
    and the athlete is in a two-stop loop. It reads as "the link does nothing",
    which is exactly what it was reported as on WebKit before it was added.
  */
  it("makes the target focusable", () => {
    const props = readFileSync("src/lib/a11y/main-content.ts", "utf8");
    expect(props).toMatch(/tabIndex:\s*-1/);
  });
});
