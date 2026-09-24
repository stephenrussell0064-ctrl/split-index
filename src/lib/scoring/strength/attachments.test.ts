import { describe, expect, it } from "vitest";
import { scoreStrength, type ScoreStrengthInput } from "../split-strength-engine";
import {
  getAttachmentOptionsByKey,
  getAttachmentPickerLabel,
  resolveAttachmentMultiplierByKey,
} from "./attachments";

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

/**
 * LEG PRESS MACHINE TYPE.
 *
 * The same mechanism, a different noun, and by far the largest adjustment in
 * the file. The anchors are Strength Level's, which are overwhelmingly
 * 45-degree plate-loaded sleds logged as plate load; on such a sled the force
 * along the rail is only W x sin(45) = 0.707W, so a horizontal stack machine
 * at 163 kg and an angled sled at 230 kg are the same effort.
 *
 * Scoring the two identically read a seated machine as roughly a third weaker
 * than the athlete is. A real session: leg press 313 against a squat of 582
 * logged the same day, when a leg press is normally 1.5-2x a squat.
 */
describe("scoreStrength — leg press machine type", () => {
  const options = getAttachmentOptionsByKey("legPress")!;

  it("offers the three machine types, with the 45° sled as the calibrated baseline", () => {
    expect(options.map((o) => o.id)).toEqual(["sled-45", "horizontal", "vertical"]);
    expect(options.find((o) => o.id === "sled-45")!.anchorMultiplier).toBe(1);
  });

  it("carries the sin(45°) geometry rather than a round guess", () => {
    // 0.71 is 163/230 — Strength Level's median sled load resolved along the
    // rail. If this ever becomes a round 0.75 or 0.7, the derivation has been
    // lost and the comment above is no longer true.
    expect(resolveAttachmentMultiplierByKey("legPress", "horizontal")).toBeCloseTo(0.71, 2);
  });

  it("scores the same weight higher on a seated machine than on an angled sled", () => {
    const sled = score("Leg Press", 110, "sled-45");
    const horizontal = score("Leg Press", 110, "horizontal");
    const vertical = score("Leg Press", 110, "vertical");
    expect(horizontal.score).toBeGreaterThan(sled.score);
    expect(vertical.score).toBeGreaterThan(horizontal.score);
  });

  /*
    The whole existing corpus has attachment = null. If that did not mean
    exactly "45° sled", shipping this picker would silently re-score every leg
    press ever logged — and the first anyone would know is their index moving
    for no reason they did anything about.
  */
  it("leaves every already-logged leg press exactly where it is", () => {
    expect(score("Leg Press", 110, null).score).toBe(score("Leg Press", 110, "sled-45").score);
  });

  it("calls the picker Machine for a leg press and Attachment for a cable", () => {
    expect(getAttachmentPickerLabel("legPress")).toBe("Machine");
    expect(getAttachmentPickerLabel("tricepPushdown")).toBe("Attachment");
    expect(getAttachmentPickerLabel("somethingWithNoOptions")).toBe("Attachment");
  });

  it("every machine type has a distinct icon, so the picker is not three identical chips", () => {
    expect(new Set(options.map((o) => o.icon)).size).toBe(options.length);
  });
});
