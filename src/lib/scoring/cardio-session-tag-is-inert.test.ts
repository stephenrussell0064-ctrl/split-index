import { describe, expect, it } from "vitest";
import { scoreCardioActivity, type CardioInput } from "./cardio-activity";
import type { SessionType } from "@/types";

/**
 * A mistagged session must not be rewarded for the mistake.
 *
 * The request, verbatim: "if an activity is logged as easy, this should not
 * mean that the user will score much higher for their activity even if their
 * heart rate is the equivalent of being race pace, as this means that they may
 * have logged it incorrectly".
 *
 * This is the two-score model's founding rule — heart rate is evidence of what
 * a session cost, the tag is a statement of what it was meant to be, and the
 * evidence wins. It held when this test was written; the test exists because
 * the old engine had an entire stack of credits keyed off that tag, the scores
 * it produced were indistinguishable from each other, and the way back to that
 * is one plausible-looking commit.
 *
 * A NOTE ON THE NO-HEART-RATE CASE. The tag is inert there too, and that is
 * deliberate rather than unfinished. Crediting it when nothing measured the
 * session was tried and reverted on 21 Sep 2026: a tagged session is compared
 * against the athlete's own history, most of which is untagged, so tagging one
 * run "easy" lifted its personal score by roughly 350 points — farmable, and
 * exactly the failure the model was built to remove. RPE already covers "no
 * heart rate, but I know how hard it was", with finer resolution and the same
 * honesty about being self-reported.
 */

const TAGS: (SessionType | null)[] = ["easy", "recovery", "long", "tempo", "race", null];

function run(overrides: Partial<CardioInput>): CardioInput {
  return {
    type: "run",
    benchmarkSport: "run",
    distanceMeters: 8000,
    durationSeconds: 8 * 300, // 5:00/km
    sex: "male",
    age: 30,
    maxHR: 190,
    restingHR: 50,
    ...overrides,
  } as CardioInput;
}

function scoresAcrossEveryTag(overrides: Partial<CardioInput>): number[] {
  return TAGS.map((sessionType) => scoreCardioActivity(run({ ...overrides, sessionType })).populationScore);
}

describe("the session tag cannot move the score", () => {
  it.each([
    ["deep easy", 130],
    ["steady", 150],
    ["threshold", 165],
    ["race effort", 178],
    ["maximal", 188],
  ])("is inert at %s heart rate (%i bpm)", (_label, avgHR) => {
    const scores = scoresAcrossEveryTag({ avgHR });
    expect(
      new Set(scores).size,
      `tagging changed the score at ${avgHR} bpm: ${scores.join(", ")}`
    ).toBe(1);
  });

  it("is inert when the session carries an RPE instead", () => {
    expect(new Set(scoresAcrossEveryTag({ rpe: 8 })).size).toBe(1);
  });

  it("is inert with no heart rate and no RPE either", () => {
    expect(new Set(scoresAcrossEveryTag({})).size).toBe(1);
  });

  /**
   * The specific case in the report: the same run, one honestly labelled and
   * one mislabelled, at a heart rate that says it was hard.
   */
  it("gives a run mistagged 'easy' at race heart rate no advantage over one tagged 'race'", () => {
    const mistagged = scoreCardioActivity(run({ avgHR: 178, sessionType: "easy" }));
    const honest = scoreCardioActivity(run({ avgHR: 178, sessionType: "race" }));
    expect(mistagged.populationScore).toBe(honest.populationScore);
    expect(mistagged.personalScore).toBe(honest.personalScore);
  });

  /**
   * And the other half, which is what makes the rule worth having: a session
   * that genuinely WAS easy scores far higher, because holding the same pace
   * at a much lower heart rate implies much more fitness. The engine rewards
   * the heart rate, never the label.
   */
  it("rewards a genuinely easy run — the same pace at a much lower heart rate", () => {
    const genuine = scoreCardioActivity(run({ avgHR: 130, sessionType: "easy" })).populationScore;
    const hard = scoreCardioActivity(run({ avgHR: 178, sessionType: "easy" })).populationScore;
    expect(genuine).toBeGreaterThan(hard + 100);
  });
});
