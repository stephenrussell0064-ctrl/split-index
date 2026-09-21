import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * Every text control must be at least 16px, or iOS zooms the page on focus.
 *
 * WHAT HAPPENS. Safari on iPhone zooms into any input whose computed font-size
 * is under 16px when it takes focus. That is a platform behaviour, not a bug
 * we can opt out of: the usual escape hatch, `maximum-scale=1` in the viewport
 * meta, is ignored by modern iOS and would break pinch-zoom for everyone if it
 * were not.
 *
 * WHY IT DOES NOT GO AWAY. This app is a Capacitor WebView over a Next.js SPA.
 * Nothing here does a full page load, and the zoom level only resets on one.
 * So a single tap into one 14px field leaves the ENTIRE app zoomed in and
 * overflowing its own viewport for the rest of the session, with no gesture
 * that reliably restores it. Reported from a device as the screen "no longer
 * fitting the page and this would not go away", after typing a goal deadlift.
 *
 * `Input` in this directory has been 16px for a long time and carries a comment
 * saying why. The Hybrid Plan screens do not use it — they have their own field
 * components — so the rule never reached them, and thirteen controls across the
 * app were under the threshold. A comment in one component cannot enforce a
 * rule that applies to every component, which is why this is a test.
 *
 * The fix at each site is `text-base`. If a design genuinely needs smaller text
 * in a control, it needs an explicit font-size of 16px by another route, not a
 * smaller Tailwind step.
 */

const SMALL_TEXT = /\btext-(xs|sm)\b/;
const ADEQUATE_TEXT = /\btext-(base|lg|xl|2xl|3xl)\b/;
const CONTROLS = ["input", "select", "textarea"];

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Each control element whole, skipping `>` inside `{...}` expressions. */
function controls(src: string, tag: string): { start: number; text: string }[] {
  const out: { start: number; text: string }[] = [];
  for (const m of src.matchAll(new RegExp(`<${tag}[\\s>]`, "g"))) {
    let depth = 0;
    for (let i = m.index! + m[0].length - 1; i < src.length; i++) {
      const c = src[i];
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) {
        out.push({ start: m.index!, text: src.slice(m.index!, i) });
        break;
      }
    }
  }
  return out;
}

const FILES = ["src/components", "src/app"].flatMap((d) =>
  tsxFiles(join(process.cwd(), d)),
);

function offenders(): string[] {
  const bad: string[] = [];
  for (const path of FILES) {
    const src = readFileSync(path, "utf8");
    for (const tag of CONTROLS) {
      for (const el of controls(src, tag)) {
        // Every string literal in the tag, so `cn(...)` forms count too.
        const classes = [...el.text.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join(" ");
        if (SMALL_TEXT.test(classes) && !ADEQUATE_TEXT.test(classes)) {
          const line = src.slice(0, el.start).split("\n").length;
          const file = path.slice(process.cwd().length + 1);
          bad.push(`${file}:${line} <${tag}> is under 16px — iOS will zoom and stay zoomed`);
        }
      }
    }
  }
  return bad;
}

describe("no control small enough to make iOS zoom", () => {
  it("every input, select and textarea is at least 16px", () => {
    expect(offenders()).toEqual([]);
  });

  it("finds the controls at all", () => {
    // A parser failure here would return [] and pass having checked nothing.
    const found = FILES.flatMap((p) =>
      CONTROLS.flatMap((t) => controls(readFileSync(p, "utf8"), t)),
    );
    expect(found.length).toBeGreaterThan(40);
  });

  it("the viewport meta does not try to block zoom instead", () => {
    /*
     * The tempting shortcut is `maximum-scale=1, user-scalable=no`, which iOS
     * ignores anyway and which would remove pinch-zoom for anyone who needs it
     * — a WCAG 1.4.4 failure traded for a bug it does not even fix.
     */
    const layout = readFileSync(join(process.cwd(), "src/app/layout.tsx"), "utf8");
    expect(layout).not.toMatch(/maximum-scale/);
    expect(layout).not.toMatch(/user-scalable/);
  });
});
