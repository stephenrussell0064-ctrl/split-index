/**
 * The bug these guard against left no trace in code: CARTO answers the
 * keyless endpoint with `200 image/png`, so a missing key throws nothing,
 * logs nothing and fails no request — it watermarks every tile instead.
 * Nothing but an assertion on the URL itself can catch that.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const ENV = "NEXT_PUBLIC_CARTO_BASEMAP_KEY";

/** The module reads the key once at import, so each case needs a fresh one. */
async function loadWithKey(key: string | undefined) {
  vi.resetModules();
  if (key === undefined) vi.stubEnv(ENV, "");
  else vi.stubEnv(ENV, key);
  return import("./basemap");
}

afterEach(() => vi.unstubAllEnvs());

describe("basemapTileUrl", () => {
  it("carries the key on both variants when one is configured", async () => {
    const { basemapTileUrl, BASEMAP_KEY_CONFIGURED } = await loadWithKey("test-key-123");
    expect(BASEMAP_KEY_CONFIGURED).toBe(true);
    // Both, not one. Three call sites spelled this URL out by hand before it
    // moved here, and a key appended to some of them is the same bug.
    expect(basemapTileUrl("light")).toContain("?key=test-key-123");
    expect(basemapTileUrl("dark")).toContain("?key=test-key-123");
  });

  it("keeps each variant on its own style", async () => {
    const { basemapTileUrl } = await loadWithKey("k");
    expect(basemapTileUrl("light")).toContain("/light_all/");
    expect(basemapTileUrl("dark")).toContain("/dark_all/");
  });

  it("preserves the Leaflet placeholders, which are not ours to URL-encode", async () => {
    const { basemapTileUrl } = await loadWithKey("k");
    // Leaflet substitutes these itself. Encoding them turns every tile
    // request into a 404 for a tile literally named "{z}".
    for (const token of ["{s}", "{z}", "{x}", "{y}", "{r}"]) {
      expect(basemapTileUrl("dark")).toContain(token);
    }
  });

  it("escapes a key that would otherwise break out of the query string", async () => {
    const { basemapTileUrl } = await loadWithKey("a&b=c");
    expect(basemapTileUrl("light")).toContain("?key=a%26b%3Dc");
  });

  it("still returns a usable tile URL with no key, rather than nothing", async () => {
    const { basemapTileUrl, BASEMAP_KEY_CONFIGURED } = await loadWithKey(undefined);
    expect(BASEMAP_KEY_CONFIGURED).toBe(false);
    // Watermarked, but a map. A run in progress is the worst moment to
    // replace one with an error state over a config problem the athlete
    // cannot fix — and the bare URL is what makes the watermark appear,
    // so this asserts the degraded path stays deliberate.
    expect(basemapTileUrl("light")).toBe(
      "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
    );
    expect(basemapTileUrl("light")).not.toContain("key=");
  });
});
