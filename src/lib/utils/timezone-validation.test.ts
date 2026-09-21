import { describe, expect, it } from "vitest";
import { isValidTimezone, resolveTimezone } from "./timezone";

/**
 * ONE POST USED TO TAKE THE DASHBOARD DOWN PERMANENTLY.
 *
 * `POST /api/profile/timezone` stored whatever string it was given.
 * `resolveTimezone` handed that string to `localDateKeyInTz`, which builds an
 * `Intl.DateTimeFormat` — and `Intl` throws a RangeError on a zone it does not
 * know. That throw happened inside the dashboard and analytics SERVER
 * components, so the athlete's own home page returned 500 on every load, for
 * ever, with nothing in the app able to change the value back.
 *
 * It is reachable without malice too: `resolvedOptions().timeZone` on an
 * unusual or outdated engine can return a name the server's ICU build has never
 * heard of.
 */

describe("isValidTimezone", () => {
  it("accepts real IANA zones", () => {
    for (const zone of ["Europe/London", "UTC", "America/New_York", "Australia/Eucla", "Asia/Kolkata"]) {
      expect(isValidTimezone(zone), zone).toBe(true);
    }
  });

  it("rejects the strings that used to reach Intl and throw", () => {
    for (const zone of ["Not/AZone", "", "   ", "Europe/Londonn", "'; drop table profiles;--", "🙂"]) {
      expect(isValidTimezone(zone), JSON.stringify(zone)).toBe(false);
    }
  });
});

describe("resolveTimezone", () => {
  it("uses a stored zone when it is real", () => {
    expect(resolveTimezone("Europe/London")).toBe("Europe/London");
  });

  it("falls back instead of throwing on a bad value already in the database", () => {
    // Validating on the way in does not help the rows written before there was
    // any validation. Those are still there, and a page that renders one must
    // degrade rather than 500.
    expect(() => resolveTimezone("Not/AZone")).not.toThrow();
    expect(isValidTimezone(resolveTimezone("Not/AZone"))).toBe(true);
  });

  it("falls back on null, empty and whitespace", () => {
    for (const stored of [null, undefined, "", "   "]) {
      expect(isValidTimezone(resolveTimezone(stored))).toBe(true);
    }
  });
});
