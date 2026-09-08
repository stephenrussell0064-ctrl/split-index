import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments, walkSource } from "@/lib/testing/source-scan";

/**
 * N7 item 4 — the mechanisable half of the keyboard walkthrough.
 *
 * WHAT THIS IS NOT
 * ----------------
 * The published accessibility statement says a full keyboard and screen-reader
 * walkthrough has not been done, and this file does not change that. It cannot:
 * a source scan cannot hear VoiceOver, cannot tell whether the focus ring is
 * visible against the glass panels, and cannot judge whether the order controls
 * are reached in makes sense. The statement's own line — that automated tooling
 * finds roughly a third of real problems — is the honest description of this
 * file, and item 4 stays open on the strength of it.
 *
 * What a scan CAN do is settle the mechanical questions for the whole app at
 * once, including the five journeys that sit behind a login and so cannot be
 * driven from outside: is anything mouse-only, is the tab order hand-rigged, is
 * a focus indicator removed and not replaced, is any control nameless, and does
 * every modal actually behave like one.
 *
 * Four of the six checks below passed the day they were written. They are
 * regression guards, and are labelled as such rather than dressed up as
 * discoveries. Two did not, and the defects they found are the reason this file
 * exists — see `modal backdrops` and `mouse-only controls`.
 *
 * ON THE PARSING
 * --------------
 * Not a real parser, for the reason source-scan.ts gives — but not a bare regex
 * either, and the difference was the whole exercise. `jsxTags` walks each tag
 * counting brace and quote depth, because the first version matched attributes
 * with `(?:[^<>]|\{[^{}]*\})*?` and that cannot see through ONE level of
 * nesting. Every framer-motion overlay in this app opens with
 * `initial={{ opacity: 0 }}`, so the pattern skipped the tag entirely and the
 * suite reported the app clean while the mobile nav sheet — the defect this
 * file was written to catch — sat there unmatched. A scanner that silently
 * declines to look at a construct is worse than no scanner, because it is
 * green.
 */

const SRC = "src";

/** JSX comments survive `stripComments` as an empty `{}`, which reads as an expression. */
function stripJsx(source: string): string {
  return stripComments(source.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ""));
}

type Tag = { name: string; base: string; attrs: string; line: number };

/**
 * Every JSX opening tag, with its attributes.
 *
 * Dotted names (`motion.div`) are included deliberately — framer-motion wraps
 * most of this app's overlays, and a pattern that only accepts bare element
 * names skips every one of them.
 */
function jsxTags(code: string): Tag[] {
  const out: Tag[] = [];
  const start = /<([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)?)(?=[\s/>])/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(code))) {
    // Walk to this tag's own closing `>`, ignoring any that sit inside an
    // attribute expression (`onClick={() => close()}` is the common one) or
    // inside a string. Depth counting is what a regex cannot do.
    let depth = 0;
    let quote: string | null = null;
    let i = start.lastIndex;
    for (; i < code.length; i++) {
      const c = code[i]!;
      if (quote) {
        if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") quote = c;
      else if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === ">" && depth === 0) break;
    }
    if (i >= code.length) continue;
    const name = m[1]!;
    out.push({
      name,
      base: name.split(".").pop()!,
      attrs: code.slice(start.lastIndex, i).replace(/\/$/, ""),
      line: code.slice(0, m.index).split("\n").length,
    });
    start.lastIndex = i;
  }
  return out;
}

/** One attribute's expression, brace-matched, or "" if it is not there. */
function attrValue(attrs: string, name: string): string {
  const at = attrs.search(new RegExp(`\\b${name}=\\{`));
  if (at === -1) return "";
  let depth = 0;
  const from = attrs.indexOf("{", at);
  for (let i = from; i < attrs.length; i++) {
    if (attrs[i] === "{") depth++;
    else if (attrs[i] === "}" && --depth === 0) return attrs.slice(from + 1, i);
  }
  return "";
}

