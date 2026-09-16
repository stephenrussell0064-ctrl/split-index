import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Every page OUTSIDE the (app) route group handles the top safe area itself,
 * because AppShell — which does it for everything inside — never runs for them.
 *
 * Found the expensive way. App Review rejected build 1.0 (7) on an iPad Air,
 * and on that device the sign-in screen drew its brand mark underneath the
 * system clock.
 *
 * The important part is WHY a bare env() inset is not enough, which was
 * measured rather than assumed. A build was pointed at a local page that prints
 * its own viewport, installed on an iPad Air simulator, and reported:
 *
 *     innerWidth 375   innerHeight 667   DPR 2
 *     env(safe-area-inset-top)    0px
 *     env(safe-area-inset-bottom) 0px
 *
 * The app is iPhone-only (TARGETED_DEVICE_FAMILY = 1), so iPad runs it in
 * compatibility mode. There the inset reports ZERO while iPadOS still paints
 * its status bar across the full width, over the letterboxed window — so
 * `pt-[env(safe-area-inset-top)]` expands to `padding-top: 0` and protects
 * nothing. Every such page needs `max(<floor>, env(...))`.
 *
 * That 375x667 viewport is the other half of it: the app gets an iPhone-SE
 * sized window, far shorter than the 844pt phones these screens were built on.
 * The auth cards are vertically centred, and on a tall phone there was enough
 * slack to clear the notch by accident. At 667 there is none.
 *
 * The directory is walked rather than listed, so a NEW public page cannot be
 * added without either handling the inset or failing here.
 */

const APP = resolve(__dirname, ".");
const SRC = resolve(APP, "..");

/** Strip comments so the prose explaining the rule cannot satisfy the rule. */
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

function publicPages(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith("(") || entry === "api" || entry.startsWith("_")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) publicPages(full, acc);
    else if (entry === "page.tsx") acc.push(full);
  }
  return acc;
}

/**
 * A page satisfies the rule either itself or through a component it renders —
 * `/` is three lines that return <LandingPage />, and the header lives there.
 * One level deep is enough for every page here and keeps this honest: it reads
 * the component rather than assuming the delegation is safe.
 */
function sourceWithLocalImports(file: string): string {
  const own = readFileSync(file, "utf8");
  const imports = [...own.matchAll(/from "@\/([^"]+)"/g)].map((m) => m[1]);
  const resolved = imports
    .map((rel) => [".tsx", ".ts"].map((ext) => resolve(SRC, rel + ext)).find(existsSync))
    .filter((p): p is string => Boolean(p))
    .map((p) => readFileSync(p, "utf8"));
  return code([own, ...resolved].join("\n"));
}

const PAGES = publicPages(APP).map((f) => f.slice(APP.length + 1));

describe("the sweep finds what it is meant to", () => {
  it("includes the sign-in screen, which is the one that was rejected", () => {
    expect(PAGES).toContain("login/page.tsx");
  });

  it("includes the landing page, which delegates its header to a component", () => {
    expect(PAGES).toContain("page.tsx");
  });

  it("finds more than a handful", () => {
    expect(PAGES.length).toBeGreaterThan(5);
  });
});

describe("every public page pads for the top safe area", () => {
  it.each(PAGES)("%s", (file) => {
    expect(sourceWithLocalImports(join(APP, file))).toMatch(/safe-area-inset-top/);
  });
});

describe("no public page relies on a bare env() inset", () => {
  // Measured at 0 in iPad compatibility mode. A bare env() here is the exact
  // shape of the bug that reached App Review.
  it.each(PAGES)("%s uses max() with a floor", (file) => {
    const src = sourceWithLocalImports(join(APP, file));
    const bare = src.match(/pt-\[env\(safe-area-inset-top\)\]/g) ?? [];
    expect(bare, `bare env() inset in ${file} — needs max(<floor>, env(...))`).toHaveLength(0);
  });
});

describe("the centred auth screens carry the larger floor", () => {
  // These have no header to hold content down, and at 667pt tall the card is
  // already close to filling the window, so they get 3rem rather than 1rem.
  const CENTRED = [
    "login/page.tsx",
    "signup/page.tsx",
    "forgot-password/page.tsx",
    "reset-password/page.tsx",
    "email-confirmed/page.tsx",
  ];

  it.each(CENTRED)("%s", (file) => {
    expect(PAGES, `${file} not found — did the route move?`).toContain(file);
    const src = code(readFileSync(join(APP, file), "utf8"));
    expect(src).toContain("pt-[max(3rem,env(safe-area-inset-top))]");
    expect(src).toContain("env(safe-area-inset-bottom)");
  });
});
