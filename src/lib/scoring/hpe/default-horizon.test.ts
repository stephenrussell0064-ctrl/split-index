import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLANNING_HORIZON_WEEKS,
  MAX_HORIZON_WEEKS,
  MIN_HORIZON_WEEKS,
  PLANNING_HORIZONS,
} from "./constants";

/*
 * The default block is twenty-four weeks, and that is a decision rather than a
 * detail.
 *
 * Twelve is still the unit the gain-rate constants are expressed against —
 * `weeksOut / 12` is how the engine counts blocks, so twenty-four is exactly
 * two of them. What changed is the horizon an athlete gets when they express
 * no preference.
 *
 * Measured through the engine for an advanced runner at 18:25 targeting 18:00,
 * with their volume correctly stated:
 *
 *   12 weeks -> projects 18:05, target not reachable
 *   24 weeks -> projects 17:44, target reachable
 *
 * Twelve weeks is genuinely too short for a trained athlete to move a 5k far,
 * and the on-ramp compounds it: every week is a multiple of the anchor, and at
 * the safe weekly ramp twelve weeks with deloads never approaches the ceiling,
 * so a short default also caps the volume the athlete is ever built up to.
 */

describe("the default planning horizon", () => {
  it("is twenty-four weeks", () => {
    expect(DEFAULT_PLANNING_HORIZON_WEEKS).toBe(24);
  });

  it("is a whole number of the twelve-week blocks the gain rates assume", () => {
    // The engine computes `blocks = weeksOut / 12`. A default that is not a
    // multiple would apply a fractional block to every athlete who expressed
    // no preference, which is not wrong but is a strange thing to make normal.
    expect(DEFAULT_PLANNING_HORIZON_WEEKS % 12).toBe(0);
  });

  it("is offered as a choice, so the default is not a hidden setting", () => {
    expect(PLANNING_HORIZONS.map((h) => h.weeks)).toContain(DEFAULT_PLANNING_HORIZON_WEEKS);
  });

  it("sits inside the bounds any horizon is held to", () => {
    expect(DEFAULT_PLANNING_HORIZON_WEEKS).toBeGreaterThanOrEqual(MIN_HORIZON_WEEKS);
    expect(DEFAULT_PLANNING_HORIZON_WEEKS).toBeLessThanOrEqual(MAX_HORIZON_WEEKS);
  });

  it("still offers the shorter block for anyone who wants it", () => {
    // Changing the default must not remove the option. Plenty of athletes have
    // a good reason to want twelve weeks and should not have to fight for it.
    expect(PLANNING_HORIZONS.map((h) => h.weeks)).toContain(12);
  });
});
