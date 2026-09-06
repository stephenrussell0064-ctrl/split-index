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
    // 100, not 120: ages above 110 are no longer accepted at all — see below.
    const min = minDobForMaxAge(100, now);
    expect(ageFromDateOfBirth(min, now)).toBe(100);
  });
});

describe("an implausible date of birth is rejected rather than scored", () => {
  const now = new Date("2026-07-24T12:00:00Z");

  /*
    Age is not a label — it divides the benchmark-equivalent time through
    `enduranceAgeGradeFactor`, so it moves the score directly. The same 5 km in
    25:00 scored 627 at age 30 and 988 at age 80, and `date_of_birth` is an
    ordinary editable profile field while the leaderboards read `sport_index`.

    The old ceiling was 150, so `1900-01-01` resolved to 126 and was accepted
    everywhere. This does not stop anyone claiming to be 85 — age-grading a
    masters athlete is legitimate and standard — it stops a number no living
    person has, which the app had no reason to accept and no way to tell apart
    from a typo.
  */
  it("accepts the oldest plausible athlete", () => {
    expect(ageFromDateOfBirth("1930-01-01", now)).toBe(96);
    expect(ageFromDateOfBirth(minDobForMaxAge(110, now), now)).toBe(110);
  });

  it("rejects an age no living person has", () => {
    expect(ageFromDateOfBirth("1900-01-01", now)).toBeNull();
    expect(ageFromDateOfBirth("1850-06-01", now)).toBeNull();
  });

  it("still rejects a date in the future", () => {
    expect(ageFromDateOfBirth("2030-01-01", now)).toBeNull();
  });
});
