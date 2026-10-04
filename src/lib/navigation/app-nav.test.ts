import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NONCE_PATH_PREFIXES } from "@/lib/security/csp";
import {
  ACCOUNT_NAV,
  APP_NAV,
  COMMUNITY_NAV,
  LOG_WORKOUT,
  PRIMARY_NAV,
  PROGRESS_NAV,
  TRAIN_ZONES,
  navItemForPath,
  navItemMatches,
} from "./app-nav";

/**
 * The navigation list is the one place the app describes itself, so the
 * things that would quietly make it wrong are pinned here.
 *
 * Source assertions for the last group, for the usual reason: there is no DOM
 * environment in this suite, and what matters is that the shell, the hub and
 * the guide still render from the shared list rather than from a copy that
 * can drift.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("every destination is real and correctly protected", () => {
  for (const item of [...APP_NAV, ...TRAIN_ZONES, LOG_WORKOUT]) {
    it(`${item.href} has a page behind it`, () => {
      expect(existsSync(join(process.cwd(), "src/app/(app)", item.href, "page.tsx"))).toBe(true);
    });

    it(`${item.href} is on the strict-CSP list`, () => {
      // Every authenticated page must be served under the nonce policy.
      // A new route added to the menu but not to csp.ts would ship with the
      // weaker header — see src/lib/security/csp.ts.
      const covered = NONCE_PATH_PREFIXES.some(
        (prefix) => item.href === prefix || item.href.startsWith(`${prefix}/`)
      );
      expect(covered).toBe(true);
    });
  }
});

describe("every destination says what it is", () => {
  for (const item of [...APP_NAV, ...TRAIN_ZONES]) {
    it(`${item.href} is labelled in plain words, with a full sentence underneath`, () => {
      // The label is what you read first. The product's own names are allowed,
      // but only as the second thing — under a word that says what it is.
      expect(item.label).not.toBe(item.brandName);
      expect(item.label).not.toMatch(/^The (Lab|Engine)$/);
      expect(item.description.length).toBeGreaterThanOrEqual(30);
      expect(item.description.length).toBeLessThanOrEqual(120);
      expect(item.description).toMatch(/\.$/);
    });
  }

  it("has four primary tabs, each with a label short enough for a phone's tab bar", () => {
    // Home · Train · (+) · Plan · Progress. The + is LOG_WORKOUT, not a tab.
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual([
      "/dashboard",
      "/train",
      "/hybrid-plan",
      "/progress",
    ]);
    for (const item of PRIMARY_NAV) {
      expect(item.shortLabel, item.href).toBeDefined();
      expect(item.shortLabel!.length).toBeLessThanOrEqual(9);
    }
  });

  it("puts every remaining destination in exactly one group", () => {
    const grouped = [...PRIMARY_NAV, ...PROGRESS_NAV, ...COMMUNITY_NAV, ...ACCOUNT_NAV]
      .map((i) => i.href)
      .sort();
    expect(grouped).toEqual(APP_NAV.map((i) => i.href).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it("the Train tab is current for both of its halves, and Home only for itself", () => {
    const train = PRIMARY_NAV.find((i) => i.href === "/train")!;
    const home = PRIMARY_NAV.find((i) => i.href === "/dashboard")!;
    expect(navItemMatches(train, "/gym")).toBe(true);
    expect(navItemMatches(train, "/cardio/gps-run")).toBe(true);
    expect(navItemMatches(train, "/hybrid-plan")).toBe(false);
    expect(navItemMatches(home, "/dashboard")).toBe(true);
    expect(navItemMatches(home, "/gym")).toBe(false);
    expect(navItemForPath("/gym")?.href).toBe("/gym");
    expect(navItemForPath("/gym/log")?.href).toBe("/train");
    expect(navItemForPath("/analytics")?.href).toBe("/analytics");
  });
});

describe("the shell, the hub and the guide render from the shared list", () => {
  it("the app shell imports its navigation rather than declaring its own", () => {
    const shell = read("src/components/layout/app-shell.tsx");
    expect(shell).toMatch(/from "@\/lib\/navigation\/app-nav"/);
    expect(shell).not.toMatch(/label:\s*"The (Lab|Engine)"/);
    // The More sheet is gone: everything it held has a tab or a page now.
    expect(shell).not.toMatch(/MoreNavSheet|more-nav-sheet/);
    // …and the Progress tab stands in for it as the current tab on every page
    // the hub leads to, or nine screens have no current tab at all.
    expect(shell).toMatch(
      /item\.href === "\/progress" &&\s*\[\.\.\.PROGRESS_NAV, \.\.\.COMMUNITY_NAV, \.\.\.ACCOUNT_NAV\]\.some/
    );
    // Tab memory is seeded from the path the shell mounted on; the
    // render-time update alone never records a cold start.
    expect(shell).toMatch(/useState<Record<string, string>>\(\(\) =>/);
  });

  it("the guide lists every group, so a new destination cannot be left out of it", () => {
    const guide = read("src/app/(app)/help/page.tsx");
    for (const name of [
      "PRIMARY_NAV",
      "TRAIN_ZONES",
      "PROGRESS_NAV",
      "COMMUNITY_NAV",
      "ACCOUNT_NAV",
      "LOG_WORKOUT",
    ]) {
      expect(guide).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });

  it("the account menu lists the account group rather than its own copy", () => {
    const menu = read("src/components/layout/account-menu.tsx");
    expect(menu).toMatch(/\bACCOUNT_NAV\b/);
  });
});
