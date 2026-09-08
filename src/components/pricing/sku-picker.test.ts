import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";

/*
 * B2 — the SkuPicker must not be live before the platform is known.
 *
 * The bug this covers: the picker held its own `isNative` boolean, which starts
 * false. For the frames before the platform resolved, an iOS user pressing the
 * button went to Stripe — a Guideline 3.1.1 violation reachable by being quick,
 * and one that would not reproduce for anyone testing on a fast simulator.
 *
 * The registry checked it with two literal greps:
 *
 *     grep -q "disabled={resolving}" src/components/pricing/sku-picker.tsx
 *     grep -q 'platform === "checking"' src/lib/native/use-checkout.ts
 *
 * Both are exact-string matches on formatting. Renaming `resolving` to
 * `isResolving`, or Prettier deciding on `disabled={ resolving }`, turns the
 * milestone red while the code is correct — and a check that cries wolf gets
 * deleted. In the other direction `disabled={resolving && false}` contains the
 * literal and passes while the button is live throughout.
 *
 * So the properties are asserted here instead, on the parsed source with
 * comments stripped. `scripts/check-checkout-single-path.mjs` separately proves
 * nothing outside use-checkout.ts imports a payment entry point at all; what is
 * left, and what this file covers, is the B2-specific part — that this picker
 * has no platform state of its own and is dead until the shared one resolves.
 */

const PICKER = new URL("./sku-picker.tsx", import.meta.url);
const source = stripComments(readFileSync(PICKER, "utf8"));

describe("B2 — the SkuPicker is dead until the platform is known", () => {
  it("takes its platform and checkout from useCheckout", () => {
    expect(source).toMatch(
      /import\s*\{[^}]*\buseCheckout\b[^}]*\}\s*from\s*"@\/lib\/native\/use-checkout"/,
    );
    expect(source).toMatch(/=\s*useCheckout\(\)/);
  });

  it("destructures `resolving` from the hook rather than deriving it", () => {
    // The value has to come from the shared decision point. A locally computed
    // one is the original bug wearing the new name.
    expect(source).toMatch(/\{[^}]*\bresolving\b[^}]*\}\s*=\s*useCheckout\(\)/);
  });

  it("disables the purchase control on that value", () => {
    /*
     * Tolerant of whitespace, and NOT tolerant of the value being weakened.
     * `disabled={resolving}` and `disabled={ resolving }` both pass;
     * `disabled={resolving && false}` and `disabled={false}` do not, because
     * the braces must contain the identifier and nothing else.
     */
    expect(source).toMatch(/disabled=\{\s*resolving\s*\}/);
  });

  it("keeps the button in its loading state while resolving, not merely disabled", () => {
    // Disabled-and-silent reads as broken. The original fix showed the spinner
    // for the same window, and a regression that dropped it would be a UX
    // report nobody would connect back to 3.1.1.
    expect(source).toMatch(/loading=\{[^}]*\bresolving\b[^}]*\}/);
  });

  it("holds NO platform boolean of its own — the actual B2 defect", () => {
    /*
     * The thing that made this shippable: a component-local PLATFORM flag
     * defaulting to false. None of these would be caught by a grep for
     * `disabled={resolving}`, which would still sit there intact one line away.
     *
     * Scoped to platform-shaped state on purpose. This first banned any
     * `useState(false)` and failed immediately on `const [loading, setLoading]
     * = useState(false)` — the purchase spinner, which is fine and which every
     * button of this kind has. Banning a whole React idiom to catch one misuse
     * of it is the over-broad pattern this repo keeps getting bitten by, and it
     * would have been a permanently red check for correct code.
     */
    for (const reintroduced of [
      /\buseState[^;]{0,40}\b(isNative|native|platform|isIos|isIOS)\b/i,
      /\b(const|let)\s*\[\s*(isNative|native|platform|isIos|isIOS)\b/i,
      /\bCapacitor\.isNativePlatform\b/,
    ]) {
      expect(source).not.toMatch(reintroduced);
    }
  });

  it("does not name a payment entry point directly", () => {
    // Belt and braces with the app-wide guard, at the one component that got
    // this wrong before.
    for (const entry of ["startStripeCheckout", "purchaseNativeSku", "presentProPaywall"]) {
      expect(source).not.toContain(entry);
    }
  });
});
