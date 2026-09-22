import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DiagnosticReport } from "./diagnostic-report";
import { EMPHASIS_KEYS } from "@/lib/scoring/hpe/constants";
import type { AthleteProfile, EmphasisVector, Finding } from "@/lib/scoring/hpe";

/**
 * The emphasis blurb is a CLAIM ABOUT THE BARS BESIDE IT, and the screen is
 * the product's share-and-screenshot moment. It used to assert that every
 * weight "moved because of something in your own logged history — the findings
 * below say which", which is true of a well-logged athlete and false of a
 * beginner: measured across the five personas, the marathon runner has 7
 * findings and a 0.63 spread, while a complete beginner has 0 findings and a
 * spread of exactly 0. That athlete was shown seven identical bars, no
 * findings list, and a sentence describing neither.
 *
 * So the branch that matters is the empty one — the state nobody demos.
 */

function vector(overrides: Partial<EmphasisVector> = {}): EmphasisVector {
  const even = 1 / EMPHASIS_KEYS.length;
  return { ...(Object.fromEntries(EMPHASIS_KEYS.map((k) => [k, even])) as EmphasisVector), ...overrides };
}

function profile(findings: Finding[], emphasis: EmphasisVector): AthleteProfile {
  return {
    constantsVersion: "test",
    tier: findings.length > 0 ? 3 : 0,
    confidence: 0.5,
    emphasis,
    findings,
    oneRms: {},
    liftRatios: {},
    stalledLifts: [],
    dataGaps: [],
  } as unknown as AthleteProfile;
}

const html = (p: AthleteProfile) => renderToStaticMarkup(<DiagnosticReport profile={p} />);

describe("the emphasis blurb describes the bars actually on screen", () => {
  it("claims nothing moved when the diagnosis found nothing", () => {
    // A complete beginner: tier 0, no findings, seven identical weights.
    const out = html(profile([], vector()));
    expect(out).toMatch(/Nothing has moved them yet/);
    // The promise that broke it. It must not appear over an empty findings list.
    expect(out).not.toMatch(/the findings below say which/);
  });

  it("points at the findings once there are findings to point at", () => {
    const out = html(
      profile(
        [{ id: "low-volume", text: "Weekly running volume is 62% of what typically supports this 5k level." }],
        vector({ aerobic_base: 0.4 })
      )
    );
    expect(out).toMatch(/the findings below say which/);
    expect(out).not.toMatch(/Nothing has moved them yet/);
  });

  it("never promises that EVERY weight moved — only the ones that did", () => {
    // The rower's shape: one finding, and a spread of 0.054 across seven
    // weights. Six of them are essentially untouched, so "every one of them
    // moved" is false here too even though the findings list is non-empty.
    const out = html(profile([{ id: "under-built", text: "Rep-profile gap." }], vector({ strength_endurance: 0.2 })));
    expect(out).toMatch(/the ones that\s+moved/);
    expect(out).not.toMatch(/every one of them\s+moved/i);
  });
});
