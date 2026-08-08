import { describe, expect, it } from "vitest";
import { scoreStrength, type ScoreStrengthInput } from "../split-strength-engine";
import { getAttachmentOptionsByKey, resolveAttachmentMultiplierByKey } from "./attachments";

/**
 * Equipment/attachment picker (user feedback: "equipment/attachment picker
 * for exercises (e.g. tricep pushdown rope vs straight bar) with images/
 * descriptions, and predictions differing per attachment"). A straight bar
 * locks the wrist and lets you move noticeably more weight than a rope for
 * the same triceps effort — scoring the two identically at the same logged
 * weight would silently reward switching to the "easier" attachment, so
 * the attachment adjusts the exercise's effective anchor before scoring.
 */
function score(liftKey: string, weightKg: number, attachment: string | null, overrides: Partial<ScoreStrengthInput> = {}) {
  return scoreStrength({
    liftKey,
    history: [],
    latestSet: { weightKg, reps: 8 },
    bodyweightKg: 83,
    sex: "male",
    age: 30,
    isPremium: false,
    attachment,
    ...overrides,
  });
}

describe("scoreStrength — attachment adjustment", () => {
  it("the same tricep pushdown weight scores lower on a straight bar than on a rope (straight bar lets you move more for the same effort)", () => {
    const rope = score("Tricep Pushdown", 40, "rope");
    const straightBar = score("Tricep Pushdown", 40, "straight-bar");
    expect(straightBar.score).toBeLessThan(rope.score);
  });

  it("no attachment selected behaves identically to the baseline attachment (1.0 multiplier)", () => {
    const noAttachment = score("Tricep Pushdown", 40, null);
    const rope = score("Tricep Pushdown", 40, "rope"); // rope is tricepPushdown's 1.0 baseline
    expect(noAttachment.score).toBe(rope.score);
  });

  it("the same lat pulldown weight scores higher on a single handle than a wide bar (less weight is achievable per side)", () => {
    const wideBar = score("Lat Pulldown", 60, "wide-bar");
    const singleHandle = score("Lat Pulldown", 60, "single-handle");
    expect(singleHandle.score).toBeGreaterThan(wideBar.score);
  });

  it("an unrecognized attachment id is ignored (no adjustment), not an error", () => {
    const unknown = score("Tricep Pushdown", 40, "some-made-up-attachment");
    const rope = score("Tricep Pushdown", 40, "rope");
    expect(unknown.score).toBe(rope.score);
  });

  it("exercises with no defined attachment options ignore the attachment field entirely", () => {
    const withAttachment = score("Bench Press", 100, "rope");
    const without = score("Bench Press", 100, null);
    expect(withAttachment.score).toBe(without.score);
  });

  it("flags the result when an attachment adjustment was actually applied", () => {
    const straightBar = score("Tricep Pushdown", 40, "straight-bar");
    expect(straightBar.flags).toContain("attachment-adjusted");
    const rope = score("Tricep Pushdown", 40, "rope");
    expect(rope.flags).not.toContain("attachment-adjusted"); // baseline (1.0) — nothing to flag
  });

  it("getAttachmentOptionsByKey exposes real options for the exercises this covers", () => {
    expect(getAttachmentOptionsByKey("tricepPushdown")?.map((a) => a.id)).toEqual([
      "rope",
      "straight-bar",
      "v-bar",
    ]);
    expect(getAttachmentOptionsByKey("bench")).toBeNull();
  });

  it("resolveAttachmentMultiplierByKey falls back to 1.0 for unknown key/attachment combos", () => {
    expect(resolveAttachmentMultiplierByKey("bench", "rope")).toBe(1.0);
    expect(resolveAttachmentMultiplierByKey("tricepPushdown", null)).toBe(1.0);
    expect(resolveAttachmentMultiplierByKey("tricepPushdown", "nonsense")).toBe(1.0);
  });
});
