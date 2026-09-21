import { describe, expect, it } from "vitest";
import { scoreStrength } from "./split-strength-engine";

/**
 * TYPING NONSENSE MUST NOT REACH THE TOP OF THE STRENGTH SCALE.
 *
 * A free-text exercise name that matches nothing in the catalogue falls through
 * to `DEFAULT_GENERIC_ANCHOR` — a ratio of 0.35, meaning "0.35 x bodyweight
 * scores 500". That is a deliberately soft standard for a movement nobody can
 * identify, and against an uncapped curve it meant ANY invented string scored
 * 999 "World Class" at an ordinary load. Measured before the cap, 80 kg lifter,
 * one exercise at 100 kg x 5: an unknown 500-character name, an emoji name and
 * a name containing newlines all scored 999 — and the leaderboards read these
 * numbers directly.
 *
 * The cap is what a generic anchor actually supports. It is a guess at a
 * standard, so it may say "this is a solid lift" and may not say "this is among
 * the best in the world".
 */

const LIFTER = { bodyweightKg: 80, sex: "male" as const, age: 30, isPremium: true };

function score(liftKey: string, weightKg: number, reps: number) {
  return scoreStrength({
    ...LIFTER,
    liftKey,
    history: [],
    latestSet: { weightKg, reps },
  });
}

describe("an exercise the engine cannot identify", () => {
  it.each([
    ["a name nobody has ever used", "Zorbling Cable Thrust"],
    ["an emoji name", "🏋️‍♂️💀"],
    ["a name with newlines in it", "squat\n\n\nDROP TABLE"],
    ["a very long name", "x".repeat(300)],
  ])("cannot be scored world class — %s", (_label, name) => {
    const result = score(name, 100, 5);
    expect(result.score).toBeLessThanOrEqual(724);
    expect(result.tier).not.toBe("World Class");
    expect(result.tier).not.toBe("Elite");
  });

  it("says why, so the number is not silently different from what it looks like", () => {
    const result = score("Zorbling Cable Thrust", 100, 5);
    expect(result.flags).toContain("estimated-generic-standard");
    expect(result.flags).toContain("capped-unrecognised-exercise");
  });

  it("still scores an ordinary effort on an unknown movement normally", () => {
    // The cap is a ceiling, not a penalty: below it nothing changes, so an
    // athlete logging a genuine accessory the catalogue has never heard of
    // still gets a number that moves with their training.
    const light = score("Zorbling Cable Thrust", 20, 5);
    const heavier = score("Zorbling Cable Thrust", 40, 5);
    expect(light.score).toBeGreaterThan(0);
    expect(heavier.score).toBeGreaterThan(light.score);
    expect(heavier.flags).not.toContain("capped-unrecognised-exercise");
  });
});

describe("a calibrated lift is untouched by the cap", () => {
  it("can still reach the top of the scale", () => {
    // The whole point of separating these: a real, anchored barbell lift at a
    // genuinely exceptional load must still be able to say so.
    const exceptional = score("Back Squat", 300, 1);
    expect(exceptional.score).toBeGreaterThan(724);
    expect(exceptional.flags).not.toContain("capped-unrecognised-exercise");
  });

  it("scores a normal calibrated lift where it always did", () => {
    const ordinary = score("Back Squat", 100, 5);
    expect(ordinary.score).toBeGreaterThan(0);
    expect(ordinary.flags).not.toContain("estimated-generic-standard");
  });
});
