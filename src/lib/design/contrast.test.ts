import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * WP12 — measured contrast, for every brand pairing.
 *
 * The brief is specific about why this is a test and not a design review:
 * "Colour as the sole carrier of meaning is the most likely conformance
 * failure, and it is also the design decision most likely to be defended on
 * aesthetic grounds. Measure before arguing."
 *
 * So the numbers are computed here from the tokens as they actually ship,
 * rather than recorded once in a document that goes stale. A palette edit that
 * drops a pairing below its threshold fails the build with the measured ratio
 * in the message.
 *
 * WHAT THIS FOUND
 * ---------------
 * The Lab palette is excellent — neon green on near-black measures 15.17:1,
 * more than three times what AA asks for. The Engine palette was the failure:
 * #3BA6FF on the near-white cardio surface measured 2.50:1, below the 4.5:1
 * text threshold AND below the 3:1 non-text one, so it failed as an icon or a
 * border as much as it failed as a word. `--cardio-accent-soft` was worse at
 * 2.03:1.
 *
 * Per the brief, the fix is "a tuned variant for text use, not abandoning the
 * palette" — same hue and saturation, walked down in lightness.
 */

const CSS = fileURLToPath(new URL("../../app/globals.css", import.meta.url));

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Read the tokens out of globals.css rather than restating them.
 *
 * Restating would let the file and the test disagree, and the test would keep
 * passing against a palette nobody ships.
 */
function tokens(): Record<string, string> {
  const css = readFileSync(CSS, "utf8");
  const root = css.slice(css.indexOf(":root"), css.indexOf("@theme"));
  const out: Record<string, string> = {};
  for (const [, name, value] of root.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    out[name] = value.toUpperCase();
  }
  return out;
}

const T = tokens();

/** 4.5:1 for body text, 3:1 for large text and for anything non-text that carries meaning. */
const TEXT = 4.5;
const NON_TEXT = 3;

interface Pairing {
  what: string;
  fg: string;
  bg: string;
  min: number;
}

/**
 * Every pairing the product actually renders.
 *
 * Listed explicitly rather than generated from the cross product, because most
 * combinations are never drawn and asserting on them would be noise that
 * eventually gets the whole file deleted.
 */
const PAIRINGS: Pairing[] = [
  // ── The app shell, dark ────────────────────────────────────────────────────
  { what: "body text on the app background", fg: "foreground", bg: "background", min: TEXT },
  { what: "muted text on the app background", fg: "muted", bg: "background", min: TEXT },
  {
    what: "muted-foreground on the app background",
    fg: "muted-foreground",
    bg: "background",
    min: TEXT,
  },
  { what: "accent on the app background", fg: "accent", bg: "background", min: TEXT },
  { what: "text on an accent fill", fg: "accent-foreground", bg: "accent", min: TEXT },

  // ── Status colours. These carry meaning, so they clear the non-text bar even
  //    when they are only a dot or a bar.
  { what: "success on the app background", fg: "success", bg: "background", min: TEXT },
  { what: "warning on the app background", fg: "warning", bg: "background", min: TEXT },
  { what: "danger on the app background", fg: "danger", bg: "background", min: TEXT },

  // ── The Lab · gym zone ────────────────────────────────────────────────────
  { what: "Lab text on the gym background", fg: "gym-text", bg: "gym-bg", min: TEXT },
  { what: "Lab muted on the gym background", fg: "gym-muted", bg: "gym-bg", min: TEXT },
  { what: "Lab accent on the gym background", fg: "strength-accent", bg: "gym-bg", min: TEXT },
  {
    what: "Lab accent on the elevated gym surface",
    fg: "strength-accent",
    bg: "gym-bg-elevated",
    min: TEXT,
  },
  {
    what: "Lab accent-soft on the gym background",
    fg: "strength-accent-soft",
    bg: "gym-bg",
    min: TEXT,
  },

  // ── The Engine · cardio zone. The half that failed. ───────────────────────
  { what: "Engine text on the cardio background", fg: "cardio-text", bg: "cardio-bg", min: TEXT },
  { what: "Engine muted on the cardio background", fg: "cardio-muted", bg: "cardio-bg", min: TEXT },
  {
    what: "Engine accent as TEXT on the cardio background",
    fg: "cardio-accent-text",
    bg: "cardio-bg",
    min: TEXT,
  },
  {
    what: "Engine accent as TEXT on the elevated cardio surface",
    fg: "cardio-accent-text",
    bg: "cardio-bg-elevated",
    min: TEXT,
  },
  {
    what: "Engine accent as an ICON or BORDER on the cardio background",
    fg: "cardio-accent-strong",
    bg: "cardio-bg",
    min: NON_TEXT,
  },
  // The Engine blue is legible on the DARK shell — it only fails on its own
  // near-white surface, which is why one token could not serve both.
  { what: "Engine accent on the app background", fg: "cardio-accent", bg: "background", min: TEXT },
];

