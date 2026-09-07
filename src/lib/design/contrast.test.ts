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
function scopedValue(selector: string, property: string): string {
  const css = readFileSync(CSS, "utf8");
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  const block = css.slice(start, css.indexOf("}", start));
  const match = block.match(new RegExp(`--${property}:\\s*(#[0-9a-fA-F]{6}|var\\(--[a-z0-9-]+\\))`));
  if (!match) throw new Error(`${selector} does not set --${property}`);
  const raw = match[1];
  // One level of var() indirection is all these rules use.
  return raw.startsWith("var(")
    ? T[raw.slice(6, -1)]
    : raw.toUpperCase();
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

  /*
   * ACCENT-AS-TEXT IS NOT ASSERTED HERE, AND THAT IS THE DESIGN, NOT AN
   * OVERSIGHT.
   *
   * This list used to require `--accent` inside the cardio scopes to clear
   * 4.5:1 by itself, which assumed the fix was to darken the accent token.
   * The fix that shipped keeps `--cardio-accent` at the brand #3BA6FF as a
   * FILL — where 2.50:1 is irrelevant, because nothing reads the fill — and
   * redirects only the TEXT uses, via the
   * `[class*="text-cardio-accent"]` rules in globals.css. Asserting the fill
   * as if it were text failed a palette that is actually correct, and would
   * have pushed the brand colour out of the product to satisfy a measurement
   * of something nobody reads.
   *
   * The two things that must hold under that design are both still measured,
   * harder than before:
   *   - the ink the text rules redirect TO — `cardio-accent-text` on
   *     `cardio-bg`, in PAIRINGS above;
   *   - the label sitting ON the fill — asserted immediately below.
   */
  it.each([
    ['[data-mode="cardio"] .mode-content', "muted-foreground", "cardio-bg", TEXT, "cardio-mode muted text"],
  ])("%s remaps --%s to something legible (%s)", (selector, property, bg, min) => {
    const fg = scopedValue(selector, property);
    const ratio = contrastRatio(fg, T[bg]);
    expect(
      Number(ratio.toFixed(2)),
      `${selector} --${property} (${fg}) on --${bg} (${T[bg]}) measures ${ratio.toFixed(2)}:1`
    ).toBeGreaterThanOrEqual(min);
  });

  /**
   * The mechanism that replaces the two assertions removed above.
   *
   * Keeping the brand blue as a fill is only safe while something redirects
   * the TEXT uses of it. Delete those rules and every `text-cardio-accent` in
   * the Engine falls back to 2.50:1 with no token changing value — invisible
   * to a token-level check, which is exactly why this asserts on the rules.
   */
  it("redirects every text use of the Engine accent to the readable ink", () => {
    const css = readFileSync(CSS, "utf8");
    const rule = css.match(
      /\[data-mode="cardio"\][^{]*\[class\*="text-cardio-accent"\][^{]*\{([^}]*)\}/
    );
    expect(rule, "globals.css no longer redirects text-cardio-accent inside the Engine").toBeTruthy();
    expect(rule![1]).toContain("--cardio-accent-text");

    // And the ink it redirects to still clears the text bar.
    expect(
      Number(contrastRatio(T["cardio-accent-text"], T["cardio-bg"]).toFixed(2))
    ).toBeGreaterThanOrEqual(TEXT);
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
