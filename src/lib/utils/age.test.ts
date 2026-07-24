import { describe, expect, it } from "vitest";
import { ageFromDateOfBirth, maxDobForMinAge, minDobForMaxAge } from "./age";

describe("ageFromDateOfBirth", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  it("computes age from a YYYY-MM-DD string", () => {
    expect(ageFromDateOfBirth("1996-07-24", now)).toBe(30);
    expect(ageFromDateOfBirth("1996-01-01", now)).toBe(30);
  });

  it("does not count the current year's birthday until it has passed", () => {
    // Birthday later in the year → still the younger age.
    expect(ageFromDateOfBirth("1996-12-25", now)).toBe(29);
    // Birthday exactly today → counts.
    expect(ageFromDateOfBirth("2000-07-24", now)).toBe(26);
    // Birthday yesterday → counts.
    expect(ageFromDateOfBirth("2000-07-23", now)).toBe(26);
    // Birthday tomorrow → not yet.
    expect(ageFromDateOfBirth("2000-07-25", now)).toBe(25);
  });

  it("returns null for missing or unparseable input", () => {
    expect(ageFromDateOfBirth(null, now)).toBeNull();
    expect(ageFromDateOfBirth(undefined, now)).toBeNull();
    expect(ageFromDateOfBirth("", now)).toBeNull();
    expect(ageFromDateOfBirth("not-a-date", now)).toBeNull();
  });

  it("accepts a Date instance", () => {
    expect(ageFromDateOfBirth(new Date("1990-06-01"), now)).toBe(36);
  });
});

describe("date-input bound helpers", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  it("maxDobForMinAge is the latest DOB that still satisfies the minimum age", () => {
    const max = maxDobForMinAge(13, now);
    expect(ageFromDateOfBirth(max, now)).toBe(13);
  });

  it("minDobForMaxAge is the earliest DOB that still satisfies the maximum age", () => {
    const min = minDobForMaxAge(120, now);
    expect(ageFromDateOfBirth(min, now)).toBe(120);
  });
});
