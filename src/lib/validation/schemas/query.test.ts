import { describe, expect, it } from "vitest";
import {
  clampedIntParam,
  compareQuerySchema,
  exportQuerySchema,
  idQuerySchema,
  intParam,
  logbookQuerySchema,
  windowDaysQuerySchema,
} from "./query";

/**
 * N1 — query parameters.
 *
 * The rules here are the OPPOSITE of the body schemas in two ways, and both are
 * load-bearing: unknown keys are ignored rather than refused, and a bad value
 * falls back rather than 400s. Those are what these tests are mostly about.
 */

describe("unknown query keys are ignored, not refused", () => {
  /**
   * The one that would break real links. `utm_source`, `fbclid` and `gclid` are
   * appended to URLs by mail clients, ad platforms and social apps, to links
   * nobody controls. `.strict()` here would turn a shared logbook link into a
   * 400.
   */
  it("tolerates the tracking parameters the internet adds", () => {
    const schema = logbookQuerySchema(25);
    const parsed = schema.safeParse({
      limit: "10",
      utm_source: "newsletter",
      fbclid: "IwAR0abc",
      gclid: "xyz",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(10);
  });
});

describe("intParam falls back where the route defaulted", () => {
  const limit = intParam(25, 1, 100);

  it("takes a good value", () => {
    expect(limit.parse("10")).toBe(10);
  });

  /**
   * `Number(x) || DEFAULT` answered junk with the default and this keeps that.
   * What it did NOT do is the next two cases.
   */
  it.each(["", "  ", "abc", "NaN", "Infinity"])("falls back on %o", (v) => {
    expect(limit.parse(v)).toBe(25);
  });

  it("no longer lets a negative through, because -5 is truthy", () => {
    expect(limit.parse("-5")).toBe(25);
  });

  it("no longer reads an explicit zero as absent", () => {
    // `Number("0") || 25` is 25, which silently turned ?limit=0 into a full
    // page. Out of range now, so it lands on the same default — but by a rule
    // rather than by accident.
    expect(limit.parse("0")).toBe(25);
  });

  it("caps a limit that had no upper bound at all", () => {
    // ?limit=100000 used to reach the query builder as written.
    expect(limit.parse("100000")).toBe(25);
  });
});

describe("clampedIntParam clamps, because those routes clamped", () => {
  /**
   * The distinction that matters: `Math.min(365, Math.max(7, ...))` answers
   * `?days=500` with 365. A schema that fell back to 30 instead would quietly
   * change what a bookmarked link returns.
   */
  const days = clampedIntParam(30, 7, 365);

  it("clamps rather than falling back", () => {
    expect(days.parse("500")).toBe(365);
    expect(days.parse("1")).toBe(7);
  });

  it("still falls back on junk", () => {
    expect(days.parse("abc")).toBe(30);
    expect(days.parse("")).toBe(30);
  });

  it("matches the expression it replaced, across a range", () => {
    const old = (raw: string) => Math.min(365, Math.max(7, Number(raw) || 30));
    for (const raw of ["7", "30", "90", "365", "500", "1", "abc", "", "-4"]) {
      expect(days.parse(raw), `?days=${raw}`).toBe(old(raw));
    }
  });

  it("is what windowDaysQuerySchema uses", () => {
    expect(windowDaysQuerySchema(30).parse({ days: "500" }).days).toBe(365);
  });
});

describe("ids reject rather than fall back", () => {
  /**
   * The exception to the fallback rule. A malformed uuid in a WHERE clause is a
   * Postgres cast error, not a miss, so the honest answer is a 400 naming the
   * parameter rather than a 500 from the driver.
   */
  it("refuses an id the database could never hold", () => {
    expect(idQuerySchema.safeParse({ id: "someone" }).success).toBe(false);
    expect(idQuerySchema.safeParse({ id: "" }).success).toBe(false);
    expect(idQuerySchema.safeParse({ id: "1 OR 1=1" }).success).toBe(false);
  });

  it("accepts a real one", () => {
    expect(
      idQuerySchema.safeParse({ id: "11111111-1111-4111-8111-111111111111" }).success
    ).toBe(true);
  });
});

describe("enums fall back to the route's existing default", () => {
  it("keeps json for an unknown export format", () => {
    // Was `?? "json"`, so ?format=xml fell through as "xml".
    expect(exportQuerySchema.parse({ format: "xml" }).format).toBe("json");
    expect(exportQuerySchema.parse({ format: "csv" }).format).toBe("csv");
    expect(exportQuerySchema.parse({}).format).toBe("json");
  });
});

describe("compare no longer computes a date from NaN", () => {
  /**
   * The one genuine bug among the query parameters rather than a missing
   * guard: `Number(searchParams.get("days") ?? 30)` had no `||`, so ?days=abc
   * produced NaN and NaN reached a date computation.
   */
  it("answers junk with 30 instead of NaN", () => {
    const parsed = compareQuerySchema.parse({ days: "abc" });
    expect(Number.isNaN(parsed.days)).toBe(false);
    expect(parsed.days).toBe(30);
  });

  it("still refuses a userId that is not a uuid", () => {
    expect(compareQuerySchema.safeParse({ userId: "someone" }).success).toBe(false);
  });

  it("allows neither identifier, because the handler decides that", () => {
    expect(compareQuerySchema.safeParse({}).success).toBe(true);
  });
});
