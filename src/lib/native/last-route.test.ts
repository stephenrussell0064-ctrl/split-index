import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The value of these tests is the two ways route restoration could hurt rather
 * than help: hijacking a sign-in, and dragging the athlete back to a screen
 * they have long since finished with. Landing them on the right screen is the
 * easy half.
 */

const store = new Map<string, string>();

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/preferences", () => ({
  Preferences: {
    get: mocks.get,
    set: mocks.set,
    remove: mocks.remove,
  },
}));

import {
  isRestorablePath,
  rememberRoute,
  forgetRoute,
  resolveRestoreTarget,
} from "./last-route";

const KEY = "split-index:last-route";

beforeEach(() => {
  store.clear();
  vi.useRealTimers();
  mocks.get.mockImplementation(async ({ key }: { key: string }) => ({
    value: store.get(key) ?? null,
  }));
  mocks.set.mockImplementation(async ({ key, value }: { key: string; value: string }) => {
    store.set(key, value);
  });
  mocks.remove.mockImplementation(async ({ key }: { key: string }) => {
    store.delete(key);
  });
});

/** Put a route in storage as if it were recorded `agoMs` ago. */
function seed(path: string, agoMs = 0) {
  store.set(KEY, JSON.stringify({ path, at: Date.now() - agoMs }));
}

describe("isRestorablePath", () => {
  it("accepts the athlete's own screens, including nested ones", () => {
    expect(isRestorablePath("/dashboard")).toBe(true);
    expect(isRestorablePath("/gym")).toBe(true);
    expect(isRestorablePath("/activities/new")).toBe(true);
    expect(isRestorablePath("/hybrid-plan")).toBe(true);
  });

  it("rejects auth screens, which are never somewhere to be returned to", () => {
    expect(isRestorablePath("/login")).toBe(false);
    expect(isRestorablePath("/auth/callback")).toBe(false);
  });

  it("rejects marketing and legal pages", () => {
    expect(isRestorablePath("/")).toBe(false);
    expect(isRestorablePath("/privacy")).toBe(false);
    expect(isRestorablePath("/pricing")).toBe(false);
  });

  it("rejects /admin — not part of an athlete's session", () => {
    expect(isRestorablePath("/admin")).toBe(false);
    expect(isRestorablePath("/admin/users")).toBe(false);
  });

  it("does not treat a prefix match as a path match", () => {
    // /gymnastics is not /gym.
    expect(isRestorablePath("/gymnastics")).toBe(false);
    expect(isRestorablePath("/settings-export")).toBe(false);
  });
});

describe("rememberRoute", () => {
  it("stores a restorable route with the time it was seen", async () => {
    await rememberRoute("/gym");
    const stored = JSON.parse(store.get(KEY)!);
    expect(stored.path).toBe("/gym");
    expect(typeof stored.at).toBe("number");
  });

  it("does not store a route it would never restore", async () => {
    await rememberRoute("/login");
    await rememberRoute("/privacy");
    expect(store.has(KEY)).toBe(false);
  });

  it("stays silent when storage fails — a lost route is not an error to raise", async () => {
    mocks.set.mockRejectedValueOnce(new Error("no space"));
    await expect(rememberRoute("/gym")).resolves.toBeUndefined();
  });
});

describe("resolveRestoreTarget", () => {
  it("sends a signed-in cold launch back where the athlete was", async () => {
    seed("/gym");
    // The cold launch lands on server.url (/login), which redirects a
    // signed-in athlete to /dashboard — so this is what the document sees.
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBe("/gym");
  });

  it("stays put when the route already came back on its own", async () => {
    // The WKWebView content-process reload: Capacitor reloads the current url,
    // so the athlete is already in the right place and must not be navigated.
    seed("/gym");
    await expect(resolveRestoreTarget("/gym")).resolves.toBeNull();
  });

  it("stays put with nothing stored", async () => {
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();
  });

  it("does not hijack a sign-in, and clears the stale route while there", async () => {
    seed("/gym");
    await expect(resolveRestoreTarget("/login")).resolves.toBeNull();
    // Cleared, so the sign-in that follows lands wherever the server says —
    // /auth/callback routes a brand-new athlete to onboarding, and that must
    // win uncontested.
    expect(store.has(KEY)).toBe(false);
  });

  it("does not fire on the OAuth callback path", async () => {
    seed("/gym");
    await expect(resolveRestoreTarget("/auth/callback")).resolves.toBeNull();
  });

  it("lets a route go stale rather than reopening yesterday's screen", async () => {
    seed("/gym", 7 * 60 * 60 * 1000);
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();
  });

  it("still restores across a long gap within the window", async () => {
    seed("/activities/new", 5 * 60 * 60 * 1000);
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBe("/activities/new");
  });

  it("ignores a stored route that is no longer restorable", async () => {
    // A route removed from the app between builds, or written by an older
    // version of this code.
    seed("/some-old-screen");
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();
  });

  it("ignores corrupt storage rather than throwing into the launch path", async () => {
    store.set(KEY, "{not json");
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();

    store.set(KEY, JSON.stringify({ path: 42 }));
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();

    store.set(KEY, JSON.stringify({ path: "/gym" }));
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();
  });

  it("stays put when storage itself fails", async () => {
    seed("/gym");
    mocks.get.mockRejectedValueOnce(new Error("unavailable"));
    await expect(resolveRestoreTarget("/dashboard")).resolves.toBeNull();
  });
});

describe("forgetRoute", () => {
  it("removes the stored route", async () => {
    seed("/gym");
    await forgetRoute();
    expect(store.has(KEY)).toBe(false);
  });
});
