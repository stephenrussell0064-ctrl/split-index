import { readFileSync } from "node:fs";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { stripComments } from "@/lib/testing/source-scan";

/*
 * These tests exist for one reason: an App Store reviewer must never reach
 * Stripe from inside the native app.
 *
 * Both blockers this module closes were invisible to the type checker and to
 * every existing test, because both sides of each one compiled fine and only
 * disagreed at runtime:
 *
 *   B1 — the Settings upgrade button called startStripeCheckout() with no
 *        platform check at all.
 *   B2 — SkuPicker held "is native" as a boolean initialised to false and set
 *        true inside an async .then(), so "not checked yet" and "this is the
 *        web" were the same value and a fast tap took the Stripe branch.
 *
 * The case that matters most below is `platform === "checking"`. It is not a
 * loading state to be tidied away — it is the window B2 lived in.
 */

const isNativePlatform = vi.fn();
const purchaseNativeSku = vi.fn();
const presentProPaywall = vi.fn();
const startStripeCheckout = vi.fn();

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: () => isNativePlatform(),
}));
vi.mock("@/lib/native/billing", () => ({
  fetchNativeOfferings: vi.fn().mockResolvedValue([]),
  purchaseNativeSku: (sku: string) => purchaseNativeSku(sku),
}));
vi.mock("@/lib/native/paywall", () => ({
  presentProPaywall: () => presentProPaywall(),
}));
vi.mock("@/lib/stripe/start-checkout", () => ({
  startStripeCheckout: (sku: string) => startStripeCheckout(sku),
}));

const { performCheckout, resolvePlatform } = await import("./use-checkout");

beforeEach(() => {
  vi.clearAllMocks();
  startStripeCheckout.mockResolvedValue({ ok: true, url: "https://checkout.stripe.com/x" });
  purchaseNativeSku.mockResolvedValue({ ok: true });
});

describe("performCheckout — the native app must never reach Stripe", () => {
  it("does nothing at all while the platform is still unknown", async () => {
    const outcome = await performCheckout("checking", "annual");

    expect(outcome).toEqual({ status: "not-ready" });
    // This is the whole of B2. An unresolved platform must not fall through.
    expect(startStripeCheckout).not.toHaveBeenCalled();
    expect(purchaseNativeSku).not.toHaveBeenCalled();
  });

  it("uses the store on native, never Stripe", async () => {
    const outcome = await performCheckout("native", "annual");

    expect(purchaseNativeSku).toHaveBeenCalledWith("annual");
    expect(startStripeCheckout).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "entitled", via: "purchase" });
  });

  it("uses Stripe on the web, where it is allowed and cheaper", async () => {
    const outcome = await performCheckout("web", "annual");

    expect(startStripeCheckout).toHaveBeenCalledWith("annual");
    expect(purchaseNativeSku).not.toHaveBeenCalled();
    expect(outcome).toEqual({ status: "redirecting", url: "https://checkout.stripe.com/x" });
  });

  it.each(["monthly", "annual", "lifetime"] as const)(
    "routes the %s sku to the store on native",
    async (sku) => {
      await performCheckout("native", sku);
      expect(purchaseNativeSku).toHaveBeenCalledWith(sku);
      expect(startStripeCheckout).not.toHaveBeenCalled();
    },
  );
});

describe("performCheckout — native purchase outcomes", () => {
  it("treats a cancelled purchase as cancelled, not an error", async () => {
    purchaseNativeSku.mockResolvedValue({ ok: false, cancelled: true, message: "cancelled" });

    expect(await performCheckout("native", "annual")).toEqual({ status: "cancelled" });
  });

  it("surfaces a genuine failure so the button does not silently stop working", async () => {
    purchaseNativeSku.mockResolvedValue({ ok: false, cancelled: false, message: "Card declined." });

    expect(await performCheckout("native", "annual")).toEqual({
      status: "error",
      message: "Card declined.",
    });
  });

  it("reports a failed Stripe checkout rather than redirecting nowhere", async () => {
    startStripeCheckout.mockResolvedValue({ ok: false, message: "Checkout unavailable." });

    expect(await performCheckout("web", "annual")).toEqual({
      status: "error",
      message: "Checkout unavailable.",
    });
  });
});

/*
 * `via` exists so the confirmation screen can tell the two apart.
 *
 * PremiumWelcome says different things to somebody who has just paid and
 * somebody who has just restored an old purchase, and greeting a restore with
 * "thanks for subscribing" is the kind of wrong that gets replied to. Only the
 * paywall knows which happened, so collapsing `entitled` to a bare success
 * here would throw the answer away at the one point that has it.
 */
