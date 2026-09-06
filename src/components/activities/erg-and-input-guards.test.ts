import { describe, expect, it } from "vitest";
import { createDefaultState, parseNum, validateAndBuildPayload } from "./form-state";
import type { WorkoutFormState } from "./form-state";

/**
 * Two defects that made real, ordinary input impossible or wrong, both found by
 * the pre-launch edge-case sweep.
 */

function ergState(over: Partial<WorkoutFormState> = {}): WorkoutFormState {
  return {
    ...createDefaultState("rowing"),
    startedAt: "2026-09-01T07:00",
    ...over,
  };
}

describe("rowing and ski erg are loggable at ordinary distances", () => {
  /*
    `duration_seconds` is an integer column behind a `z.number().int()` schema,
    and the default erg input mode DERIVES duration as (split / 500) × metres —
    a float for almost every real piece. The payload was rejected before it
    reached the database, and because the failing value was one the athlete
    never typed, the form showed a generic "Something looks off" with no field
    highlighted and no way to work out what to change.
  */
  it.each([
    [1234, "1", "52"],
    [2000, "1", "48"],
    [500, "1", "39"],
    [6000, "2", "05"],
    [1609, "1", "55"],
  ])("accepts %i m at a %s:%s split", (metres, splitMinutes, splitSeconds) => {
    const { payload, errors } = validateAndBuildPayload(
      "rowing",
      ergState({
        distance: String(metres),
        splitMinutes,
        splitSeconds,
        rowInputMode: "distance",
      })
    );

    expect(errors).toEqual({});
    expect(payload).not.toBeNull();
    expect(Number.isInteger(payload!.duration_seconds)).toBe(true);
    expect(payload!.duration_seconds).toBeGreaterThan(0);
    expect(payload!.distance_meters).toBe(metres);
  });

  it("still derives distance from time in the other input mode", () => {
    const { payload, errors } = validateAndBuildPayload(
      "rowing",
      ergState({ minutes: "8", seconds: "0", splitMinutes: "2", splitSeconds: "00", rowInputMode: "time" })
    );
    expect(errors).toEqual({});
    expect(payload!.distance_meters).toBe(2000);
    expect(Number.isInteger(payload!.duration_seconds)).toBe(true);
  });
});

describe("parseNum only accepts numbers a person would type", () => {
  it("takes decimals, with either separator", () => {
    expect(parseNum("102.5")).toBe(102.5);
    expect(parseNum("102,5")).toBe(102.5);
    expect(parseNum(" 60 ")).toBe(60);
    expect(parseNum(".5")).toBe(0.5);
    expect(parseNum("-2")).toBe(-2);
  });

  it("rejects the JavaScript number literals that used to reach the database", () => {
    // These fields are type="text" so a comma decimal and clock notation can be
    // handled, which meant everything Number() accepts got through. A set
    // logged as "0x10" was stored, silently, as 16 kg.
    expect(parseNum("0x10")).toBeNull();
    expect(parseNum("0b101")).toBeNull();
    expect(parseNum("0o17")).toBeNull();
    expect(parseNum("1e3")).toBeNull();
    expect(parseNum("Infinity")).toBeNull();
    expect(parseNum("-Infinity")).toBeNull();
  });

  it("rejects text, and empty input, without throwing", () => {
    for (const value of ["", "   ", "abc", "1.2.3", "12kg", "--5"]) {
      expect(parseNum(value), JSON.stringify(value)).toBeNull();
    }
  });
});
