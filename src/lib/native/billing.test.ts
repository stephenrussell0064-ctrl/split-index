import { describe, expect, it, vi, afterEach } from "vitest";
import type { CustomerInfo, PurchasesEntitlementInfo } from "@revenuecat/purchases-capacitor";
import { PRO_ENTITLEMENT_ID, readProEntitlement, resolveApiKey } from "./billing";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveApiKey", () => {
  it("uses the platform key for the platform it is given", () => {
    const env = { ios: "appl_ios", android: "goog_android" };
    expect(resolveApiKey("ios", env)).toEqual({ key: "appl_ios", isTestStore: false });
    expect(resolveApiKey("android", env)).toEqual({ key: "goog_android", isTestStore: false });
  });

  it("has no key to offer on web", () => {
    expect(resolveApiKey("web", { ios: "appl_ios", android: "goog_android" })).toBeNull();
  });

  it("refuses a Test Store key sitting in a production slot", () => {
    // This is the case that would crash every installed app rather than one
    // developer's build: RevenueCat kills release builds configured with a
    // test_ key, and this app serves its JS to TestFlight and the App Store
    // from the same production deployment.
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(resolveApiKey("ios", { ios: "test_kSvzUisIzmHWTEriLckorMWrWWp" })).toBeNull();
    expect(error).toHaveBeenCalledOnce();
  });

  it("uses the Test Store key only when explicitly switched on", () => {
    const env = {
      testStoreKey: "test_kSvzUisIzmHWTEriLckorMWrWWp",
      ios: "appl_ios",
    };

    // Present but not enabled — the real key still wins.
    expect(resolveApiKey("ios", env)).toEqual({ key: "appl_ios", isTestStore: false });

    expect(resolveApiKey("ios", { ...env, testStoreEnabled: "true" })).toEqual({
      key: "test_kSvzUisIzmHWTEriLckorMWrWWp",
      isTestStore: true,
    });
  });

  it("does not treat a truthy-looking string as switched on", () => {
    // "1", "yes" and friends must not enable it — only the exact "true" does,
    // so a half-set variable cannot ship a test key.
    const env = { testStoreEnabled: "1", testStoreKey: "test_abc", ios: "appl_ios" };
    expect(resolveApiKey("ios", env)?.isTestStore).toBe(false);
  });

  it("falls back to nothing rather than a wrong platform's key", () => {
    expect(resolveApiKey("android", { ios: "appl_ios" })).toBeNull();
  });
});

function customerInfoWith(
  active: Record<string, Partial<PurchasesEntitlementInfo>>
): CustomerInfo {
  return { entitlements: { active, all: active } } as unknown as CustomerInfo;
}

describe("readProEntitlement", () => {
  it("reads the split_index_pro entitlement when it is active", () => {
    const info = customerInfoWith({
      [PRO_ENTITLEMENT_ID]: {
        isActive: true,
        willRenew: true,
        periodType: "TRIAL",
        expirationDate: "2026-10-01T00:00:00Z",
        productIdentifier: "co.uk.splitindex.app.annual",
        store: "APP_STORE",
        isSandbox: false,
      },
    });

    expect(readProEntitlement(info)).toEqual({
      active: true,
      willRenew: true,
      periodType: "TRIAL",
      expirationDate: "2026-10-01T00:00:00Z",
      productIdentifier: "co.uk.splitindex.app.annual",
      store: "APP_STORE",
      isSandbox: false,
    });
  });

  it("keeps lifetime access, which has no expiry date at all", () => {
    const info = customerInfoWith({
      [PRO_ENTITLEMENT_ID]: {
        isActive: true,
        willRenew: false,
        periodType: "NORMAL",
        expirationDate: null,
        productIdentifier: "co.uk.splitindex.app.lifetime",
        store: "APP_STORE",
        isSandbox: false,
      },
    });

    const pro = readProEntitlement(info);
    // A null expiry is lifetime, not "expired" — reading it as the latter
    // would revoke access from the people who paid the most.
    expect(pro?.active).toBe(true);
    expect(pro?.expirationDate).toBeNull();
  });

  it("ignores a different entitlement that happens to be active", () => {
    expect(readProEntitlement(customerInfoWith({ some_other_thing: { isActive: true } }))).toBeNull();
  });

  it("returns null for no customer info, rather than throwing into a render", () => {
    expect(readProEntitlement(null)).toBeNull();
  });

  it("returns null when the entitlement exists but is not in the active set", () => {
    // RevenueCat evaluates expiry server-side and only puts live entitlements
    // in `active`. Reading `all` and trusting isActive against the device
    // clock is the mistake this guards.
    const info = {
      entitlements: {
        active: {},
        all: { [PRO_ENTITLEMENT_ID]: { isActive: false } },
      },
    } as unknown as CustomerInfo;

    expect(readProEntitlement(info)).toBeNull();
  });
});
