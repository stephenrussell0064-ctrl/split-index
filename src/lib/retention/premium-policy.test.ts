import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";
import {
  hasPaidAccess,
  hasShowcaseAccess,
  hasSoftTrialAccess,
  isPremiumUser,
} from "./trial";
import { FREE_TRIAL_DAYS } from "@/lib/stripe/config";

/**
 * N8 — the two premium questions, and the fact that they are two.
 *
 * The finding read the coexistence of `isPremiumUser` and `hasSoftTrialAccess`
 * as accidental. It is not: `trial.ts` says the soft trial is for surfaces
 * where showing the premium experience up front is the point, and is "not a
 * substitute for real entitlement checks on paid-feature gates". Measured, 2 of
 * 16 sites fold it in and 14 do not, which is the documented split rather than
 * drift.
 *
 * So these functions must NOT agree with each other. A test that found them
 * equivalent would mean the distinction had been collapsed — which is the one
 * change here that would actually cost money.
 */

// No trailing separator, so `slice(ROOT.length + 1)` trims exactly the prefix.
const ROOT = fileURLToPath(new URL("../../..", import.meta.url)).replace(/\/$/, "");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(full) && !/\.test\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const freeToday = {
  subscription_tier: "free" as const,
  subscription_status: null,
  created_at: daysAgo(0),
};
const freeLapsed = { ...freeToday, created_at: daysAgo(FREE_TRIAL_DAYS + 1) };
const paid = {
  subscription_tier: "premium" as const,
  subscription_status: "active" as const,
  created_at: daysAgo(400),
};

describe("the two questions give different answers, which is the point", () => {
  /**
   * THE ASSERTION THAT MATTERS. If these two ever agree for a brand-new free
   * athlete, either the trial has been taken away from the dashboard it was
   * built for, or every paid gate has been opened to every new signup.
   */
  it("differ for a new free athlete inside the trial window", () => {
    expect(hasPaidAccess(freeToday)).toBe(false);
    expect(hasShowcaseAccess(freeToday)).toBe(true);
  });

  it("agree once the trial has lapsed", () => {
    expect(hasPaidAccess(freeLapsed)).toBe(false);
    expect(hasShowcaseAccess(freeLapsed)).toBe(false);
  });

  it("agree for somebody who has actually paid", () => {
    expect(hasPaidAccess(paid)).toBe(true);
    expect(hasShowcaseAccess(paid)).toBe(true);
  });

  it("both refuse a cancelled subscription", () => {
    const cancelled = {
      subscription_tier: "free" as const,
      subscription_status: "canceled" as const,
      created_at: daysAgo(0),
    };
    // Cancelled inside the window is the case the soft trial must not rescue:
    // somebody who paid and stopped is not a new athlete being shown around.
    expect(hasPaidAccess(cancelled)).toBe(false);
    expect(hasShowcaseAccess(cancelled)).toBe(false);
  });
});

describe("neither changes the answer the call sites already had", () => {
  /**
   * The migration must be behaviour-preserving, so each function is checked
   * against the expression it replaces rather than against my belief about it.
   */
  const subjects = [freeToday, freeLapsed, paid];

  it("hasPaidAccess equals the bare isPremiumUser call", () => {
    for (const s of subjects) {
      expect(hasPaidAccess(s), JSON.stringify(s)).toBe(
        isPremiumUser(s.subscription_tier, s.subscription_status)
      );
    }
  });

  it("hasShowcaseAccess equals the two-clause expression", () => {
    for (const s of subjects) {
      expect(hasShowcaseAccess(s), JSON.stringify(s)).toBe(
        isPremiumUser(s.subscription_tier, s.subscription_status) ||
          hasSoftTrialAccess(s.created_at, s.subscription_tier, s.subscription_status)
      );
    }
  });
});

describe("no call site composes the expression by hand any more", () => {
  /**
   * The regression this prevents is the one N8 actually described: a new page
   * writing `isPremiumUser(...) || hasSoftTrialAccess(...)` inline, or omitting
   * the second clause, with nothing at the call site saying which was meant.
   *
   * Three modules may still use the primitives — `trial.ts` defines them,
   * `entitlements.ts` is the canonical resolver that answers both questions at
   * once, and `features.ts` maps the paid tier onto the feature table. An
   * allowlist rather than a pattern, so a fourth is a decision.
   */
  const MAY_USE_PRIMITIVES = [
    "src/lib/retention/trial.ts",
    "src/lib/premium/entitlements.ts",
    "src/lib/premium/features.ts",
  ];

  it("keeps the primitives to the three modules that define the policy", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(ROOT, "src"))) {
      const rel = file.slice(ROOT.length + 1);
      if (MAY_USE_PRIMITIVES.includes(rel)) continue;
      const code = stripComments(readFileSync(file, "utf8"));
      if (/\bisPremiumUser\(|\bhasSoftTrialAccess\(/.test(code)) offenders.push(rel);
    }
    expect(
      offenders,
      "these compose the premium question by hand, so which one they are asking " +
        "can only be inferred from whether somebody remembered a second clause:\n  " +
        offenders.join("\n  ")
    ).toEqual([]);
  });

  it("finds files to scan", () => {
    expect(sourceFiles(join(ROOT, "src")).length).toBeGreaterThan(100);
  });
});
