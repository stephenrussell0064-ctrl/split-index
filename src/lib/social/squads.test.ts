import { describe, expect, it } from "vitest";
import { generateInviteCode, normalizeInviteCode } from "./squads";

describe("generateInviteCode", () => {
  it("generates a 7-character code with no ambiguous characters", () => {
    for (let i = 0; i < 50; i++) {
      const code = generateInviteCode();
      expect(code).toHaveLength(7);
      expect(code).toMatch(/^[A-HJ-NP-Z2-9]+$/);
    }
  });

  it("generates different codes across calls (not a fixed constant)", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateInviteCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe("normalizeInviteCode", () => {
  it("uppercases and strips whitespace", () => {
    expect(normalizeInviteCode(" abcd123 ")).toBe("ABCD123");
  });

  it("strips internal whitespace too", () => {
    expect(normalizeInviteCode("ab cd 123")).toBe("ABCD123");
  });
});
