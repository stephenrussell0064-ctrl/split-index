import { describe, expect, it } from "vitest";
import { SKUS } from "./sku-picker";

/*
  On native, the price on each card comes from StoreKit and is denominated in
  the viewer's own storefront currency. The subtitle sits directly beneath it,
  so any currency this file hard-codes is read as describing that price.

  This shipped once: the annual subtitle was `just £2.50/mo`, computed at build
  time from the GBP list price, and rendered underneath whatever StoreKit
  returned. A US reviewer would have seen $34.99/yr above just £2.50/mo.

  It survived every round of device testing because all of it was done on a UK
  device, where sterling under a sterling price looks correct. That is the
  reason for a test rather than a comment: the bug is invisible from the one
  storefront the developers use.
*/

// Symbols and codes for the storefronts an App Store release reaches first.
const CURRENCY = /[£$€¥₹₩]|\b(GBP|USD|EUR|JPY|AUD|CAD|CHF|SEK|NOK|DKK|INR)\b/;

describe("native SKU copy names no currency", () => {
  it("has a nativeSub for every SKU", () => {
    expect(SKUS.length).toBeGreaterThan(0);
    for (const option of SKUS) {
      expect(option.nativeSub, `${option.sku} has no nativeSub`).toBeTruthy();
    }
  });

  it("keeps every nativeSub free of a currency symbol or code", () => {
    const offenders = SKUS.filter((option) => CURRENCY.test(option.nativeSub)).map(
      (option) => `${option.sku}: ${JSON.stringify(option.nativeSub)}`
    );

    expect(
      offenders,
      `These native subtitles name a currency. StoreKit sets the price on ` +
        `native and it is not necessarily GBP, so the subtitle must not imply ` +
        `one:\n${offenders.join("\n")}`
    ).toEqual([]);
  });

  it("still lets the web subtitle quote sterling, which is correct there", () => {
    // Guards against "fixing" this by stripping the web copy too: on the web we
    // set the price ourselves and it is always GBP, so the per-month equivalent
    // is accurate and worth keeping.
    const annual = SKUS.find((option) => option.sku === "annual");
    expect(annual?.sub).toMatch(/£/);
  });
});
