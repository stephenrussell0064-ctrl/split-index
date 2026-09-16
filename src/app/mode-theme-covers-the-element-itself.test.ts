import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The cardio mode theme repaints shared surfaces for a light background. Its
 * rules were written as DESCENDANT selectors — `.mode-content .glass-strong` —
 * which is right for every card inside the content column and silently wrong
 * for the one element that is both at once.
 *
 * AppShell's sidebar is `mode-content … glass-strong` on a single element. With
 * only the descendant form, `mode-content` remapped its text tokens to the dark
 * cardio text while `glass-strong` kept painting the dark panel behind them:
 * dark on dark, and less readable than leaving the sidebar unthemed. Caught on
 * an iPad, where the sidebar sits beside the light cardio content and the iOS
 * status bar — one style for the whole screen — has to be legible over both.
 *
 * This is a failure mode with no visible symptom in the markup and no type
 * error: the class is present, the rule exists, and they do not meet. So it is
 * pinned here rather than left to the next person to re-discover.
 */

const CSS = readFileSync(resolve(__dirname, "globals.css"), "utf8");
const SHELL = readFileSync(
  resolve(__dirname, "../components/layout/app-shell.tsx"),
  "utf8",
);

/** className strings in the shell that carry `mode-content` AND a themed class. */
function selfThemedSurfaces(): string[] {
  return (SHELL.match(/className=(?:"[^"]*"|\{[^}]*\})/g) ?? []).filter(
    (c) => c.includes("mode-content") && c.includes("glass-strong"),
  );
}

describe("the shell really does put both classes on one element", () => {
  it("finds the sidebar carrying mode-content and glass-strong together", () => {
    // If this ever fails the guard below is moot — but so is the bug, so the
    // failure should prompt deleting this file rather than editing the CSS.
    expect(selfThemedSurfaces().length).toBeGreaterThan(0);
  });
});

describe("cardio theming reaches the element it is written on", () => {
  it("themes glass-strong compounded with mode-content, not only nested", () => {
    expect(CSS).toContain('[data-mode="cardio"] .mode-content.glass-strong');
  });

  it("still themes nested glass-strong, which is every card in the column", () => {
    expect(CSS).toContain('[data-mode="cardio"] .mode-content .glass-strong');
  });

  it("themes a white border compounded with mode-content", () => {
    expect(CSS).toContain('[data-mode="cardio"] .mode-content[class*="border-white"]');
  });

  it("still themes nested white borders", () => {
    expect(CSS).toContain('[data-mode="cardio"] .mode-content [class*="border-white"]');
  });
});
