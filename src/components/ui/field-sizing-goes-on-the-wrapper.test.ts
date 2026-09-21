import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/*
 * `className` on Input, Select and Textarea reaches the CONTROL. Anything about
 * how the field is sized inside a row belongs on `wrapperClassName` instead.
 *
 * WHAT WENT WRONG. The onboarding cardio row asked for a wider distance field
 * with `className="flex-[1.3]"`, and the SBD row asked for a 2:1 split with
 * `flex-[2]` and `flex-1`. All of them landed on the `<input>`, which is
 * `w-full` inside its own `flex flex-col` wrapper and is not a child of the
 * caller's row at all. So the intended widths never applied — and because the
 * wrapper is a COLUMN, `flex-[1.3]` there means `flex-basis: 0%` on the height,
 * which made that one input shorter than the two beside it.
 *
 * The failure is quiet in both directions: the layout you asked for silently
 * does not happen, and a different property silently changes instead.
 *
 * Only flex-child properties are flagged. `w-*` and `max-w-*` on the control
 * are legitimate — a caller may genuinely want to cap the control itself.
 */

const FIELD_COMPONENTS = ["Input", "Select", "Textarea"];

/** Classes that only mean anything on a child of the caller's flex/grid row. */
const PARENT_LAYOUT =
  /\b(flex-\[|flex-1\b|flex-auto|flex-initial|flex-none|basis-|grow\b|shrink\b|col-span-|row-span-|self-)/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Each `<Input ... />` element whole, including attributes across lines. */
function fieldElements(src: string): { tag: string; text: string; line: number }[] {
  const out: { tag: string; text: string; line: number }[] = [];
  for (const tag of FIELD_COMPONENTS) {
    const opener = new RegExp(`<${tag}\\b`, "g");
    for (const m of src.matchAll(opener)) {
      let depth = 0;
      for (let i = m.index! + m[0].length; i < src.length; i++) {
        const c = src[i];
        if (c === "{") depth++;
        else if (c === "}") depth--;
        else if (c === ">" && depth === 0) {
          out.push({
            tag,
            text: src.slice(m.index!, i),
            line: src.slice(0, m.index!).split("\n").length,
          });
          break;
        }
      }
    }
  }
  return out;
}

function offenders(): string[] {
  const bad: string[] = [];
  for (const path of ["src/components", "src/app"].flatMap((d) =>
    tsxFiles(join(process.cwd(), d)),
  )) {
    const src = readFileSync(path, "utf8");
    for (const el of fieldElements(src)) {
      const attr = el.text.match(/(?<!wrapper)className="([^"]*)"/);
      if (attr && PARENT_LAYOUT.test(attr[1])) {
        const file = path.slice(process.cwd().length + 1);
        bad.push(`${file}:${el.line} <${el.tag} className="${attr[1]}"> — use wrapperClassName`);
      }
    }
  }
  return bad;
}

describe("field sizing goes on the wrapper", () => {
  it("no field component takes flex-child classes through className", () => {
    expect(offenders()).toEqual([]);
  });

  it("finds the field components at all", () => {
    // Without this the scan could return [] because the element reader broke,
    // and pass having checked nothing — the failure mode these guards exist
    // to prevent in the components they watch.
    const found = ["src/components", "src/app"]
      .flatMap((d) => tsxFiles(join(process.cwd(), d)))
      .flatMap((p) => fieldElements(readFileSync(p, "utf8")));
    expect(found.length).toBeGreaterThan(30);
  });

  it("the wrapper prop actually reaches the wrapper", () => {
    // The prop is only worth recommending if it is wired up. All three
    // components must spread it onto their outer div, not their control.
    const src = readFileSync(join(process.cwd(), "src/components/ui/input.tsx"), "utf8");
    const wrappers = src.match(/cn\("flex flex-col gap-1\.5", wrapperClassName\)/g) ?? [];
    expect(wrappers.length).toBe(FIELD_COMPONENTS.length);
  });
});
