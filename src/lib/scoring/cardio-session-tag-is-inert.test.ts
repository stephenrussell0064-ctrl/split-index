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
 * A NOTE ON THE NO-HEART-RATE CASE, REVISED 21 Sep 2026.
 *
 * The tag was inert there too, and crediting it was tried and reverted the
 * same day: a tagged session was compared against the athlete's own history,
 * most of which is untagged, so tagging one run "easy" lifted its PERSONAL
 * score by roughly 350 points. Farmable, and exactly the failure the model
 * exists to remove.
 *
 * It is now credited, but only where that failure cannot occur. The rule is
 * narrower than "the tag counts":
 *
 *   - with a heart rate, or an RPE, the tag is never consulted at all;
 *   - with neither, it supplies a last-resort effort estimate to the
 *     POPULATION score, at 0.7 confidence;
 *   - it never marks a session as effort-read, so the PERSONAL score still
 *     compares it pace-against-pace with the rest of the log — which is the
 *     comparison that broke, and the reason 350 points cannot recur.
 *
 * The assumed fractions sit at the hard end of each tag's plausible band, so
 * the error the tag can introduce costs an honest athlete a little credit
 * rather than handing a dishonest one a dial.
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

  it("is still inert for the PERSONAL score with no heart rate and no RPE", () => {
    // The 350-point failure, pinned. History is untagged and HR-less, so every
    // tag must compare pace-against-pace and land on the same personal score.
    const scoredAt = "2026-06-01T07:00:00Z";
    const history = [320, 325, 318, 330, 322].map((pace, i) => ({
      distanceMeters: 8000,
      durationSeconds: 8 * pace,
      // Inside the comparison window and BEFORE the session being scored. An
      // earlier version of this test dated the history two months before a
      // session dated "now", so every tag returned null and the assertion
      // passed against a set of nulls. Verified by mutation this time: with
      // the guard removed, "easy" reads 870 against 669 for "race".
      startedAt: new Date(Date.parse(scoredAt) - (i + 1) * 4 * 86_400_000).toISOString(),
    }));
    const personal = TAGS.map(
      (sessionType) =>
        scoreCardioActivity(run({ sessionType, startedAt: scoredAt, recentSessions: history }))
          .personalScore
    );
    expect(personal.every((p) => p != null)).toBe(true);
    expect(new Set(personal).size).toBe(1);
  });

  it("lets the tag inform the POPULATION score only when nothing measured the session", () => {
    // The new behaviour, and the reason it is safe: this is the one score with
    // no comparison in it, so an estimate cannot beat anyone else's measurement.
    const scores = scoresAcrossEveryTag({});
    expect(new Set(scores).size).toBeGreaterThan(1);

    // Ordered the way the tags are: a session claimed easy implies a faster
    // maximal effort than the same split claimed as a race.
    const easy = scoreCardioActivity(run({ sessionType: "easy" })).populationScore;
    const tempo = scoreCardioActivity(run({ sessionType: "tempo" })).populationScore;
    const race = scoreCardioActivity(run({ sessionType: "race" })).populationScore;
    expect(easy).toBeGreaterThan(tempo);
    expect(tempo).toBeGreaterThan(race);

    // And an untagged session is never worse off than the hardest tag — no
    // assumption beats a bad assumption.
    const untagged = scoreCardioActivity(run({ sessionType: null })).populationScore;
    expect(untagged).toBeGreaterThanOrEqual(race!);
  });

  it("says so in its confidence — an estimate is not a measurement", () => {
    const tagged = scoreCardioActivity(run({ sessionType: "easy" }));
    const measured = scoreCardioActivity(run({ avgHR: 145, sessionType: "easy" }));
    expect(tagged.confidence!).toBeLessThan(measured.confidence!);
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
