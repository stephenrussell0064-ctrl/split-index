import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The first-run screen, pinned where it can actually break.
 *
 * Source assertions, for the reason the nav and no-sideways-scroll suites give:
 * there is no DOM in this suite, and what matters here is not what the markup
 * computes to but WHICH SCREEN a brand-new account is sent to and whether the
 * two ways in still go somewhere. The specific regression this guards is the
 * one the component exists to fix — a new account falling back to the full
 * dashboard and getting a stack of nine empty cards — and that is a one-line
 * change in page.tsx that nothing else would notice.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

const GUIDE = "src/components/dashboard/first-session-guide.tsx";
const PAGE = "src/app/(app)/dashboard/page.tsx";

describe("the first session has somewhere to be logged", () => {
  const guide = read(GUIDE);

  /*
   * Both halves of the product, and the live option. A guide that offers only
   * one of the two is worse than the empty dashboard it replaced: it tells a
   * new athlete the app is for lifting, or for running, and not for both.
   */
  for (const href of ["/gym/log", "/cardio/log", "/cardio/gps-run?sport=running"]) {
    it(`links to ${href}`, () => {
      expect(guide).toContain(`"${href}"`);
    });

    it(`${href} has a page behind it`, () => {
      // Query strings are not part of the route.
      const route = href.split("?")[0];
      expect(existsSync(join(process.cwd(), "src/app/(app)", route, "page.tsx"))).toBe(true);
    });
  }

  it("builds its map from the shared nav list rather than its own copy", () => {
    // Otherwise a renamed tab leaves this screen describing one that is gone —
    // which is the exact drift app-nav.ts exists to prevent.
    expect(guide).toMatch(/from "@\/lib\/navigation\/app-nav"/);
    expect(guide).toMatch(/\bPRIMARY_NAV\b/);
    expect(guide).toMatch(/\bLOG_WORKOUT\b/);
  });

  it("stays a server component, so there is no dismissal flag to strand anyone", () => {
    // "Have they logged anything" is a server fact. A stored dismissal flag
    // could hide this screen while the dashboard behind it was still empty.
    //
    // Code, not prose: the component's own comment explains that it keeps no
    // such flag, so a bare search for the word matches the explanation.
    const code = guide.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/^"use client"/m);
    expect(code).not.toMatch(/window\.|localStorage|use(State|Effect|SyncExternalStore)\b/);
  });
});

describe("a brand-new account gets the guide and nothing else", () => {
  const page = read(PAGE);

  it("renders FirstSessionGuide", () => {
    expect(page).toMatch(/from "@\/components\/dashboard\/first-session-guide"/);
    expect(page).toMatch(/<FirstSessionGuide\b/);
  });

  it("returns early on isFirstRun rather than rendering the dashboard empty", () => {
    expect(page).toMatch(/const isFirstRun = !hasActivities && !hasIndexHistory;/);
    expect(page).toMatch(/if \(isFirstRun\) \{\s*return \(/);
  });

  it("keeps the side-effecting work that runs before that return", () => {
    // Both sit above the early return: the notification seeding is specifically
    // interested in new accounts, and the sync is what writes the iOS widget.
    const beforeReturn = page.slice(0, page.indexOf("if (isFirstRun)"));
    expect(beforeReturn).toMatch(/await seedRetentionNotifications\(/);
    expect(page).toMatch(/<RacePredictionsSync\b/);
  });

  it("no longer imports the two cards it replaces", () => {
    // The names still appear in page.tsx, in the comments recording why they
    // went, so this has to look at the import statements and not the file.
    const imports = page.split("\n").filter((l) => l.startsWith("import "));
    expect(imports.join("\n")).not.toMatch(/EmptyDashboardHero|GettingAroundCard/);
  });

  it("has actually deleted them, so nothing can import them again", () => {
    for (const rel of [
      "src/components/dashboard/getting-around-card.tsx",
      "src/components/retention/empty-dashboard-hero.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), rel)), rel).toBe(false);
    }
  });
});
