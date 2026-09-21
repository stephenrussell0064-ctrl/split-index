import { describe, expect, it } from "vitest";
import {
  DEFAULT_DURATION_DAYS,
  MAX_COMMENT_LENGTH,
  MAX_DURATION_DAYS,
  MAX_SQUAD_NAME_LENGTH,
  commentSchema,
  createDuelSchema,
  createSquadSchema,
  hrvSchema,
  joinSquadSchema,
  timezoneSchema,
} from "./social";
import { BOUND_HRV_MS } from "@/lib/security/config";

/**
 * N1 — the routes that carry one athlete's words to another.
 *
 * Each of these had ad-hoc guards that mostly worked. The tests below are
 * written around the specific ways they did not, because those are the reason
 * the schemas exist and the reason "mostly" is not the standard.
 */

describe("a value that only LOOKS like a string", () => {
  /**
   * THE FAILING-BEFORE CASE. `String(body.body ?? "")` turns an object into
   * "[object Object]" and an array into its comma-joined contents. Both are
   * non-empty, both passed the length check, and both were stored as somebody's
   * comment.
   */
  const NOT_STRINGS: [unknown, string][] = [
    [{ a: 1 }, "an object"],
    [["hello", "there"], "an array"],
    [42, "a number"],
    [true, "a boolean"],
  ];

  it.each(NOT_STRINGS)("refuses %s (%s) as a comment", (value) => {
    expect(commentSchema.safeParse({ body: value }).success).toBe(false);
  });

  it("still accepts an actual comment", () => {
    const parsed = commentSchema.safeParse({ body: "  nice session  " });
    expect(parsed.success).toBe(true);
    // Trimmed, as the hand-rolled version did.
    if (parsed.success) expect(parsed.data.body).toBe("nice session");
  });

  it("refuses an empty or whitespace-only comment, as before", () => {
    expect(commentSchema.safeParse({ body: "" }).success).toBe(false);
    expect(commentSchema.safeParse({ body: "   " }).success).toBe(false);
  });
});

describe("length limits are the ones that already shipped", () => {
  /**
   * The mistake this guards against is the one I made in the first draft:
   * inventing 500 and 50 against the routes' 1000 and 40, which would have
   * created a second set of bounds disagreeing with the first — finding N2,
   * introduced by the fix for N1.
   */
  it("keeps the comment limit at 1000", () => {
    expect(MAX_COMMENT_LENGTH).toBe(1000);
    expect(commentSchema.safeParse({ body: "x".repeat(1000) }).success).toBe(true);
    expect(commentSchema.safeParse({ body: "x".repeat(1001) }).success).toBe(false);
  });

  it("keeps the squad name limit at 40", () => {
    expect(MAX_SQUAD_NAME_LENGTH).toBe(40);
    expect(createSquadSchema.safeParse({ name: "x".repeat(40) }).success).toBe(true);
    expect(createSquadSchema.safeParse({ name: "x".repeat(41) }).success).toBe(false);
  });

  /**
   * And the behaviour change that matters: too long is now REFUSED rather than
   * silently truncated. An athlete who typed a long squad name used to get a
   * shorter one back with nothing saying so.
   */
  it("refuses an over-long squad name instead of shortening it", () => {
    const parsed = createSquadSchema.safeParse({ name: "x".repeat(60) });
    expect(parsed.success).toBe(false);
  });
});

describe("duels refuse rather than invent", () => {
  const base = { friendId: "3f2504e0-4f89-11d3-9a0c-0305e82c3301" };

  it("accepts a well-formed challenge", () => {
    expect(createDuelSchema.safeParse({ ...base, metric: "load", days: 14 }).success).toBe(true);
  });

  /**
   * These all used to succeed with a substituted value: days clamped to 30,
   * metric replaced with "sessions", sport replaced with null. The request was
   * malformed and the answer was a working duel that nobody asked for.
   */
  const SUBSTITUTED: [Record<string, unknown>, string][] = [
    [{ days: 900 }, "an out-of-range duration"],
    [{ days: 0 }, "a zero duration"],
    [{ days: 7.5 }, "a fractional duration"],
    [{ metric: "vibes" }, "an unknown metric"],
    [{ sport: "quidditch" }, "an unknown sport"],
  ];

  it.each(SUBSTITUTED)("refuses %o — %s", (extra) => {
    expect(createDuelSchema.safeParse({ ...base, ...extra }).success).toBe(false);
  });

  /**
   * Absent is not the same as invalid. Leaving a field out still means "the
   * usual one", which is why the route keeps its defaults.
   */
  it("allows the optional fields to be absent", () => {
    const parsed = createDuelSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.metric).toBeUndefined();
      expect(parsed.data.days).toBeUndefined();
    }
    expect(DEFAULT_DURATION_DAYS).toBeLessThanOrEqual(MAX_DURATION_DAYS);
  });

  it("refuses a friendId that is not a uuid", () => {
    expect(createDuelSchema.safeParse({ friendId: "me" }).success).toBe(false);
    expect(createDuelSchema.safeParse({ friendId: "' OR 1=1--" }).success).toBe(false);
  });
});

describe("HRV keeps the bound it had", () => {
  /**
   * The route checked `> 0 && <= 500` by hand. If the schema quietly widened or
   * narrowed that, it would be a worse outcome than the ad-hoc check it
   * replaced — so the bound is asserted against the central config, not
   * restated as a literal.
   */
  it("matches BOUND_HRV_MS exactly", () => {
    const [min, max] = BOUND_HRV_MS;
    expect(hrvSchema.safeParse({ hrvMs: min }).success).toBe(true);
    expect(hrvSchema.safeParse({ hrvMs: max }).success).toBe(true);
    expect(hrvSchema.safeParse({ hrvMs: min - 1 }).success).toBe(false);
    expect(hrvSchema.safeParse({ hrvMs: max + 1 }).success).toBe(false);
  });

  it("refuses the values Number() would have made finite-looking", () => {
    for (const v of ["", " ", null, [], {}, NaN, Infinity]) {
      expect(hrvSchema.safeParse({ hrvMs: v }).success, String(v)).toBe(false);
    }
  });
});

describe("every schema refuses keys it does not know", () => {
  /**
   * An unknown key means the caller and the server disagree about the contract.
   * Silently ignoring it is how a client keeps sending a field nobody reads.
   */
  it.each([
    ["comment", commentSchema, { body: "hi" }],
    ["squad", createSquadSchema, { name: "The Squad" }],
    ["join", joinSquadSchema, { inviteCode: "ABCD1234" }],
    ["hrv", hrvSchema, { hrvMs: 60 }],
    ["timezone", timezoneSchema, { timezone: "Europe/London" }],
  ])("%s", (_label, schema, valid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse({ ...valid, isAdmin: true }).success).toBe(false);
  });
});
