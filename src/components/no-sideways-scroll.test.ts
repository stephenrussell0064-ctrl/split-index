import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Stops a single form control dragging a whole screen sideways.
 *
 * WHAT HAPPENED. The Goals tab could only be read by scrolling left and right
 * on a phone. One `input[type=date]` was the cause: Safari sizes a date input
 * to the widest date its picker can draw rather than to its container, and a
 * flex child will not shrink below its intrinsic width because `min-width`
 * defaults to `auto`. The input pushed its row past the viewport, and since the
 * row sits in normal flow the entire tab gained a horizontal scrollbar — every
 * card on it, not just that field.
 *
 * The same unfixed input existed in the intake wizard, which is the flow a
 * reviewer has to complete before the Hybrid Plan renders at all.
 *
 * WHY A SOURCE TEST. jsdom has no layout: it reports every element as zero-sized
 * and would pass whatever the CSS said. Catching this for real needs a browser
 * at a phone width, which no test here runs. What IS checkable is that controls
 * whose width comes from their content — dates, times, and selects sized by
 * their longest option — are allowed to shrink.
 *
 * Fixed widths (`w-14`, `w-20`, `w-32`) are deliberately accepted: they are
 * bounded and small enough to fit the narrowest phone, so they cannot cause
 * this. It is the unbounded, content-sized controls that need the guard.
 */

/*
 * Widened beyond the hybrid plan after the same class of bug turned up on the
 * social leaderboard. These are the screens built from athlete-supplied
 * strings — exercise names, usernames, squad names — where nothing in the
 * layout bounds the content.
 */
/*
 * The whole component and route tree, not a list of screens someone remembered.
 *
 * This began as three directories — hybrid-plan, social, activities — added one
 * at a time as the same bug surfaced on each. That list was always a record of
 * where the bug had already been found, never of where it could occur, so it
 * could not have caught the next one. Six files holding content-sized controls
 * sat outside it, including the profile form and the analytics filters.
 */