/** What a handler expression does, as names: `() => toggle(id)` gives `toggle`. */
function handlerNames(expression: string): Set<string> {
  const names = new Set<string>();
  for (const m of expression.matchAll(/\b([a-zA-Z_$][\w$]*)\s*\(/g)) names.add(m[1]!);
  const bare = expression.trim().match(/^[a-zA-Z_$][\w$]*$/);
  if (bare) names.add(bare[0]);
  // Every handler in the app contains these; they identify nothing.
  for (const noise of ["stopPropagation", "preventDefault"]) names.delete(noise);
  return names;
}

function sources(): { file: string; code: string }[] {
  return walkSource(SRC, /\.tsx$/)
    .filter((f) => !/\.test\.tsx$/.test(f))
    .map((file) => ({ file, code: stripJsx(readFileSync(file, "utf8")) }));
}

/** A dimming layer over the whole viewport: the thing that makes a dialog modal. */
function isModalBackdrop(attrs: string): boolean {
  if (!/\binset-0\b/.test(attrs)) return false;
  if (!/bg-(?:black|background)\/\d/.test(attrs)) return false;
  // Hover-revealed scrims are not backdrops. onboarding-flow has one over each
  // sport card: `absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100`.
  // It dims a card on hover, dismisses nothing, and traps nobody.
  return !/opacity-0|group-hover:/.test(attrs);
}

describe("keyboard operability", () => {
  /*
    FOUND A DEFECT. Two, in the same shape.

    `merge-activities-modal` wrote `role="dialog" aria-modal="true"` by hand and
    stopped there — no focus moved in, no trap, no Escape, no restore. The
    attributes are the part that shows up in a review; the behaviour is the part
    that does not, so it read as finished. `aria-modal="true"` without the rest
    is worse than silence: it tells a screen reader the page behind is inert
    while Tab can still walk right into it.

    The mobile "More" sheet in app-shell had the opposite half — a real dimming
    backdrop, no dialog semantics of any kind.

    Neither is visible in a screenshot, which is why both survived the pass that
    converted the other four modals.
  */
  it("gives every modal backdrop a dialog that traps focus and closes on Escape", () => {
    const offenders: string[] = [];
    for (const { file, code } of sources()) {
      const backdrop = jsxTags(code).find((t) => isModalBackdrop(t.attrs));
      if (!backdrop) continue;
      if (/\buseDialog\b/.test(code)) continue;
      offenders.push(`${file}:${backdrop.line}`);
    }
    expect(offenders).toEqual([]);
  });

  /*
    FOUND A DEFECT, as a consequence of the one above: before the fix the More
    sheet's backdrop was a bare `<motion.div onClick={close}>` in a file with no
    Escape handler anywhere, so pointer users could dismiss it and keyboard
    users could not.

    The exemption is the interesting half of this rule. A backdrop legitimately
    has no key handler of its own — Escape is the keyboard equivalent of
    clicking it, and Escape belongs to the dialog, not to the scrim. So a
    backdrop is excused exactly when its file uses `useDialog`, which is the
    same condition as the check above. The two rules are one idea.
  */
  it("leaves no control that only a mouse can operate", () => {
    const NON_INTERACTIVE = new Set([
      "div", "span", "li", "tr", "td", "p", "section", "article",
      "header", "footer", "nav", "ul", "ol", "img", "svg", "label",
      "h1", "h2", "h3", "h4", "summary",
    ]);
    const offenders: string[] = [];
    for (const { file, code } of sources()) {
      const tags = jsxTags(code);
      const hasDialog = /\buseDialog\b/.test(code);
      // Everything a real button in this file does. A pointer-only shortcut on
      // a container is fine when the same action has a focusable control — see
      // the exemption note below.
      const viaButton = new Set<string>();
      for (const t of tags) {
        if (t.base !== "button") continue;
        for (const n of handlerNames(attrValue(t.attrs, "onClick"))) viaButton.add(n);
      }

      for (const t of tags) {
        if (!NON_INTERACTIVE.has(t.base)) continue;
        const onClick = attrValue(t.attrs, "onClick");
        if (!onClick && !/\bonClick=/.test(t.attrs)) continue;
        // Containment, not an action: `e.stopPropagation()` stops a click on the
        // dialog panel reaching the backdrop behind it. There is nothing here
        // for a keyboard to do.
        if (/stopPropagation/.test(t.attrs) && handlerNames(onClick).size === 0) continue;
        if (hasDialog && isModalBackdrop(t.attrs)) continue;
        /*
          The exemption that matters, and the one this rule would be wrong
          without. `leaderboard-panel` expands a row when the row is tapped,
          which is the right target on a phone — and a previous pass deliberately
          took `role="button" tabIndex={0}` OFF that row, because it contains a
          profile link and a Compare button, and interactive controls nested
          inside an interactive control is invalid. The keyboard equivalent is a
          chevron button at the end of the row carrying `aria-expanded`.

          So the test is not "does the container handle keys" — enforcing that
          would push the code back to the invalid shape it was moved away from.
          It is "does this action have a focusable control anywhere", which is
          what a keyboard user actually needs.
        */
        const named = handlerNames(onClick);
        if (named.size > 0 && [...named].some((n) => viaButton.has(n))) continue;
        const keyboardReachable =
          /\brole=/.test(t.attrs) && /\btabIndex=/.test(t.attrs) &&
          /\bonKey(?:Down|Up|Press)=/.test(t.attrs);
        if (!keyboardReachable) offenders.push(`${file}:${t.line} <${t.name}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
    A regression guard, green when written. Positive tabIndex hand-rigs the tab
    order into a sequence that has to be maintained against every future layout
    change, and interleaves badly with anything the browser inserts. WCAG 2.4.3.
  */
  it("never hand-rigs the tab order with a positive tabIndex", () => {
    const offenders: string[] = [];
    for (const { file, code } of sources()) {
      for (const t of jsxTags(code)) {
        const n = t.attrs.match(/tabIndex=\{(\d+)\}/);
        if (n && Number(n[1]) > 0) offenders.push(`${file}:${t.line} tabIndex=${n[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
    A regression guard, green when written. `outline-none` is nearly always
    written to replace the browser's ring with a nicer one, and the failure mode
    is writing the first half and not the second — which looks identical to
    anyone using a mouse. WCAG 2.4.7.

    Not checked HERE: whether the replacement has enough contrast to be seen.
    That is WCAG 1.4.11 Non-text Contrast, which asks 3:1 of the visual
    information identifying a state — a focus ring being the clearest case — and
    it is measured in lib/design/contrast.test.ts, which resolves the colour the
    :focus-visible rule actually draws in each mode scope and compares it with
    the surface behind it. That check found the Engine's ring at 2.50:1.

    This comment used to cite 2.4.11 and say the question needed eyes. Both were
    wrong. 2.4.11 is Focus Not Obscured (Minimum) — whether something is covering
    the focused control — and the 2px-perimeter rules people reach for are 2.4.13
    Focus Appearance, which is AAA and not what the statement claims. Contrast is
    1.4.11, it is arithmetic, and arithmetic does not need eyes.

    What still does: whether a ring that clears 3:1 is COMFORTABLE to follow on
    these glass panels, which no number answers.
  */
  it("never removes a focus indicator without replacing it", () => {
    const offenders: string[] = [];
    for (const { file, code } of sources()) {
      for (const t of jsxTags(code)) {
        if (!/outline-none/.test(t.attrs)) continue;
        // The skip-link target. `<main tabIndex={-1}>` is focused
        // programmatically by the skip link and never reached by Tab; a ring
        // around the entire page is not what "skipped to here" should look
        // like. Read off the element's OWN attributes — an earlier version
        // looked backwards through 200 characters of source for the literal id,
        // which stopped working the moment the id moved into shared props.
        if (/\bmainContentProps\b|\bid="main-content"/.test(t.attrs)) continue;
        const replaced =
          /focus(?:-visible)?:(?:ring|outline-(?!none)|border|bg|shadow)/.test(t.attrs) ||
          /\b(?:ring|outline)-\d/.test(t.attrs);
        if (!replaced) offenders.push(`${file}:${t.line} <${t.name}>`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
    A regression guard, green when written — 138 buttons, 28 named by
    aria-label, 102 by their own text, 8 by an expression that resolves to text.
    Icon-only buttons are where this goes wrong, and they are the ones a
    screen-reader user meets as "button". WCAG 4.1.2.

    What this does NOT check is whether the name is any GOOD. `squads-panel`
    names its copy button after the invite code it copies, so it announces as
    "M4K7QP, button" — a name, and not one that says what pressing it does.
    Judging that is 2.4.6 and it needs a person.
  */
  it("gives every button a name a screen reader can announce", () => {
    const offenders: string[] = [];
    for (const { file, code } of sources()) {
      const open = /<button(\s[^]*?)?(\/?)>/g;
      let m: RegExpExecArray | null;
      while ((m = open.exec(code))) {
        const attrs = m[1] ?? "";
        if (/aria-label|aria-labelledby|\btitle=/.test(attrs)) continue;
        if (m[2] === "/") {
          offenders.push(`${file}:${code.slice(0, m.index).split("\n").length} (self-closing)`);
          continue;
        }
        const close = code.indexOf("</button>", open.lastIndex);
        if (close === -1) continue;
        const inner = code.slice(open.lastIndex, close);
        const literal = inner.replace(/<[^>]*>/g, " ").replace(/\{[^{}]*\}/g, " ").trim();
        // An expression can still resolve to text — `{copied ? "Copied" : "Copy"}`
        // — so it counts as possibly-named and is reported by the survey rather
        // than failed here. All eight in the app were checked by hand and do.
        const expression = /\{/.test(inner.replace(/<[^>]*>/g, ""));
        if (!literal && !expression) {
          offenders.push(`${file}:${code.slice(0, m.index).split("\n").length}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
    The skip link used to be checked here, as "does anything in the app render
    the id the layout points at". It did — app-shell.tsx — and the check was
    green while the link was broken on every page outside the authenticated
    shell, which is every page a visitor sees.

    It is not re-pointed or tightened here: a check that asks the wrong question
    is not repaired by asking it harder. It has moved to skip-link.test.ts,
    which asks it per route, and this note stays so the next person does not
    reintroduce the app-wide version.
  */
});
