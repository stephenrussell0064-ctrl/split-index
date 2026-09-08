import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * An anchor may not contain a button.
 *
 * `<Link href="..."><Button>Go</Button></Link>` reads like the obvious way to
 * make a button that navigates, and it emits `<a href="..."><button>Go</button></a>`
 * — interactive content nested inside interactive content. The HTML spec
 * forbids it, and WKWebView enforces the consequence: the tap lands on the
 * inner button, the button has no form to submit, and Next's click handler on
 * the anchor never runs. Nothing happens.
 *
 * A desktop browser bubbles the click to the anchor and navigates, which is
 * why this survived every review, every type check and every test. It was
 * found by tapping the shipped app: first the marketing CTAs (828ae68), then
 * the Edit button on an activity, reported as "does not work on the first
 * click". Twenty-four more sites were found by grep afterwards, in settings,
 * billing, the dashboard panels, the empty states and both error pages.
 *
 * The fix is always the same shape — one anchor wearing `buttonVariants()`
 * instead of an anchor wrapped around a button — so the guard can be a grep.
 * A rule nobody can violate accidentally is worth more here than a rule
 * everybody has to remember, because the failure is invisible in every
 * environment a developer actually looks at.
 */

const ROOTS = ["src/app", "src/components"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** `<Link ...>` with only whitespace before a `<Button`. Global, so a file with four of them reports four. */
const NESTED = /<Link\b[^>]*>\s*<Button\b/g;

describe("no anchor wraps a button", () => {
  it("finds none anywhere under src/app or src/components", () => {
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of tsxFiles(root)) {
        const src = readFileSync(file, "utf8");
        // Every occurrence, not just the first in each file. Reporting one at
        // a time turns a single sweep into as many runs as there are sites.
        for (const m of src.matchAll(NESTED)) {
          offenders.push(`${file}:${src.slice(0, m.index).split("\n").length}`);
        }
      }
    }

    expect(
      offenders,
      "Use `<Link className={buttonVariants({ ... })}>` instead — an anchor wrapped " +
        "around a button does not navigate in WKWebView, and looks fine everywhere else."
    ).toEqual([]);
  });

  it("actually looks at the files, rather than passing on an empty scan", () => {
    // A guard that silently stopped reading would report zero offenders
    // forever, which is the same output as success.
    const counted = ROOTS.reduce((n, r) => n + tsxFiles(r).length, 0);
    expect(counted).toBeGreaterThan(100);
  });
});
