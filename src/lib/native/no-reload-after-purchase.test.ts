import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Guards the worst screen this app can show.
 *
 * WHAT HAPPENED. Every success path in the native purchase flow ended in
 * `window.location.reload()`. In sandbox testing an athlete completed a real
 * purchase and landed on public/offline.html — "No connection right now" —
 * because the reload fired while iOS was still restoring the app after
 * dismissing the StoreKit sheet, the WebView load failed, and Capacitor did
 * exactly what it is configured to do and fell back to `errorPath`.
 *
 * There is a second, quieter fault in the same line. Server-gated premium
 * surfaces read `profiles.subscription_tier`, which is written by the
 * RevenueCat webhook — asynchronously, after the purchase returns. A reload
 * raced that webhook and usually won, so even when the load succeeded the
 * athlete was shown the paywall they had just paid to leave.
 *
 * WHY A TEST OVER FILE CONTENTS. Neither failure is visible to the type
 * checker, and neither can be reproduced in jsdom: they need a real WebView, a
 * real StoreKit sheet and a real webhook. The thing that is reliably checkable
 * is that the call is not there. `router.refresh()` re-renders server
 * components in place, so the WebView never navigates and there is no load to
 * fail.
 *
 * If a future change genuinely needs a hard reload on one of these paths, this
 * test failing is the prompt to explain why in the diff rather than to delete
 * the line quietly.
 */

const SRC = resolve(__dirname, "../..");

const PURCHASE_PATH_FILES = [
  "components/pricing/sku-picker.tsx",
  "components/layout/native-billing-bootstrap.tsx",
  "components/pricing/manage-subscription.tsx",
];

/** Strips comments so prose about the old behaviour does not trip the check. */
function code(file: string): string {
  const raw = readFileSync(resolve(SRC, file), "utf8");
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("the native purchase paths never hard-reload the WebView", () => {
  it.each(PURCHASE_PATH_FILES)("%s does not call location.reload", (file) => {
    expect(code(file)).not.toMatch(/location\s*\.\s*reload\s*\(/);
  });

  it("sku-picker waits for the server before handing back", () => {
    // The overlay is not decoration: it covers the webhook round trip. Without
    // the wait, tapping through lands on a page the server still thinks is free.
    const src = code("components/pricing/sku-picker.tsx");
    expect(src).toContain("waitForServerEntitlement");
    expect(src).toContain("router.refresh()");
  });

  it("still sends web checkout away to Stripe", () => {
    // location.href is a real navigation to an external checkout, not a reload,
    // and must survive this rule.
    expect(code("components/pricing/sku-picker.tsx")).toContain("window.location.href");
  });
});
