import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionScoreInsights } from "./session-score-insights";
import type { CardioResult } from "@/lib/scoring/cardio-activity";

/**
 * THE STORED ROW IS THE SHAPE THAT MATTERS, NOT THE FRESHLY SCORED ONE.
 *
 * The activity page does not re-score on read: `extractGatedCardioInsight`
 * casts `breakdown.cardio_activity` straight out of JSONB, and
 * `activity-scorer.ts` writes that blob at log and edit time only. So for
 * months the production shape is an interval session carrying
 * `flags: ["interval-work-piece-scored"]` and NO `workPiece` key at all.
 *
 * The readout replaces that slug. If the slug is suppressed unconditionally,
 * every already-logged interval session shows neither — the athlete loses the
 * only signal they had, and loses it precisely because we added a better one
 * they cannot see yet. Hiding the slug has to be conditional on having
 * something to hide it behind.
 */

function cardioResult(over: Partial<CardioResult> = {}): CardioResult {
  return {
    score: 700, paceScore: 700, populationScore: 700, personalScore: null, personal: null,
    fitnessEquivalentSeconds: null, adjustments: null, ageGradeFactor: null, executionScore: 80,
    vo2max: 50, vo2maxMethod: "pace-estimate", trimp: 100, efficiencyFactor: 1,
    decouplingPct: 1, predictions: null, confidence: 1, flags: [], workPiece: null,
    ...over,
  } as unknown as CardioResult;
}

/** What the database hands back for every interval logged before this field existed. */
function storedRowFromBeforeTheFeature(): CardioResult {
  const { workPiece: _omit, ...rest } = cardioResult({
    flags: ["interval-work-piece-scored"],
  }) as CardioResult & { workPiece?: unknown };
  void _omit;
  // No `workPiece` KEY, not `workPiece: null` — a cast out of JSONB cannot
  // invent one, and `"workPiece" in result` is the check that distinguishes them.
  return rest as unknown as CardioResult;
}

const render = (result: CardioResult) =>
  renderToStaticMarkup(<SessionScoreInsights zone="cardio" cardioResult={result} isPremium />);

describe("the work-piece readout replaces the slug without losing it", () => {
  it("shows the breakdown, and not the slug, on a freshly scored session", () => {
    const html = render(
      cardioResult({
        flags: ["interval-work-piece-scored"],
        workPiece: {
          kind: "interval",
          workPaceSecPerKm: 210,
          equivalentPaceSecPerKm: 232,
          sessionAvgPaceSecPerKm: 323,
        },
      })
    );
    expect(html).toMatch(/Scored on your reps/);
    expect(html).not.toMatch(/interval work piece scored/);
  });

  it("KEEPS the slug on a stored row that has no breakdown — the months-long case", () => {
    const html = render(storedRowFromBeforeTheFeature());
    // No readout, correctly — there is nothing to render it from.
    expect(html).not.toMatch(/Scored on your reps/);
    // But the athlete must not end up with NOTHING where they had something.
    expect(html).toMatch(/interval work piece scored/);
  });

  it("does the same for fartlek", () => {
    const { workPiece: _o, ...rest } = cardioResult({
      flags: ["fartlek-work-piece-scored"],
    }) as CardioResult & { workPiece?: unknown };
    void _o;
    expect(render(rest as unknown as CardioResult)).toMatch(/fartlek work piece scored/);
  });
});
