import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * /terms and /privacy are the two pages an App Review reviewer is guaranteed to
 * open, and four defects were reported against them from a device. All four
 * come from the same place: these pages sit OUTSIDE the (app) route group, so
 * none of AppShell's layout reaches them.
 *
 *  1. The header rendered under the iOS status bar, so the back control could
 *     not be tapped at all.
 *  2. Back went to the previous page, which from the SKU picker is the paywall
 *     the athlete just dismissed — and in a cold WebView, no history at all.
 *  3. The privacy page's footer had no way home; it listed only Terms.
 *  4. The terms page's footer "Home" pointed at "/", which inside the app is
 *     the marketing landing page, i.e. the first sign-in screen.
 *
 * Asserted here rather than left to a manual pass because these are static
 * prose pages nobody re-reads. The next person to notice a regression would be
 * a reviewer.
 *
 * Comments are stripped before every assertion. An earlier guard in this repo
 * went green with its defect deliberately reintroduced, because the string it
 * searched for appeared in the explanatory comment above the code.
 */

const SRC = resolve(__dirname, "../..");

/** Strip block and line comments so prose can never satisfy an assertion. */
function code(path: string): string {
  return readFileSync(resolve(SRC, path), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const BACK = code("components/legal/legal-back-link.tsx");
const HOME = code("components/legal/legal-home-link.tsx");
const SHELL = code("lib/native/use-is-native-shell.ts");
const PAGES = {
  privacy: code("app/privacy/page.tsx"),
  terms: code("app/terms/page.tsx"),
} as const;

describe("inside the app, both ways out lead to Settings", () => {
  it("the header control pushes /settings", () => {
    expect(BACK).toContain('router.push("/settings")');
  });

  it("the footer link points at /settings", () => {
    expect(HOME).toContain('inApp ? "/settings" : "/"');
  });

  it("the header control still falls back to history on the web", () => {
    // navigateBack is another session's deliberate choice for the public site,
    // where a reader arriving from the marketing footer has somewhere real to
    // go back to. Only the in-app branch is new.
    expect(BACK).toContain("navigateBack(router)");
  });

  it("neither control decides from anything but the platform", () => {
    expect(BACK).toContain("useIsNativeShell()");
    expect(HOME).toContain("useIsNativeShell()");
  });
});

describe("the platform check survives hydration", () => {
  it("takes a separate server snapshot", () => {
    // isNativePlatform() is false on the server. Reading it during render would
    // emit one answer server-side and the other on the device, and React would
    // throw the mismatched tree away.
    expect(SHELL).toMatch(
      /useSyncExternalStore\(subscribeToNothing, isNativePlatform, \(\) => false\)/,
    );
  });

  it("subscribes with a stable module-scope reference", () => {
    // An inline arrow is a new reference every render, and useSyncExternalStore
    // re-subscribes whenever that reference changes.
    expect(SHELL).toMatch(/^const subscribeToNothing = \(\) => \(\) => \{\};$/m);
  });
});

describe("the pages clear the iOS safe areas", () => {
  it.each(Object.entries(PAGES))("%s pads its header past the status bar", (_n, src) => {
    expect(src).toContain("pt-[env(safe-area-inset-top)]");
  });

  it.each(Object.entries(PAGES))("%s pads its footer past the home indicator", (_n, src) => {
    expect(src).toContain("env(safe-area-inset-bottom)");
  });
});

describe("every legal page has a way home at the bottom", () => {
  it.each(Object.entries(PAGES))("%s renders one in its footer", (_n, src) => {
    expect(src).toContain("<LegalHomeLink />");
  });

  it.each(Object.entries(PAGES))("%s no longer hard-codes one to '/'", (_n, src) => {
    // BrandMark legitimately keeps href="/" — it is the wordmark, not the way
    // out — so this is scoped to the footer.
    const footer = src.slice(src.indexOf("<footer"));
    expect(footer).not.toMatch(/href="\/"/);
  });
});

describe("the controls are tappable", () => {
  it("the header control meets the 44pt minimum", () => {
    expect(BACK).toContain("min-h-11");
  });

  it("the footer link meets it too", () => {
    expect(HOME).toContain("min-h-11");
  });

  it.each(Object.entries(PAGES))("%s's own footer link does as well", (_n, src) => {
    const footer = src.slice(src.indexOf("<footer"));
    const links = footer.match(/<Link[\s\S]*?>/g) ?? [];
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toContain("min-h-11");
  });
});
