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

const DIR = join(process.cwd(), "src/components/hybrid-plan");

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
  for (const file of readdirSync(DIR).filter((f) => f.endsWith(".tsx"))) {
    const src = readFileSync(join(DIR, file), "utf8");
    for (const tag of ["input", "select"]) {
      for (const el of elements(src, tag)) {
        const type = el.text.match(/type="([a-z-]+)"/)?.[1] ?? tag;
        if (!CONTENT_SIZED.has(type)) continue;

        const className = el.text.match(/className="([^"]*)"/)?.[1] ?? "";
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

describe("content-sized controls in the hybrid plan", () => {
  it("can all shrink below their intrinsic width", () => {
    // Named rather than counted, because the fix is per-control: add `min-w-0`
    // so it may shrink, and `max-w-full` so it stops at the viewport.
    expect(offenders()).toEqual([]);
  });

  it("finds the controls at all", () => {
    // Guards the parser above. If the element reader breaks, the test would
    // report zero offenders and pass for the wrong reason — which is the exact
    // failure mode this whole file exists to prevent elsewhere.
    const dates = readdirSync(DIR)
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) => elements(readFileSync(join(DIR, f), "utf8"), "input"))
      .filter((el) => el.text.includes('type="date"'));
    expect(dates.length).toBeGreaterThan(0);
  });
});
