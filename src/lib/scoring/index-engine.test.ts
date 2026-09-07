import { describe, expect, it } from "vitest";
import { computeIndexes, type ActivityScore } from "./index-engine";

/**
 * The blend, and specifically what happens when an athlete takes up a second
 * discipline.
 *
 * Found by the UAT bots: the `sporadic` persona's headline moved 193 points on
 * one ordinary run. The cause was structural rather than a miscalculation —
 * with one side populated the headline WAS that side, and the moment the other
 * side logged its first session the headline jumped to the full configured
 * blend. One session of evidence was given the same weight as ten.
 *
 * Irregular loggers are the largest real cohort and the likeliest to cancel,
 * and a number that moves two hundred points on a normal Tuesday run reads as
 * invented.
 */

const at = (day: number) => new Date(Date.parse("2026-01-01T00:00:00Z") + day * 86_400_000).toISOString();

const session = (
  side: "lab" | "engine",
  score: number,
  day: number,
  confidence = 1
): ActivityScore => ({ side, score, confidence, date: at(day) });

describe("computeIndexes — a second discipline eases in", () => {
  it("uses the only populated side when there is just one", () => {
    const gymOnly = [0, 1, 2, 3, 4].map((d) => session("lab", 400, d));
    const result = computeIndexes(gymOnly, "hybrid", 0.5);

    expect(result.labIndex).toBe(400);
    expect(result.engineIndex).toBeNull();
    expect(result.headline).toBe(400);
  });

  it("does not lurch when the second side logs its first session", () => {
    const gymOnly = [0, 1, 2, 3, 4].map((d) => session("lab", 400, d));
    const before = computeIndexes(gymOnly, "hybrid", 0.5).headline;

    const plusOneRun = [...gymOnly, session("engine", 900, 5)];
    const after = computeIndexes(plusOneRun, "hybrid", 0.5).headline;

    // Under the old naive blend this was 400 → 650, a 250-point jump off a
    // single run. The number should move — a genuinely strong first run IS
    // information — but it must move like evidence arriving, not like a
    // different number replacing it.
    expect(after).toBeGreaterThan(before);
    expect(after - before).toBeLessThan(120);
  });

  it("converges on the configured weighting once both sides are established", () => {
    const mature: ActivityScore[] = [
      ...[0, 1, 2, 3, 4, 5].map((d) => session("lab", 400, d)),
      ...[6, 7, 8, 9, 10, 11].map((d) => session("engine", 900, d)),
    ];
    const result = computeIndexes(mature, "hybrid", 0.5);

    // Both sides fully evidenced, so this is the plain 50/50 the athlete asked
    // for: no residual damping once the ramp has done its job.
    expect(result.headline).toBe(650);
  });

  it("honours a non-even weight once both sides are established", () => {
    const mature: ActivityScore[] = [
      ...[0, 1, 2, 3, 4, 5].map((d) => session("lab", 400, d)),
      ...[6, 7, 8, 9, 10, 11].map((d) => session("engine", 900, d)),
    ];
    // weightLab 0.25 — an endurance-leaning athlete.
    expect(computeIndexes(mature, "hybrid", 0.25).headline).toBe(775);
  });

  it("ramps monotonically as the new side accumulates evidence", () => {
    const gym = [0, 1, 2, 3, 4, 5].map((d) => session("lab", 400, d));
    const headlines = [0, 1, 2, 3, 4, 5].map((runs) =>
      computeIndexes(
        [...gym, ...Array.from({ length: runs }, (_, i) => session("engine", 900, 6 + i))],
        "hybrid",
        0.5
      ).headline
    );

    // Rising, and never jumping more than the last step did by much — the
    // shape of evidence accruing rather than a switch flipping.
    for (let i = 1; i < headlines.length; i++) {
      expect(headlines[i]).toBeGreaterThanOrEqual(headlines[i - 1]);
    }
    expect(headlines[0]).toBe(400);
    expect(headlines[headlines.length - 1]).toBe(650);
  });

  it("counts low-confidence sessions as less evidence than solid ones", () => {
    const gym = [0, 1, 2, 3, 4, 5].map((d) => session("lab", 400, d));
    const solid = computeIndexes([...gym, session("engine", 900, 6, 1)], "hybrid", 0.5).headline;
    const shaky = computeIndexes([...gym, session("engine", 900, 6, 0.2)], "hybrid", 0.5).headline;

    // A session the engine itself is unsure about should move the headline
    // less than a well-evidenced one. `sideIndex` already weights by
    // confidence; the ramp uses the same signal rather than a raw count.
    expect(shaky).toBeLessThan(solid);
  });

  it("still returns a number for an athlete who has only ever logged one session", () => {
    const result = computeIndexes([session("lab", 361, 0)], "hybrid", 0.5);
    expect(result.headline).toBe(361);
    expect(result.splitIndex).toBe(361);
  });
});
