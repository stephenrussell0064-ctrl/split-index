import { describe, expect, it } from "vitest";
import { withoutBlocked } from "./moderation";
import { containsBlockedTerm, validateDisplayText, validateUsernameFormat } from "@/lib/utils/username";

/**
 * App Store Guideline 1.2 requires four things of an app with user-generated
 * content, and it is explicit that it is all four: a filter on objectionable
 * material, a report mechanism, the ability to block, and published contact
 * details. Before this work the app had a blocked-term list applied to
 * usernames and nothing else.
 *
 * These tests cover the two halves that are pure logic. The report queue and the
 * block writes are API routes, and the server-side filtering they drive is
 * asserted at its call sites (feed scope, leaderboard rows).
 */

describe("withoutBlocked — a block hides data, it does not merely un-paint it", () => {
  const rows = [
    { id: "a", userId: "u1" },
    { id: "b", userId: "u2" },
    { id: "c", userId: "u3" },
  ];

  it("drops every row authored by a blocked athlete", () => {
    const kept = withoutBlocked(rows, new Set(["u2"]), (r) => r.userId);
    expect(kept.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("returns the same array when nothing is blocked", () => {
    // Identity, not a copy: this runs on every feed and leaderboard read, and
    // the overwhelmingly common case is an empty block list.
    const blocked = new Set<string>();
    expect(withoutBlocked(rows, blocked, (r) => r.userId)).toBe(rows);
  });

  it("keeps rows whose author is unknown rather than dropping them", () => {
    // A missing author id means "this row is not attributable to anyone", which
    // is not the same as "this row belongs to someone you blocked". Dropping it
    // would silently delete content from a feed on the basis of a null.
    const anonymous = [{ id: "x", userId: null as string | null }];
    expect(withoutBlocked(anonymous, new Set(["u1"]), (r) => r.userId)).toHaveLength(1);
  });
});

describe("the objectionable-content filter reaches every name an athlete reads", () => {
  it("still rejects a blocked term in a username", () => {
    expect(validateUsernameFormat("cleanname").valid).toBe(true);
    expect(validateUsernameFormat("shitposter").valid).toBe(false);
  });

  it("rejects the same terms in a display name, which used to go unchecked", () => {
    // Display name is the field rendered LARGEST on a profile, on every feed
    // post and on every leaderboard row — and it was the one with no filter.
    expect(validateDisplayText("Sam Fitzgerald", { label: "Display name" }).valid).toBe(true);
    expect(validateDisplayText("shit lord", { label: "Display name" }).valid).toBe(false);
  });

  it("sees through separators, which is the first thing anyone tries", () => {
    expect(containsBlockedTerm("f u c k")).toBe(true);
    expect(containsBlockedTerm("f-u-c-k")).toBe(true);
    expect(containsBlockedTerm("s.h.i.t")).toBe(true);
    // And does not fire on innocent text that merely contains the letters.
    expect(containsBlockedTerm("Shitake mushrooms")).toBe(true); // substring: accepted false positive
    expect(containsBlockedTerm("Manchester Runners")).toBe(false);
    expect(containsBlockedTerm("Squat Club 5am")).toBe(false);
  });

  it("rejects control characters that would break every list they render into", () => {
    expect(validateDisplayText("Sam\nFitzgerald").valid).toBe(false);
    expect(validateDisplayText("Sam\u0000").valid).toBe(false);
  });

  it("enforces a length so a name cannot be used as free storage", () => {
    expect(validateDisplayText("a".repeat(51)).valid).toBe(false);
    expect(validateDisplayText("a".repeat(50)).valid).toBe(true);
    expect(validateDisplayText("   ").valid).toBe(false);
  });

  it("allows the punctuation and accents a real name needs", () => {
    // Looser on FORMAT than a username on purpose — a display name is not an
    // identifier, and rejecting "O'Brien" or "Renée" would be its own defect.
    for (const name of ["Renée", "O'Brien", "Anne-Marie", "Søren", "李伟"]) {
      expect(validateDisplayText(name).valid, name).toBe(true);
    }
  });
});