describe("performCheckout — a restore is not a purchase", () => {
  it("reports a dashboard-paywall purchase as a purchase", async () => {
    vi.stubEnv("NEXT_PUBLIC_REVENUECAT_USE_PAYWALL", "true");
    vi.resetModules();
    presentProPaywall.mockResolvedValue({ entitled: true, via: "purchase" });
    const mod = await import("./use-checkout");

    expect(await mod.performCheckout("native", "annual")).toEqual({
      status: "entitled",
      via: "purchase",
    });
    vi.unstubAllEnvs();
  });

  it("reports a dashboard-paywall restore as a restore", async () => {
    vi.stubEnv("NEXT_PUBLIC_REVENUECAT_USE_PAYWALL", "true");
    vi.resetModules();
    presentProPaywall.mockResolvedValue({ entitled: true, via: "restore" });
    const mod = await import("./use-checkout");

    expect(await mod.performCheckout("native", "annual")).toEqual({
      status: "entitled",
      via: "restore",
    });
    vi.unstubAllEnvs();
  });

  it("does not present the dashboard paywall while the platform is unknown", async () => {
    vi.stubEnv("NEXT_PUBLIC_REVENUECAT_USE_PAYWALL", "true");
    vi.resetModules();
    const mod = await import("./use-checkout");

    expect(await mod.performCheckout("checking", "annual")).toEqual({ status: "not-ready" });
    expect(presentProPaywall).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("treats a dismissed dashboard paywall as cancelled, and a broken one as an error", async () => {
    vi.stubEnv("NEXT_PUBLIC_REVENUECAT_USE_PAYWALL", "true");
    vi.resetModules();
    const mod = await import("./use-checkout");

    presentProPaywall.mockResolvedValue({ entitled: false, reason: "cancelled" });
    expect(await mod.performCheckout("native", "annual")).toEqual({ status: "cancelled" });

    presentProPaywall.mockResolvedValue({ entitled: false, reason: "error" });
    expect(await mod.performCheckout("native", "annual")).toEqual({
      status: "error",
      message: "Couldn't open checkout. Please try again.",
    });
    vi.unstubAllEnvs();
  });
});

describe("resolvePlatform", () => {
  it("answers native without waiting on any network call", () => {
    isNativePlatform.mockReturnValue(true);
    // Synchronous by construction: if this ever needs awaiting, B2 is back.
    expect(resolvePlatform()).toBe("native");
  });

  it("answers web off-device", () => {
    isNativePlatform.mockReturnValue(false);
    expect(resolvePlatform()).toBe("web");
  });

  it("never answers 'checking' — that is only the pre-mount state", () => {
    isNativePlatform.mockReturnValue(true);
    expect(resolvePlatform()).not.toBe("checking");
    isNativePlatform.mockReturnValue(false);
    expect(resolvePlatform()).not.toBe("checking");
  });
});

/**
 * The hook's wiring, asserted on the source.
 *
 * `useCheckout` cannot be executed here — this project has no React testing
 * library, which is the reason `performCheckout` and `resolvePlatform` were
 * split out as pure functions in the first place. So this is a weaker kind of
 * test than the ones above and is labelled as such rather than dressed up: it
 * cannot prove the hook behaves correctly, only that it has not been rewritten
 * into the two shapes that are known to reintroduce B2.
 *
 * It exists because the platform read changed. `useState("checking")` plus a
 * `setPlatform` in an effect was correct and tripped
 * `react-hooks/set-state-in-effect` — a synchronous setState in an effect
 * renders the tree, discards it and renders again. It is now
 * `useSyncExternalStore`, which is the API for exactly this: a value that must
 * differ between the server render and the client.
 *
 * The regression to guard against is somebody simplifying that to a lazy
 * initialiser. It would look tidier, it would pass every test above, and it
 * would hydrate the native app with "web" already latched — which is B2,
 * returned, in the most prominent upgrade button in the app.
 */
describe("useCheckout resolves the platform without latching it early", () => {
  const source = stripComments(
    readFileSync(new URL("./use-checkout.ts", import.meta.url), "utf8")
  );

  it("reads the platform through useSyncExternalStore", () => {
    expect(source).toContain("useSyncExternalStore");
  });

  it("does not assign the platform from an effect", () => {
    // The lint rule catches this too. Asserted here as well because the rule
    // is a warning away from being switched off, and this is the reason it
    // matters in this specific file.
    expect(source).not.toMatch(/setPlatform\s*\(/);
  });

  it("hydrates as 'checking', never as a guess", () => {
    /*
     * The third argument to useSyncExternalStore is the server snapshot, and
     * React uses it for the hydration render as well as the server one. If it
     * ever returns anything but "checking", the native app can hydrate holding
     * an answer nobody has checked.
     */
    expect(source).toMatch(/serverPlatform\s*=\s*\(\)\s*:\s*CheckoutPlatform\s*=>\s*"checking"/);
    expect(source).toContain("serverPlatform,");
  });

  it("does not resolve the platform during render on the server", () => {
    // A lazy initialiser is the tidy-looking mistake.
    expect(source).not.toMatch(/useState\s*\(\s*resolvePlatform\s*\)/);
    expect(source).not.toMatch(/useState\s*\(\s*\(\)\s*=>\s*resolvePlatform/);
  });

  it("settles offeringsLoaded whether the store answers or fails", () => {
    /*
     * The disabled purchase button hangs off this. Setting it only in `then`
     * leaves an athlete whose store call failed looking at a button that
     * never enables — the store has answered, the answer was "no prices", and
     * the configured ones are already on screen.
     */
    expect(source).toMatch(/\.finally\(/);
    expect(source).not.toMatch(/\.then\([^)]*setStoreAnswered/);
  });

  it("never waits on the store before answering on the web", () => {
    // Off-device there are no store prices to wait for, and gating the web
    // button on a fetch that never runs would disable checkout entirely.
    expect(source).toContain('platform === "native" ? storeAnswered : true');
  });
});
