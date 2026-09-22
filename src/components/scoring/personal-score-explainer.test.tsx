import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonalScoreExplainer } from "@/components/scoring/personal-score-explainer";
import { SessionScoreInsights } from "@/components/scoring/session-score-insights";
import type { CardioPersonalComparison, CardioResult } from "@/lib/scoring/cardio-activity";

/**
 * The sheet exists to answer two questions that were actually asked of a live
 * score, by the person who commissioned the app:
 *
 *   "does it average at 50?"
 *   "why is my easy run at 4:55/km scoring 29.7, is this really that much
 *    worse than my median run?"
 *
 * Both answers were already inside `CardioPersonalComparison` and rendered
 * nowhere. These tests pin the two sentences that answer them, because copy
 * that explains a number is exactly the kind of thing a later tidy-up deletes
 * for being wordy — and the number goes back to meaning nothing.
 *
 * `renderToStaticMarkup` rather than a DOM library, matching
 * age-adjustment-readout.test.tsx: the repo carries no jsdom or RTL. Effects do
 * not run under SSR, which is fine — every assertion here is about what is on
 * the page, not about focus or keyboard behaviour.
 */

const comparison = (over: Partial<CardioPersonalComparison> = {}): CardioPersonalComparison => ({
  baselineEquivalentSeconds: 1140,
  bestEquivalentSeconds: 1102,
  deltaPct: -4.2,
  sampleCount: 5,
  comparedWith: "effort-matched",
  intensityMatch: 0.81,
  ...over,
});

const render = (score: number, c: CardioPersonalComparison | null = comparison()) =>
  renderToStaticMarkup(
    <PersonalScoreExplainer score={score} comparison={c} onClose={() => {}} />
  );

/** Strip tags so assertions read prose rather than fight markup boundaries. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the personal score explainer", () => {
  it("states where the middle of the scale is, before anything else", () => {
    expect(text(render(297))).toContain("50 is your normal");
  });

  it("says that half of all sessions sit below the middle, so a low one is not a failure", () => {
    // The median guarantees this and no amount of tuning changes it. Saying so
    // is the difference between "I had an ordinary day" and "this app hates me".
    expect(text(render(297))).toContain("Half your sessions");
  });

  it("answers the real question: it is not measured against your median session", () => {
    const t = text(render(297));
    expect(t).toContain("at a similar heart rate");
    expect(t).toContain("not your median session");
  });

  it("names how many sessions it actually compared against", () => {
    expect(text(render(297, comparison({ sampleCount: 5 })))).toContain("5");
    expect(text(render(297, comparison({ sampleCount: 1 })))).toContain("session");
  });

  it("says so plainly when it fell back to pace, rather than implying heart rate was used", () => {
    const t = text(render(480, comparison({ comparedWith: "pace-only" })));
    expect(t).toContain("on pace alone");
    expect(t).not.toContain("at a similar heart rate");
  });

  it("warns when the comparison had to reach across intensities", () => {
    const t = text(render(297, comparison({ intensityMatch: 0.1 })));
    expect(t).toContain("not trained at this heart rate lately");
  });

  it("does not warn when the compared sessions were genuinely alike", () => {
    expect(text(render(297, comparison({ intensityMatch: 0.81 })))).not.toContain(
      "not trained at this heart rate lately"
    );
  });

  it("reads the session back on the scale the athlete sees, not the stored one", () => {
    // 297 stored is 29.7 displayed. Showing 297 here would reintroduce the
    // confusion the sheet exists to remove.
    const t = text(render(297));
    expect(t).toContain("29.7");
    expect(t).not.toContain("297");
  });

  it("is a labelled dialog, so it is announced rather than read as loose text", () => {
    const html = render(297);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("still explains the scale when there is no comparison to show", () => {
    const t = text(render(500, null));
    expect(t).toContain("50 is your normal");
  });
});

/**
 * A sheet nothing opens is a sheet nobody reads, so the trigger is pinned too —
 * separately from the sheet, because they fail independently.
 */
function renderCardio(over: Partial<CardioResult>, isPremium = false): string {
  const base: CardioResult = {
    score: 620,
    paceScore: 620,
    populationScore: 620,
    personalScore: null,
    personal: null,
    fitnessEquivalentSeconds: null,
    adjustments: null,
    executionScore: 600,
    vo2max: 48,
    vo2maxMethod: "pace-estimate",
    trimp: 112,
    efficiencyFactor: 0.84,
    decouplingPct: 3.1,
    predictions: null,
    confidence: 0.9,
    flags: [],
  };
  return renderToStaticMarkup(
    <SessionScoreInsights zone="cardio" isPremium={isPremium} cardioResult={{ ...base, ...over }} />
  );
}

describe("the trigger on the session card", () => {
  it("makes the number a button, with a name that says what tapping it does", () => {
    const html = renderCardio({ personalScore: 297, personal: comparison() });
    expect(html).toContain("<button");
    expect(html).toContain("Your score against yourself, 29.7. What this means");
  });

  it("is there for a paying athlete too, who reaches it through a different block", () => {
    // CardioPremiumStats nests CardioFreeStats rather than replacing it. Pinned
    // because that is not obvious from either component, and a premium athlete
    // getting less explanation than a free one would be exactly backwards.
    const html = renderCardio({ personalScore: 297, personal: comparison() }, true);
    expect(html).toContain("Your score against yourself, 29.7. What this means");
  });

  it("leaves nothing to tap while the score is still calibrating", () => {
    // personalScore null is a real state — fewer than three comparable
    // sessions — and a button opening a sheet about a number that is not there
    // would be worse than no button.
    const html = renderCardio({ personalScore: null, personal: null });
    expect(html).not.toContain("What this means");
    expect(html).toContain("calibrating");
  });
});
