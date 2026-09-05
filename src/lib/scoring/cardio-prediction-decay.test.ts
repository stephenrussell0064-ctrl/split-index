import { describe, expect, it } from "vitest";
import {
  applyDecay,
  explainStoredPrediction,
  effectiveStoredPrediction,
  updatePrediction,
  confidenceWeightedImproveRate,
  IMPROVE_RATE,
  PREDICTION_DECAY,
} from "./cardio-predictions";

/**
 * The reported "my 5k prediction drifted 18:25 -> 18:50 and the app is broken"
 * case. The athlete confirmed a genuine gap in training, so the decay was
 * working as designed and is deliberately NOT weakened here. What these tests
 * pin is the two things that were actually worth establishing: that the rate
 * is proportionate, and that the athlete can now be told why.
 */
const FIVE_K = 18 * 60 + 25; // 1105s — the athlete's real, raced 5k

describe("prediction decay — is the rate proportionate?", () => {
  /**
   * Real detraining is slow at first: VO2max is largely preserved for the
   * first week or two of inactivity, with measurable loss appearing from
   * around weeks 2-4. The 14-day grace plus 1.5%/week encodes exactly that
   * shape, and lands at the conservative end of it.
   */
  it("costs nothing at all for a 1- or 2-week gap", () => {
    expect(applyDecay(FIVE_K, 7, 0)).toBe(FIVE_K);
    expect(applyDecay(FIVE_K, 14, 0)).toBe(FIVE_K);
  });

  it("charges about 3% for a 4-week gap — the conservative end of the detraining literature", () => {
    const fourWeeks = applyDecay(FIVE_K, 28, 0);
    expect(fourWeeks / FIVE_K - 1).toBeCloseTo(0.03, 3);
    expect(Math.round(fourWeeks - FIVE_K)).toBe(33); // 18:25 -> 18:58
  });

  it("reproduces the reported 18:25 -> 18:50 at the gap length it implies (~25 days)", () => {
    // Not a coincidence to be explained away — this is what ~3.5 weeks off
    // costs, and it is the correct order of magnitude for that gap.
    expect(applyDecay(FIVE_K, 24.75, 0)).toBeGreaterThanOrEqual(18 * 60 + 50);
    expect(applyDecay(FIVE_K, 21, 0)).toBeLessThan(18 * 60 + 50);
  });

  it("is bounded — a long layoff cannot run away with the prediction", () => {
    const forever = applyDecay(FIVE_K, 10_000, 10_000);
    expect(forever).toBe(FIVE_K * (1 + PREDICTION_DECAY.maxDecayInactive));
    expect(applyDecay(FIVE_K, 365, 0)).toBe(forever); // already capped
  });
});

describe("prediction decay — can the athlete tell why it moved?", () => {
  const now = new Date("2026-09-05T12:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

  it("says nothing when nothing was applied", () => {
    const r = explainStoredPrediction(FIVE_K, daysAgo(3), daysAgo(3), now);
    expect(r.reason).toBe("none");
    expect(r.addedSeconds).toBe(0);
    expect(r.explanation).toBeNull();
  });

  it("names the cause, the cost and the gap for an inactivity decay", () => {
    const r = explainStoredPrediction(FIVE_K, daysAgo(25), daysAgo(25), now);
    expect(r.reason).toBe("inactivity");
    expect(r.daysSinceRun).toBeCloseTo(25, 5);
    expect(Math.round(r.addedSeconds)).toBe(26);
    expect(r.explanation).toBe(
      "Eased back 26s after 25 days without a session — it recovers as you train again."
    );
  });

  it("distinguishes 'training, but nothing hard' from 'not training at all'", () => {
    const r = explainStoredPrediction(FIVE_K, daysAgo(2), daysAgo(120), now);
    expect(r.reason).toBe("no-quality");
    expect(r.explanation).toContain("without a hard effort");
  });

  it("drops the 'it recovers' promise once the decay is pinned at its ceiling", () => {
    const r = explainStoredPrediction(FIVE_K, daysAgo(400), daysAgo(400), now);
    expect(r.atCap).toBe(true);
    expect(r.explanation).not.toContain("recovers as you train");
  });

  /** The explanation must describe the number actually used, never a second calculation of it. */
  it("agrees exactly with effectiveStoredPrediction", () => {
    for (const d of [0, 7, 14, 20, 25, 40, 200, 400]) {
      expect(explainStoredPrediction(FIVE_K, daysAgo(d), daysAgo(d), now).seconds).toBe(
        effectiveStoredPrediction(FIVE_K, daysAgo(d), daysAgo(d), now)
      );
    }
  });
});

/**
 * Decaying UP quickly while recovering DOWN slowly would be the genuinely
 * wrong combination, so the relationship is pinned rather than assumed.
 *
 * Today it is safe, but for a reason worth writing down: no production call
 * site passes `sampleCount` into the blend context (checked across
 * api/activities, api/activities/recompute, lib/activities/score-and-persist
 * and cardio/race-prediction), so `confidenceWeightedImproveRate` receives
 * undefined and returns the flat IMPROVE_RATE. The stickiness mechanism is
 * implemented and dormant, not active.
 *
 * If someone wires sample_count through — which its own doc comment intends —
 * recovery drops to 12% of the gap per session and this asymmetry becomes
 * real. The second test below is what should fail and force that conversation.
 */
describe("prediction decay — does returning to training recover it sensibly?", () => {
  /** ~25 days off: what the athlete came back to. */
  const decayed = applyDecay(FIVE_K, 25, 0);

  it("recovers faster than it decayed, on the path production actually runs", () => {
    expect(confidenceWeightedImproveRate(undefined)).toBe(IMPROVE_RATE);

    // Sessions that project to the athlete's true 18:25 fitness.
    let stored = decayed;
    stored = updatePrediction(stored, FIVE_K);
    // One session already claws back more than half of a 3.5-week decay...
    expect(stored - FIVE_K).toBeLessThan((decayed - FIVE_K) / 2);

    for (let i = 0; i < 3; i++) stored = updatePrediction(stored, FIVE_K);
    // ...and four are enough to be back within a couple of seconds.
    expect(stored - FIVE_K).toBeLessThan(3);
  });

  it("would NOT recover sensibly if sample_count were wired through unchanged", () => {
    // Documents the latent trap rather than leaving it to be discovered.
    let stored = decayed;
    for (let i = 0; i < 4; i++) stored = updatePrediction(stored, FIVE_K, { sampleCount: 30 });
    // Four sessions back at full fitness still leave most of the decay in
    // place — decay up over 3.5 weeks, recovery over more than a month.
    expect(stored - FIVE_K).toBeGreaterThan((decayed - FIVE_K) / 2);
  });
});
