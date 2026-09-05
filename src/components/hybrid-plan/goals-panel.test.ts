import { describe, expect, it } from "vitest";
import { GOAL_PANEL_FIELDS } from "./goals-panel";
import { SECTION_FIELDS, MANDATORY_SECTIONS } from "@/lib/scoring/hpe/intake-record";

/**
 * The goals panel writes through `PATCH /api/hpe/intake` with section "goal",
 * and that route DROPS any key it does not recognise rather than rejecting the
 * request — deliberately, so a stale client cannot fail a whole save over one
 * unknown field.
 *
 * The cost of that design is this failure mode: a single mistyped column name
 * in the panel is not an error anywhere. The PATCH succeeds, the panel says
 * "Saved — your block is rebuilding", the block rebuilds from the OLD target,
 * and the athlete has no way to tell. It is the same silence as a workout
 * score that never landed, and it needs the same treatment.
 */

describe("goals panel field names", () => {
  const allowed = new Set(SECTION_FIELDS.goal);

  for (const field of GOAL_PANEL_FIELDS) {
    it(`${field} is writable in the goal section`, () => {
      expect(allowed.has(field)).toBe(true);
    });
  }

  it("writes nothing outside its own section", () => {
    // A panel field that also appears in another section would be ambiguous
    // about which screen owns it. None currently do, and that is worth pinning.
    for (const [section, fields] of Object.entries(SECTION_FIELDS)) {
      if (section === "goal") continue;
      for (const field of GOAL_PANEL_FIELDS) {
        expect(fields, `${field} also appears in section "${section}"`).not.toContain(field);
      }
    }
  });

  it("stays inside a section the athlete cannot skip", () => {
    // The panel is an editing surface, not an onboarding one — it must not be
    // the only place a mandatory answer can be given, or an athlete who never
    // opens it would have an incomplete intake with nothing pointing there.
    expect(MANDATORY_SECTIONS).toContain("goal");
  });
});