/**
 * The light-mode remaps, which are scoped CSS rules rather than :root tokens.
 *
 * `[data-mode="cardio"] .mode-content` and `.bg-cardio-zone` override the
 * dark-theme tokens so shared components stay legible on white. Three of those
 * overrides were themselves failures — including white-on-accent at 2.60:1,
 * which made the label of every primary button in cardio mode harder to read
 * than the button — so they are measured here too. Values are read out of the
 * rules rather than restated, for the same reason as the tokens above.
 */
/** A token as literally written inside one rule block, or null if that block does not set it. */
function rawIn(selector: string, property: string): string | null {
  const css = readFileSync(CSS, "utf8");
  /*
    Match the selector where it OPENS A RULE, not merely where the characters
    appear. `indexOf(selector)` found the first mention anywhere in the file,
    and a comment that names the selector it is describing — which is what a
    useful comment does — silently won the race and made this read tokens out
    of the wrong block. Same trap as the scanners in lib/testing/source-scan.ts:
    prose about a thing is not the thing.
  */
  const opens = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`);
  const found = opens.exec(css);
  if (!found) return null;
  const block = css.slice(found.index, css.indexOf("}", found.index));
  const match = block.match(
    new RegExp(`--${property}:\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z0-9-]+\\))`)
  );
  return match ? match[1]! : null;
}

/** The same, from :root. Sliced the way `tokens()` slices it, for the same reasons. */
function rawInRoot(property: string): string | null {
  const css = readFileSync(CSS, "utf8");
  const root = css.slice(css.indexOf(":root"), css.indexOf("@theme"));
  const match = root.match(
    new RegExp(`--${property}:\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z0-9-]+\\))`)
  );
  return match ? match[1]! : null;
}

/**
 * Follow `var()` down to a hex, AS IT WOULD COMPUTE INSIDE `selector`.
 *
 * The scope is consulted before :root at every hop, because that is what custom
 * property inheritance does, and getting it wrong is not a subtle error. Two
 * earlier versions of this got it wrong in opposite directions: one stopped
 * after a single hop, so `--gym-accent: var(--strength-accent)` resolved to
 * undefined and failed on a NaN; the next resolved every hop against :root, so
 * a scope that redefines --accent was read as though it had not, reporting a
 * green ring at 1.28:1 on a branch whose ring is really the dark ink at 5.30:1.
 *
 * A NaN that happens to fail and a lookup that happens to agree with :root are
 * the same bug wearing different clothes: the number in the message is not
 * describing the CSS.
 */
function resolveIn(selector: string, raw: string, depth = 0): string {
  if (!raw.startsWith("var(")) return raw.toUpperCase();
  if (depth > 6) throw new Error(`--${raw} in ${selector} loops through var()`);
  const name = raw.slice(6, -1);
  const next = rawIn(selector, name) ?? rawInRoot(name);
  if (!next) throw new Error(`--${name} (via ${selector}) is defined nowhere this test can see`);
  return resolveIn(selector, next, depth + 1);
}

/**
 * A token this scope sets ITSELF.
 *
 * Throws when the scope does not set it, and that guard is the point: the
 * assertions below use this to check that a light-mode remap is present, so
 * quietly falling back to the dark-theme value would turn a deleted remap into
 * a pass.
 */
function scopedValue(selector: string, property: string): string {
  const raw = rawIn(selector, property);
  if (raw === null) throw new Error(`${selector} does not set --${property}`);
  return resolveIn(selector, raw);
}

/**
 * A token as a control inside this scope would actually see it — set here, or
 * inherited from :root and re-resolved against this scope.
 *
 * This is the one to use for anything a global rule draws, because a global
 * rule does not know which scope it landed in.
 */
function inheritedValue(selector: string, property: string): string {
  const raw = rawIn(selector, property) ?? rawInRoot(property);
  if (raw === null) throw new Error(`--${property} is set neither in ${selector} nor :root`);
  return resolveIn(selector, raw);
}

describe("measured contrast", () => {
  it.each(PAIRINGS)("$what clears $min:1", ({ fg, bg, min }) => {
    const fgHex = T[fg];
    const bgHex = T[bg];
    expect(fgHex, `--${fg} is not a hex token in globals.css`).toBeDefined();
    expect(bgHex, `--${bg} is not a hex token in globals.css`).toBeDefined();

    const ratio = contrastRatio(fgHex, bgHex);
    expect(
      Number(ratio.toFixed(2)),
      `--${fg} (${fgHex}) on --${bg} (${bgHex}) measures ${ratio.toFixed(2)}:1, below ${min}:1`
    ).toBeGreaterThanOrEqual(min);
  });

  /**
   * The finding this whole section exists for, kept as an explicit assertion so
   * that "just use --cardio-accent, it looks the same" fails loudly rather than
   * regressing the fix.
   */
  it("keeps the raw Engine accent out of text-sized use on its own surface", () => {
    const raw = contrastRatio(T["cardio-accent"], T["cardio-bg"]);
    expect(raw).toBeLessThan(TEXT);
    // And its tuned counterpart clears comfortably.
    expect(contrastRatio(T["cardio-accent-text"], T["cardio-bg"])).toBeGreaterThanOrEqual(TEXT);
  });

  it.each([
    ['[data-mode="cardio"] .mode-content', "muted-foreground", "cardio-bg", TEXT, "cardio-mode muted text"],
    ['[data-mode="cardio"] .mode-content', "accent", "cardio-bg", TEXT, "cardio-mode accent as text"],
    ['.bg-cardio-zone', "accent", "cardio-bg", TEXT, "zone accent as text"],
  ])("%s remaps --%s to something legible (%s)", (selector, property, bg, min) => {
    const fg = scopedValue(selector, property);
    const ratio = contrastRatio(fg, T[bg]);
    expect(
      Number(ratio.toFixed(2)),
      `${selector} --${property} (${fg}) on --${bg} (${T[bg]}) measures ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(min);
  });

  it("keeps a button label legible against its own accent fill in cardio mode", () => {
    // This was 2.60:1 — white on #3BA6FF. The label of every primary button in
    // cardio mode was harder to read than the button it sat on.
    const accent = scopedValue('[data-mode="cardio"] .mode-content', "accent");
    const label = scopedValue('[data-mode="cardio"] .mode-content', "accent-foreground");
    expect(Number(contrastRatio(label, accent).toFixed(2))).toBeGreaterThanOrEqual(TEXT);
  });

  it("keeps the two palettes honest about which is which", () => {
    // The Lab side is not merely passing, it is far clear — worth pinning so
    // that a future "let's soften the green" change has to argue with a number.
    expect(contrastRatio(T["strength-accent"], T["gym-bg"])).toBeGreaterThan(10);
  });

  /*
   * THE KEYBOARD FOCUS OUTLINE — the gap in the pass above.
   *
   * That pass sorted the palette into two kinds of use and measured both: text,
   * at 4.5:1, and a fill nobody reads, at nothing. The focus ring is neither. It
   * is non-text content carrying meaning, so 1.4.11 asks 3:1 — and because
   * `outline-offset: 2px` puts it OUTSIDE the control, the thing it must contrast
   * with is the page behind, not the component.
   *
   * In the Engine that made `--accent`, deliberately left at the brand #3BA6FF
   * as a fill, into a 2.50:1 focus indicator on --cardio-bg and 2.38:1 on
   * --cardio-bg-elevated. Nothing about the palette was wrong; the outline was
   * simply reading a token chosen for a different job.
   *
   * Resolved from the rule rather than from the token this fix happens to
   * introduce. If someone points :focus-visible back at --accent, or invents a
   * third token, the assertion follows them there instead of passing because
   * --focus-ring still measures well while nothing uses it.
   */
  const FOCUS_SURFACES: Array<[string, string, string]> = [
    // scope selector, background token, what it is
    [":root", "background", "the dark app shell"],
    ['[data-mode="cardio"] .mode-content', "cardio-bg", "the Engine's own page"],
    ['[data-mode="cardio"] .mode-content', "cardio-bg-elevated", "an Engine card"],
    ['[data-mode="gym"] .mode-content', "gym-bg", "the Lab's own page"],
  ];

  it.each(FOCUS_SURFACES)(
    "%s draws a focus ring that clears 3:1 on --%s (%s)",
    (selector, bg) => {
      const css = readFileSync(CSS, "utf8");
      const rule = css.match(/:focus-visible\s*\{([^}]*)\}/);
      expect(rule, "globals.css no longer has a global :focus-visible outline").toBeTruthy();

      const usesVar = rule![1].match(/outline:[^;]*var\(--([a-z0-9-]+)\)/);
      expect(
        usesVar,
        `the focus outline is not drawn from a token: ${rule![1].trim()}`
      ).toBeTruthy();
      const property = usesVar![1]!;

      // As a control inside this scope actually sees it: pinned here, or
      // inherited from :root and re-resolved against this scope's own tokens.
      // A global rule does not know which scope it landed in, which is the
      // whole reason this assertion exists.
      const colour = inheritedValue(selector, property);

      const ratio = contrastRatio(colour, T[bg]!);
      expect(
        Number(ratio.toFixed(2)),
        `focus ring in ${selector} is ${colour} on --${bg} (${T[bg]}) = ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(NON_TEXT);
    }
  );
});

describe("the ratio calculation itself", () => {
  // If this is wrong, every assertion above is decoration.
  it("matches the known anchors", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 1);
    expect(contrastRatio("#000000", "#000000")).toBeCloseTo(1, 5);
    // A published reference value: #767676 on white is the canonical 4.54:1
    // example used in the WCAG docs for the AA text threshold.
    expect(contrastRatio("#767676", "#FFFFFF")).toBeCloseTo(4.54, 1);
  });

  it("is symmetric, so pairing order cannot change a verdict", () => {
    expect(contrastRatio("#3BA6FF", "#F7FBFF")).toBeCloseTo(
      contrastRatio("#F7FBFF", "#3BA6FF"),
      10
    );
  });
});