function tsxFilesUnder(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) out.push(...tsxFilesUnder(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

const FILES = ["src/components", "src/app"].flatMap((d) =>
  tsxFilesUnder(join(process.cwd(), d)),
);

/** Controls whose natural width comes from content the layout does not bound. */
const CONTENT_SIZED = new Set(["date", "time", "datetime-local", "month", "week", "select"]);

/** Reads one JSX element whole, skipping `>` that appear inside `{...}` expressions. */
function elements(source: string, tag: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  const opener = new RegExp(`<${tag}\\s`, "g");
  for (const m of source.matchAll(opener)) {
    let depth = 0;
    for (let i = m.index! + m[0].length; i < source.length; i++) {
      const c = source[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push({ start: m.index!, text: source.slice(m.index!, i) });
        break;
      }
    }
  }
  return out;
}

function offenders(): string[] {
  const bad: string[] = [];
  for (const path of FILES) {
    const file = path.slice(process.cwd().length + 1);
    const src = readFileSync(path, "utf8");
    for (const tag of ["input", "select"]) {
      for (const el of elements(src, tag)) {
        const type = el.text.match(/type="([a-z-]+)"/)?.[1] ?? tag;
        if (!CONTENT_SIZED.has(type)) continue;

        /*
         * className is written both ways in this codebase — a plain string and
         * a cn(...) call — so every string literal inside the attribute counts.
         * Reading only the quoted form flagged two gym-form selects that carry
         * `w-full` inside cn(), and a guard that reports false positives gets
         * deleted rather than obeyed.
         */
        const attr = el.text.match(/className=(?:"[^"]*"|\{[\s\S]*?\}(?=\s|$))/)?.[0] ?? "";
        const className = [...attr.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ");
        const fixedWidth = /\bw-\d+\b/.test(className); // bounded by construction
        const canShrink = className.includes("min-w-0") || className.includes("w-full");
        if (!fixedWidth && !canShrink) {
          const line = src.slice(0, el.start).split("\n").length;
          bad.push(`${file}:${line} <${tag} type="${type}"> can outgrow its container`);
        }
      }
    }
  }
  return bad;
}

describe("content-sized controls on athlete-facing screens", () => {
  it("can all shrink below their intrinsic width", () => {
    // Named rather than counted, because the fix is per-control: add `min-w-0`
    // so it may shrink, and `max-w-full` so it stops at the viewport.
    expect(offenders()).toEqual([]);
  });

  it("finds the controls at all", () => {
    // Guards the parser above. If the element reader breaks, the test would
    // report zero offenders and pass for the wrong reason — which is the exact
    // failure mode this whole file exists to prevent elsewhere.
    const dates = FILES.flatMap((p) => elements(readFileSync(p, "utf8"), "input")).filter((el) =>
      el.text.includes('type="date"'),
    );
    expect(dates.length).toBeGreaterThan(0);
  });

  it("reaches the whole tree, not the three screens it started with", () => {
    // The scan's value is its breadth; if FILES silently narrowed, offenders()
    // would return [] and the suite would go green having checked almost
    // nothing. Two hundred is well under the current count and well over any
    // three directories.
    expect(FILES.length).toBeGreaterThan(200);
  });
});

/*
 * The base rule in globals.css that lets flex and grid children shrink at all.
 *
 * The scan above catches one shape of this bug — a content-sized form control
 * on a screen someone remembered to list. It cannot catch the general case,
 * because the element that actually refuses to shrink is usually a container
 * several levels above the wide thing and carries no clue in its markup.
 *
 * The base rule handles that general case. These tests exist because the rule
 * is one line, looks redundant to anyone tidying the stylesheet, and has a
 * failure mode that is invisible on a desktop browser.
 */
describe("the flex/grid min-width base rule", () => {
  const raw = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

  /*
   * Comments are stripped before anything is searched.
   *
   * The comment above the rule explains that it must stay inside `@layer base`,
   * and so contains that exact string. Searching the raw file finds the prose
   * before the block, and every assertion below then passes whether or not the
   * real rule is layered at all — which is precisely how the first version of
   * this test passed after the layer had been deliberately removed.
   */
  const css = raw.replace(/\/\*[\s\S]*?\*\//g, "");

  /** The `@layer base { ... }` block, or null if the rule sits outside one. */
  function baseLayerBlock(): string | null {
    const start = css.indexOf("@layer base");
    if (start === -1) return null;
    let depth = 0;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) return css.slice(start, i + 1);
    }
    return null;
  }

  it("is still there", () => {
    expect(css).toMatch(/:where\(\s*\.flex[^)]*\)\s*>\s*\*/);
    expect(css).toMatch(/min-width:\s*0/);
  });

  it("sits inside @layer base, which is the whole trick", () => {
    /*
     * Unlayered CSS beats layered CSS outright, whatever the specificity, and
     * Tailwind's utilities are layered. Written outside a layer this rule wins
     * against every `min-w-*` in the app and silently flattens them all.
     *
     * Measured in a browser rather than reasoned about: with the rule
     * unlayered, `min-w-11` computed to 0px; moved inside `@layer base` the
     * same element computed the correct 44px, while a plain flex child still
     * got 0px. Both halves have to hold, and only the layer delivers that.
     */
    const block = baseLayerBlock();
    expect(block, "no @layer base block in globals.css").not.toBeNull();
    expect(block).toMatch(/:where\(\s*\.flex[^)]*\)\s*>\s*\*/);
  });

  it("keeps specificity at zero so a utility on the element still wins", () => {
    // `:where()` is what holds specificity at 0. Without it the selector would
    // be (0,1,0) and would beat `min-w-11` from inside the layer too.
    const block = baseLayerBlock() ?? "";
    const rule = block.slice(block.indexOf(":where"));
    expect(rule.startsWith(":where(")).toBe(true);
    expect(rule).not.toMatch(/!important/);
  });
});
