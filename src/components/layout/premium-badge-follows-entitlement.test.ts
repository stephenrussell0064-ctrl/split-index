import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/*
 * The header must notice when the athlete becomes premium.
 *
 * It read the profile once, in an effect with an empty dependency array, and
 * chose between the Premium badge and the Upgrade link from that single read.
 * Buying premium does not remount it — the confirmation renders in place on
 * the same screen — so the athlete finished paying and went on looking at a
 * button inviting them to upgrade. `router.refresh()` did not help: the top
 * bar is a client component and refresh re-renders server ones.
 *
 * Source assertions rather than a render test: there is no DOM environment in
 * this suite, and the thing worth protecting is the wiring, not the markup.
 */

const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("the premium badge follows the entitlement", () => {
  const topBar = read("src/components/layout/app-top-bar.tsx");

  it("subscribes to entitlement changes", () => {
    expect(topBar).toMatch(/subscribeToEntitlementChanges/);
  });

  it("does not read the profile only once", () => {
    // The load effect must depend on something that can change. An empty
    // dependency array is the exact defect this file exists to prevent.
    const loadEffect = topBar.slice(topBar.indexOf("async function load()"));
    const deps = loadEffect.match(/\}, \[([^\]]*)\]\);/);
    expect(deps, "could not find the load effect's dependency array").not.toBeNull();
    expect(deps![1].trim()).not.toBe("");
  });

  it("is told by the settle helper, so purchase and restore both count", () => {
    // Announcing from inside waitForServerEntitlement rather than at one call
    // site means every path that confirms an entitlement updates the header.
    const settle = read("src/lib/native/entitlement-settle.ts");
    expect(settle).toMatch(/notifyEntitlementChanged\(\)/);
    // It must fire on the settled branch, not unconditionally on timeout too.
    const settledBranch = settle.slice(settle.indexOf('=== "premium"'));
    expect(settledBranch.slice(0, 400)).toMatch(/notifyEntitlementChanged/);
  });
});

describe("the legal pages can be left", () => {
  /*
   * Terms and Privacy are linked directly under the purchase button because
   * Guideline 3.1.2 requires it. Their only way out was a hard link to "/",
   * which drops a signed-in athlete mid-purchase onto the marketing page.
   */
  for (const page of ["src/app/terms/page.tsx", "src/app/privacy/page.tsx"]) {
    it(`${page} offers a back control that returns where the reader came from`, () => {
      const src = read(page);
      expect(src).toMatch(/<LegalBackLink \/>/);
      expect(src).not.toMatch(/Back to home/);
    });
  }

  it("the back control uses the app's own history-aware helper", () => {
    const back = read("src/components/legal/legal-back-link.tsx");
    expect(back).toMatch(/navigateBack/);
  });
});
