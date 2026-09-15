import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The sign-in screen that one tap could kill.
 *
 * `auth-form.tsx` disables both provider buttons while an attempt is in flight
 * and cleared that state only on an error from `signInWithOAuth` or on the
 * redirect arriving. Dismissing the in-app browser does neither, so the buttons
 * stayed disabled until the app was restarted.
 *
 * That mattered on 15 September 2026 because Apple was not enabled on the
 * Supabase project. `signInWithOAuth` builds the provider URL on the CLIENT and
 * never contacts the server, so it returned `error: null` and a URL exactly
 * like a working provider's; the failure appeared only when the browser loaded
 * it. Verified against the live project that day:
 *
 *   apple  → 400 {"code":400,"error_code":"validation_failed",
 *                 "msg":"Unsupported provider: provider is not enabled"}
 *   google → 302 accounts.google.com
 *
 * So a reviewer tapped Apple — which sits above Google deliberately, per
 * Guideline 4.8 — read that JSON, dismissed the sheet, and found Google and
 * email disabled too. The misconfiguration alone would not have done that:
 * without this listener, one broken provider disables the two that work.
 */

const browserListeners = new Map<string, () => void>();
const appListeners = new Map<string, (event: { url: string }) => void>();
const removeBrowser = vi.fn();
const removeApp = vi.fn();
const close = vi.fn(() => Promise.resolve());

vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: vi.fn(() => Promise.resolve()),
    close: () => close(),
    addListener: (name: string, handler: () => void) => {
      browserListeners.set(name, handler);
      return Promise.resolve({ remove: removeBrowser });
    },
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: (name: string, handler: (event: { url: string }) => void) => {
      appListeners.set(name, handler);
      return Promise.resolve({ remove: removeApp });
    },
  },
}));

let native = true;
vi.mock("./platform", () => ({ isNativePlatform: () => native }));

/*
 * A minimal `window`, because the redirect handler navigates by assigning
 * `location.href`. These tests run in the node environment — the same one the
 * rest of `src/lib/native` uses — and jsdom would throw "Not implemented:
 * navigation" on the assignment anyway, so the destination is captured instead.
 */
const navigatedTo: string[] = [];
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    location: {
      origin: "https://splitindex.co.uk",
      set href(url: string) {
        navigatedTo.push(url);
      },
      get href() {
        return navigatedTo[navigatedTo.length - 1] ?? "";
      },
    },
  },
});

import {
  beginNativeOAuth,
  nativeOAuthRedirectUrl,
  registerNativeOAuthDismissListener,
  registerNativeOAuthRedirectListener,
} from "./oauth";

const dismissBrowser = () => browserListeners.get("browserFinished")?.();
const deliverUrl = (url: string) => appListeners.get("appUrlOpen")?.({ url });

beforeEach(() => {
  browserListeners.clear();
  appListeners.clear();
  removeBrowser.mockClear();
  removeApp.mockClear();
  close.mockClear();
  navigatedTo.length = 0;
  native = true;
  beginNativeOAuth();
});

describe("the redirect back into the app", () => {
  it("uses a custom scheme, because an in-app browser cannot hand back an https redirect", () => {
    expect(nativeOAuthRedirectUrl()).toBe("co.uk.splitindex.app://auth-callback");
  });

  it("ignores a url that is not ours", () => {
    registerNativeOAuthRedirectListener();
    deliverUrl("co.uk.splitindex.app://something-else?code=abc");
    expect(close).not.toHaveBeenCalled();
  });
});

describe("THE FAULT: the browser closing without signing anybody in", () => {
  it("calls back when the user dismisses the sheet", () => {
    const onDismissed = vi.fn();
    registerNativeOAuthDismissListener(onDismissed);

    dismissBrowser();

    expect(onDismissed).toHaveBeenCalledTimes(1);
  });

  it("does NOT call back when we close the sheet ourselves after a redirect", () => {
    /*
     * The half that makes this safe to ship. The OS fires `browserFinished`
     * for our own `Browser.close()` too, so a naive listener would report a
     * successful sign-in as an abandoned one and put an error on screen while
     * the app navigated to the dashboard.
     */
    const onDismissed = vi.fn();
    registerNativeOAuthRedirectListener();
    registerNativeOAuthDismissListener(onDismissed);

    deliverUrl("co.uk.splitindex.app://auth-callback?code=abc123");
    dismissBrowser();

    expect(close).toHaveBeenCalledTimes(1);
    expect(onDismissed).not.toHaveBeenCalled();
    expect(navigatedTo).toEqual(["https://splitindex.co.uk/auth/callback?code=abc123"]);
  });

  it("recovers for the NEXT attempt after a successful one", () => {
    // Without resetting, a user who signs in, signs out and tries again would
    // find the dismiss listener permanently muted — the same dead screen, one
    // sign-in later.
    const first = vi.fn();
    registerNativeOAuthRedirectListener();
    registerNativeOAuthDismissListener(first);
    deliverUrl("co.uk.splitindex.app://auth-callback?code=abc123");

    beginNativeOAuth();
    const second = vi.fn();
    registerNativeOAuthDismissListener(second);
    dismissBrowser();

    expect(second).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes when told to, so attempts do not stack up", async () => {
    const stop = registerNativeOAuthDismissListener(vi.fn());
    stop();
    await Promise.resolve();
    expect(removeBrowser).toHaveBeenCalled();
  });

  it("does nothing at all on web, where there is no sheet to dismiss", () => {
    native = false;
    const onDismissed = vi.fn();
    const stop = registerNativeOAuthDismissListener(onDismissed);

    dismissBrowser();

    expect(onDismissed).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});
