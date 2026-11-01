import { describe, expect, it } from "vitest";
import { scoreStrength, type ScoreStrengthInput } from "../split-strength-engine";
import {
  defaultAttachmentValue,
  encodeAttachmentValue,
  getArmModeOptions,
  getAttachmentOptions,
  getAttachmentOptionsByKey,
  getAttachmentPickerLabel,
  parseAttachmentValue,
  resolveAttachmentMultiplierByKey,
  SINGLE_LIMB_MULTIPLIER,
} from "./attachments";
import { resolveAnchorKey } from "../split-strength-engine";
import { COMMON_EXERCISES } from "@/lib/constants/sports";

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

/**
 * EQUIPMENT IS THE EXERCISE'S, NOT THE ANCHOR'S (1 Nov 2026).
 *
 * Owner: "Overhead tricep extension there is no dumbbell attachment but only
 * rope but surely this would just be for cable overhead tricep extension and
 * this needs to be checked for all exercises. Also the option should be
 * available for single arm or two arms for these kind of exercises."
 */
describe("attachment options by exercise name", () => {
  it("offers the overhead tricep extension a dumbbell, a bar and a cable — not the pushdown's rope/bar/V-bar", () => {
    const ids = getAttachmentOptions("Overhead Tricep Extension", resolveAnchorKey("Overhead Tricep Extension"))!.map(
      (o) => o.id
    );
    expect(ids).toEqual(["dumbbell", "ez-bar", "cable-rope", "cable-bar"]);
    expect(getAttachmentPickerLabel(resolveAnchorKey("Overhead Tricep Extension"), "Overhead Tricep Extension")).toBe(
      "Equipment"
    );
  });

  it("the cable overhead extension shares that equipment set and means the cable rope until told otherwise", () => {
    expect(defaultAttachmentValue("Cable Overhead Extension")).toBe("cable-rope");
    // Same kg: one dumbbell behind the head is a far harder lift than a rope
    // on a stack, so the untouched cable row must NOT score as a dumbbell.
    const dumbbell = score("Overhead Tricep Extension", 20, null, { exerciseName: "Overhead Tricep Extension" });
    const cable = score("Cable Overhead Extension", 20, null, { exerciseName: "Cable Overhead Extension" });
    expect(cable.score).toBeLessThan(dumbbell.score);
  });

  it("dumbbell and bodyweight movements that score on a cable anchor get no attachment picker", () => {
    for (const name of ["Dumbbell Kickback", "JM Press", "Dumbbell Row", "Inverted Row", "Face Pull", "Machine Row"]) {
      expect(getAttachmentOptions(name, resolveAnchorKey(name)), name).toBeNull();
    }
  });

  it("no catalogue exercise without a cable or a machine type offers a cable attachment", () => {
    // Every catalogue name that would show a picker, so a future alias that
    // lands a dumbbell movement on a cable anchor fails here, not in the app.
    const withPicker = COMMON_EXERCISES.filter((ex) =>
      getAttachmentOptions(ex.name, resolveAnchorKey(ex.name))
    ).map((ex) => ex.name);
    expect(withPicker.sort()).toEqual(
      [
        "Lat Pulldown",
        "Close Grip Lat Pulldown",
        "Seated Cable Row",
        "Single Arm Cable Row",
        "Leg Press",
        "Single Leg Press",
        "Cable Curl",
        "Bayesian Cable Curl",
        "Tricep Pushdown",
        "Rope Pushdown",
        "Overhead Tricep Extension",
        "Cable Overhead Extension",
        "Overhead Cable Extension",
      ].sort()
    );
  });

  it("a single arm cable row is the single handle before anyone taps it", () => {
    expect(defaultAttachmentValue("Single Arm Cable Row")).toBe("single-handle");
    const single = score("Single Arm Cable Row", 40, null, { exerciseName: "Single Arm Cable Row" });
    const twoArm = score("Seated Cable Row", 40, null, { exerciseName: "Seated Cable Row" });
    expect(single.score).toBeGreaterThan(twoArm.score);
  });
});

describe("single arm / single leg", () => {
  it("offers the choice on cable arm work and machine leg work, not on per-hand dumbbells or on sets with a single-handle chip", () => {
    expect(getArmModeOptions("Tricep Pushdown", "tricepPushdown")?.label).toBe("Arms");
    expect(getArmModeOptions("Leg Extension", "legExtension")?.label).toBe("Legs");
    expect(getArmModeOptions("Dumbbell Curl", "dbCurl")).toBeNull();
    expect(getArmModeOptions("Lat Pulldown", "latPulldown")).toBeNull();
    expect(getArmModeOptions("Bench Press", "bench")).toBeNull();
  });

  it("round-trips attachment and arm mode through one stored string, and a plain attachment is unchanged", () => {
    expect(encodeAttachmentValue("rope", null)).toBe("rope");
    expect(encodeAttachmentValue("rope", "single")).toBe("rope|single");
    expect(encodeAttachmentValue(null, "single")).toBe("|single");
    expect(encodeAttachmentValue(null, null)).toBeNull();
    expect(parseAttachmentValue("rope")).toEqual({ attachment: "rope", armMode: null });
    expect(parseAttachmentValue("rope|single")).toEqual({ attachment: "rope", armMode: "single" });
    expect(parseAttachmentValue("|single")).toEqual({ attachment: null, armMode: "single" });
    expect(parseAttachmentValue("rope|nonsense")).toEqual({ attachment: "rope", armMode: null });
  });

  it("one arm on the rope scores the same kg higher than two, by the single-arm pushdown ratio", () => {
    expect(resolveAttachmentMultiplierByKey("tricepPushdown", "rope|single")).toBeCloseTo(
      SINGLE_LIMB_MULTIPLIER,
      5
    );
    expect(resolveAttachmentMultiplierByKey("tricepPushdown", "straight-bar|single")).toBeCloseTo(
      1.12 * SINGLE_LIMB_MULTIPLIER,
      5
    );
    const two = score("Tricep Pushdown", 20, "rope");
    const one = score("Tricep Pushdown", 20, "rope|single");
    expect(one.score).toBeGreaterThan(two.score);
    expect(one.flags).toContain("attachment-adjusted");
  });

  it("a single-arm set logged per hand on a total-load anchor is not credited twice", () => {
    // Per-hand entry doubles the load before scoring (one arm's 20 kg
    // becomes 40). Against a single-arm anchor that is one arm counted
    // twice, so the multiplier doubles back: 2 x 0.55 = 1.1, not 0.55.
    expect(resolveAttachmentMultiplierByKey("tricepPushdown", "rope|single", null, true)).toBeCloseTo(
      2 * SINGLE_LIMB_MULTIPLIER,
      5
    );
    const perHand = score("Tricep Pushdown", 40, "rope|single", { weightEntryMode: "per_hand" });
    const total = score("Tricep Pushdown", 20, "rope|single", { weightEntryMode: "total" });
    expect(perHand.score).toBe(total.score);
  });

  it("the single-leg catalogue entries score one leg at a time without their own table", () => {
    expect(defaultAttachmentValue("Single Leg Extension")).toBe("|single");
    const single = score("Single Leg Extension", 40, null, { exerciseName: "Single Leg Extension" });
    const both = score("Leg Extension", 40, null, { exerciseName: "Leg Extension" });
    expect(single.score).toBeGreaterThan(both.score);
  });

  it("an arm mode on an exercise that does not offer one is ignored", () => {
    expect(resolveAttachmentMultiplierByKey("bench", "|single")).toBe(1.0);
    expect(score("Bench Press", 100, "|single").score).toBe(score("Bench Press", 100, null).score);
  });
});
