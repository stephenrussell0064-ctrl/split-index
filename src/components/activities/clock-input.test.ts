import { describe, expect, it } from "vitest";
import { formatClock, parseSeconds, deriveSpeedKmh } from "./form-state";
import { clampIndexScore } from "@/lib/scoring/input-guards";

/**
 * WHAT A HALF-TYPED TIME USED TO MEAN.
 *
 * These fields are `type="text"` so an athlete can write "2:40" the way they
 * say it, which means every string reaches the parser — including the ones
 * they are still in the middle of typing. `Number("")` is 0, so ":" parsed as
 * zero and "1:" as sixty. `Number` also accepts what nobody writes, so
 * "0x10:00" was read as 16:00. And "1:99" came out as 2:39 — a time the
 * athlete did not enter and would not recognise in their logbook.
 *
 * The formatters run on every keystroke as the preview under the field, so a
 * partially typed entry rendered literal "NaN:NaN".
 */

describe("a clock time an athlete is still typing", () => {
  it("is refused rather than guessed at", () => {
    // Every one of these silently produced a number before.
    expect(parseSeconds(":")).toBeNull();
    expect(parseSeconds("::")).toBeNull();
    expect(parseSeconds("1:")).toBeNull();
    expect(parseSeconds(":30")).toBeNull();
    expect(parseSeconds("  :  ")).toBeNull();
  });

  it("refuses notation nobody types into a time field", () => {
    expect(parseSeconds("0x10:00")).toBeNull();
    expect(parseSeconds("1:1e3")).toBeNull();
  });

  it("refuses a segment that cannot be a minute or a second", () => {
    // "1:99" meant 2:39 — arithmetic the athlete never asked for.
    expect(parseSeconds("1:99")).toBeNull();
    expect(parseSeconds("1:60")).toBeNull();
    expect(parseSeconds("1:70:00")).toBeNull();
  });

  it("still reads the times people actually write", () => {
    expect(parseSeconds("2:40")).toBe(160);
    expect(parseSeconds("1:15")).toBe(75);
    expect(parseSeconds("1:30:00")).toBe(5400);
    expect(parseSeconds("75")).toBe(75);
    expect(parseSeconds("1:59")).toBe(119);
    // A comma decimal is what half of Europe types.
    expect(parseSeconds("1:30,5")).toBe(90.5);
  });
});

describe("the preview under the field", () => {
  it("shows nothing rather than a clock that cannot exist", () => {
    expect(formatClock(NaN)).toBe("—");
    expect(formatClock(Infinity)).toBe("—");
    expect(formatClock(-90)).toBe("—");
  });

  it("still formats a real duration", () => {
    expect(formatClock(160)).toBe("2:40");
    expect(formatClock(5400)).toBe("1:30:00");
    expect(formatClock(0)).toBe("0:00");
  });

  it("does not report a speed no human reaches", () => {
    // A duration mid-typing can be a fraction of a second; this printed
    // "3600000000000.0 km/h" under the distance field.
    expect(deriveSpeedKmh(1000, 1e-9)).toBeNull();
    expect(deriveSpeedKmh(10_000, 1800)).toBe("20.0 km/h");
  });
});

describe("an index that overflowed", () => {
  it("does not report the best possible effort as the worst", () => {
    // Infinity and NaN both came back as MIN_INDEX, so a scoring blow-up at
    // the top of the scale put the athlete at the bottom of the leaderboard.
    expect(clampIndexScore(Infinity)).toBe(999);
    expect(clampIndexScore(-Infinity)).toBe(1);
  });

  it("still floors a number that is not a number", () => {
    // NaN says nothing about the effort either way, and the floor is the safe
    // direction to fail.
    expect(clampIndexScore(NaN)).toBe(1);
  });

  it("leaves ordinary scores alone", () => {
    expect(clampIndexScore(627)).toBe(627);
    expect(clampIndexScore(0)).toBe(1);
    expect(clampIndexScore(1e308)).toBe(999);
  });
});
