import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";

/*
 * B1 — the Settings upgrade button, asserted on the file the button is
 * actually in.
 *
 * The registry checked B1 by greping `settings/page.tsx` for the ABSENCE of
 * `startStripeCheckout`. That check was green, and it was green for the wrong
 * reason: `page.tsx` is now a 28-line server shell that does `await
 * connection()` and renders `<SettingsClient />`. It contains no button, no
 * checkout, and no branch. The upgrade button moved to `settings-client.tsx`
 * during the CSP/prerender split and the check stayed pointed at the husk, so
 * it would have gone on passing with `startStripeCheckout()` restored in the
 * button one directory over.
 *
 * Worse in the other direction: `settings-client.tsx` legitimately CONTAINS
 * the string `startStripeCheckout`, in the comment warning the next person not
 * to reintroduce it. Repointing the same grep at the right file would have
 * made it fail permanently, punishing the documentation for being accurate.
 * Hence `stripComments`, per the note in `source-scan.ts` — this is the sixth
 * scanner in this repo to hit that.
 *
 * `scripts/check-checkout-single-path.mjs` already proves that nothing outside
 * `use-checkout.ts` IMPORTS a payment entry point, app-wide. What is left,
 * and what this file covers, is the part specific to B1: that the Settings
 * screen still HAS an upgrade button, that it goes through `useCheckout`, and
 * that it is dead until the platform is known. A button that stopped calling
 * anything would satisfy every absence check ever written about this screen.
 */

const CLIENT = new URL("./settings-client.tsx", import.meta.url);
const source = stripComments(readFileSync(CLIENT, "utf8"));

describe("B1 — the Settings upgrade button routes through the one decision point", () => {
  it("takes its checkout from useCheckout", () => {
    expect(source).toMatch(/import\s*\{[^}]*\buseCheckout\b[^}]*\}\s*from\s*"@\/lib\/native\/use-checkout"/);
    expect(source).toMatch(/=\s*useCheckout\(\)/);
  });

  it("does not import a payment entry point of its own", () => {
    // The exact shape of the original bug: this screen reaching Stripe
    // directly while SkuPicker had already been migrated to RevenueCat.
    for (const symbol of ["startStripeCheckout", "purchaseNativeSku", "presentProPaywall"]) {
      expect(source, `${symbol} is imported directly`).not.toMatch(
        new RegExp(`import\\s*\\{[^}]*\\b${symbol}\\b[^}]*\\}`, "s"),
      );
    }
  });

  it("has an upgrade button, and its handler calls checkout()", () => {
    // Both halves matter. A handler nothing calls, and a button wired to
    // nothing, each read as "no Stripe here" to an absence check.
    expect(source).toMatch(/onClick=\{handleCheckout\}/);
    expect(source).toMatch(/const handleCheckout\s*=\s*async\s*\(\)\s*=>\s*\{[\s\S]*?await checkout\(/);
  });

  it("is disabled until the platform is known", () => {
    /*
     * B2's window, in B1's screen. `useCheckout` refuses to act while the
     * platform is "checking", so a tap in that window is not a 3.1.1
     * violation — it is a button that silently does nothing, which is its own
     * way to lose a subscriber. The disabled attribute is what makes the
     * refusal visible.
     */
    expect(source).toMatch(/disabled=\{checkoutResolving\}/);
    expect(source).toMatch(/resolving:\s*checkoutResolving/);
  });

  it("acts on every outcome useCheckout can return", () => {
    /*
     * `not-ready` is the one that gets dropped. Left out of the switch it is
     * a silent no-op that also leaves `loading` stuck true, because the early
     * `return` cases are the ones that skip the reset — so the button spins
     * forever after a tap during the checking window.
     */
    for (const outcome of ["redirecting", "entitled", "error", "not-ready", "cancelled"]) {
      expect(source, `the ${outcome} outcome is unhandled`).toContain(`case "${outcome}":`);
    }
  });
});
