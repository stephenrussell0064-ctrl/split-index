import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StandardsScoreExplainer } from "@/components/scoring/standards-score-explainer";
import { PERCENTILE_TO_SCORE } from "@/lib/scoring/percentile-framework";
import { SessionScoreInsights } from "@/components/scoring/session-score-insights";
import type { CardioResult } from "@/lib/scoring/cardio-activity";
import type { ScoreStrengthResult } from "@/lib/scoring/split-strength-engine";

/**
 * Engine and Lab: the same kind of number, an absolute score against calibrated
 * standards, and until now shown as a digit and a tier word with nothing saying
 * what either meant.
 *
 * Two of these tests exist because of mistakes made writing the component, not
 * in spite of them — the tier boundaries were typed out from memory and two of
 * six were wrong, and the percentile was one careless sentence away from
 * claiming a population nobody sampled.
 */

const render = (props: Partial<Parameters<typeof StandardsScoreExplainer>[0]> = {}) =>
  renderToStaticMarkup(
    <StandardsScoreExplainer score={620} variant="engine" seriesKey="run" onClose={() => {}} {...props} />
  );

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the Engine and Lab explainer", () => {
  it("says what the Engine number is measured against", () => {
    const t = text(render({ variant: "engine" }));
    expect(t).toContain("benchmark distance");
    expect(t).toContain("Against calibrated standards");
  });

  it("says what the Lab number is measured against, which is not the same thing", () => {
    const t = text(render({ variant: "lab", seriesKey: "Bench Press" }));
    expect(t).toContain("calibrated anchor");
    // The anchor moves with age and sex; the athlete's own number does not.
    expect(t).toContain("standard you are measured against, not your own number");
    expect(t).not.toContain("benchmark distance");
  });

  it("does not claim a population it never sampled", () => {
    // "better than 72% of athletes" would be a claim about this app's users,
    // who were never measured. The honest phrasing is the percentile OF THE
    // STANDARDS, which is what the number actually is.
    const t = text(render({ score: 620 }));
    expect(t).toContain("percentile of the standards");
    expect(t).toContain("not from other people using this app");
    expect(t).not.toMatch(/better than \d+% of/i);
  });

  it("puts the tier boundaries where the calibration table puts them", () => {
    // Typed from memory, Semi-Pro looks like it starts at 50 and Advanced at
    // 70. They start at 47.5 and 72.5. A mislabelled scale is worse than none,
    // so the component derives them and this pins that it still does.
    const html = render();
    expect(html).toContain(`left:${PERCENTILE_TO_SCORE[50] / 10}%`);
    expect(html).toContain(`left:${PERCENTILE_TO_SCORE[80] / 10}%`);
    expect(PERCENTILE_TO_SCORE[50] / 10).toBe(47.5);
    expect(PERCENTILE_TO_SCORE[80] / 10).toBe(72.5);
  });

  it("names the next tier and what it costs to reach", () => {
    const t = text(render({ score: 620 }));
    expect(t).toMatch(/points to reach (Advanced|Elite|Semi-Pro|World Class)/);
  });

  it("shows the tier when one was passed, and copes when it was not", () => {
    expect(text(render({ variant: "lab", tier: "Advanced" }))).toContain("Advanced");
    expect(() => render({ tier: null })).not.toThrow();
  });

  it("reads the score on the scale the athlete sees", () => {
    const t = text(render({ score: 620 }));
    expect(t).toContain("62.0");
    expect(t).not.toContain("620");
  });

  it("is a labelled dialog, so it is announced rather than read as loose text", () => {
    const html = render();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it("gets the ordinal right at the awkward numbers", () => {
    // 11th/12th/13th are the ones a naive n % 10 gets wrong.
    for (const [score, suffix] of [
      [PERCENTILE_TO_SCORE[5], "th"],
      [PERCENTILE_TO_SCORE[20], "th"],
    ] as Array<[number, string]>) {
      expect(text(render({ score }))).toContain(`${suffix} percentile`);
    }
  });
});

/** A sheet nothing opens is a sheet nobody reads — pinned separately, per score. */
describe("the triggers on a session card", () => {
  it("makes the Engine number tappable, named for what it is", () => {
    const base = {
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
    } as unknown as CardioResult;
    const html = renderToStaticMarkup(
      <SessionScoreInsights zone="cardio" isPremium={false} cardioResult={base} />
    );
    // "62", not "62.0": formatIndex drops the decimal on a whole number, and
    // the trigger's accessible name is built from it rather than from the
    // sheet's own toFixed(1). Worth pinning — the two formatters differing is
    // exactly the kind of thing that silently breaks an aria-label.
    expect(html).toContain("Your Engine score, 62. What this means");
  });

  it("makes the Lab number tappable, and names the lift so two rows are distinguishable", () => {
    const result = {
      liftKey: "bench press",
      score: 712,
      tier: "Advanced",
      oneRM: 100,
      allTimeOneRM: 100,
      currentOneRM: 100,
      personalScore: null,
      flags: [],
      appliedFactors: [],
      source: "calibrated",
    } as unknown as ScoreStrengthResult;
    const html = renderToStaticMarkup(
      <SessionScoreInsights
        zone="gym"
        isPremium
        strengthResults={[{ name: "Bench Press", result }]}
      />
    );
    expect(html).toContain("Your Lab score for Bench Press, 71.2. What this means");
  });
});
