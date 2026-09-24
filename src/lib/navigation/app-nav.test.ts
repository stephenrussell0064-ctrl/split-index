import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NONCE_PATH_PREFIXES } from "@/lib/security/csp";
import { ACCOUNT_NAV, APP_NAV, INSIGHTS_NAV, LOG_WORKOUT, PRIMARY_NAV } from "./app-nav";

/**
 * The navigation list is the one place the app describes itself, so the
 * things that would quietly make it wrong are pinned here.
 *
 * Source assertions for the last two, for the usual reason: there is no DOM
 * environment in this suite, and what matters is that the shell and the guide
 * still render from the shared list rather than from a copy that can drift.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("every destination is real and correctly protected", () => {
  for (const item of [...APP_NAV, LOG_WORKOUT]) {
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
  for (const item of APP_NAV) {
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

  it("has three primary tabs, each with a label short enough for a phone's tab bar", () => {
    expect(PRIMARY_NAV).toHaveLength(3);
    for (const item of PRIMARY_NAV) {
      expect(item.shortLabel, item.href).toBeDefined();
      expect(item.shortLabel!.length).toBeLessThanOrEqual(9);
    }
  });

  it("puts every remaining destination in exactly one menu group", () => {
    const grouped = [...PRIMARY_NAV, ...INSIGHTS_NAV, ...ACCOUNT_NAV].map((i) => i.href).sort();
    expect(grouped).toEqual(APP_NAV.map((i) => i.href).sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });
});

describe("the shell and the guide render from the shared list", () => {
  it("the app shell imports its navigation rather than declaring its own", () => {
    const shell = read("src/components/layout/app-shell.tsx");
    expect(shell).toMatch(/from "@\/lib\/navigation\/app-nav"/);
    expect(shell).not.toMatch(/label:\s*"The (Lab|Engine)"/);
  });

  it("the guide lists every group, so a new destination cannot be left out of it", () => {
    const guide = read("src/app/(app)/help/page.tsx");
    for (const name of ["PRIMARY_NAV", "INSIGHTS_NAV", "ACCOUNT_NAV", "LOG_WORKOUT"]) {
      expect(guide).toMatch(new RegExp(`\\b${name}\\b`));
    }
  });
});
