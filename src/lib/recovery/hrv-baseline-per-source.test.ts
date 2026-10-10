import { describe, expect, it } from "vitest";
import { hrvFromReadings } from "./data";

/**
 * Apple reports HRV as SDNN; the manual entry is rMSSD. A baseline that
 * mixed them would compare today against a number measured a different
 * way, so the baseline is built from the same source as today's reading
 * only (migration 089, logging-effort plan phase 1).
 */
describe("hrvFromReadings", () => {
  it("builds the baseline from earlier readings of the same source only", () => {
    const out = hrvFromReadings([
      { hrv_ms: 50, source: "apple_health" }, // today
      { hrv_ms: 80, source: "manual" }, // a typed rMSSD among the Apple readings
      { hrv_ms: 40, source: "apple_health" },
      { hrv_ms: 60, source: "apple_health" },
    ]);
    expect(out).toEqual({ hrvToday: 50, hrvBaseline: 50, hrvSource: "apple_health" });
  });

  it("treats rows written before the column existed as manual", () => {
    const out = hrvFromReadings([{ hrv_ms: 70 }, { hrv_ms: 60 }, { hrv_ms: 80, source: null }]);
    expect(out).toEqual({ hrvToday: 70, hrvBaseline: 70, hrvSource: "manual" });
  });

  it("has no baseline when every earlier reading is from the other instrument", () => {
    const out = hrvFromReadings([
      { hrv_ms: 70, source: "manual" },
      { hrv_ms: 45, source: "apple_health" },
      { hrv_ms: 48, source: "apple_health" },
    ]);
    expect(out).toEqual({ hrvToday: 70, hrvBaseline: null, hrvSource: "manual" });
  });

  it("caps the baseline at fourteen readings of that source", () => {
    const rows = [{ hrv_ms: 100, source: "apple_health" }];
    for (let i = 0; i < 14; i++) rows.push({ hrv_ms: 50, source: "apple_health" });
    rows.push({ hrv_ms: 1000, source: "apple_health" }); // fifteenth prior: outside the window
    expect(hrvFromReadings(rows).hrvBaseline).toBe(50);
  });

  it("gives nothing for nothing", () => {
    expect(hrvFromReadings([])).toEqual({ hrvToday: null, hrvBaseline: null, hrvSource: null });
  });
});
