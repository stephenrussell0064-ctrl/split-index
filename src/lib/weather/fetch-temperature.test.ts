import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCurrentTemperatureCelsius } from "./fetch-temperature";

describe("fetchCurrentTemperatureCelsius", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the rounded current temperature on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ current: { temperature_2m: 18.37 } }),
      })
    );

    const result = await fetchCurrentTemperatureCelsius(51.5074, -0.1278);
    expect(result).toBe(18.4);
  });

  it("returns null when the request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    const result = await fetchCurrentTemperatureCelsius(51.5074, -0.1278);
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network error, timeout, etc.)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down"))
    );
    const result = await fetchCurrentTemperatureCelsius(51.5074, -0.1278);
    expect(result).toBeNull();
  });

  it("returns null when the response has no temperature field", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ current: {} }),
      })
    );
    const result = await fetchCurrentTemperatureCelsius(51.5074, -0.1278);
    expect(result).toBeNull();
  });
});
