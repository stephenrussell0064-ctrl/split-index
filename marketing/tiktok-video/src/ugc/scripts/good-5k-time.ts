/**
 * Content gap: "what is a good 5k time for my age" (TikTok Creator Search Insights).
 *
 * Rough recreational benchmarks by age band, one rule (compare against your
 * own last one), then the real predicted race times (18:52) and the real
 * Engine session score, which the app grades against sex and age.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const DASH = "real/screens/the-dashboard-3.png";

export const GOOD_5K_TIME: UgcScript = {
  id: "Good5kTime",
  slug: "good-5k-time-for-my-age",
  searchPhrase: "what is a good 5k time for my age",
  rationale: "Pure comparison search, huge comment potential. Age-graded scoring is exactly what the Engine does, so the proof is direct.",
  beats: [
    { kind: "say", text: "what's a good 5k time for your age? 👇", seconds: 2.2, bg: ENGINE, bgFrom: 1.5 },
    { kind: "say", text: "rough guide for regular runners. men first, women add about 3 min.", seconds: 3.0, bg: ENGINE, bgFrom: 6.0 },
    {
      kind: "list",
      title: "a good 5k, by age",
      items: ["20s · 22–25 min", "30s · 23–26 min", "40s · 24–27 min", "50s · 26–29 min", "60+ · 28–32 min", "under 20 min at any age · fast"],
      seconds: 8.4,
      bg: ENGINE,
      bgFrom: 3.5,
    },
    { kind: "say", text: "the only time that matters is your last one. beat that.", seconds: 2.8, bg: ENGINE, bgFrom: 7.5 },
    { kind: "app", screen: DASH, focusY: 42, text: "split index predicts my 5k from my runs — 18:52 — and grades it by sex and age", seconds: 3.6 },
    { kind: "app", clip: ENGINE, from: 9.8, zoom: 1.0, focusY: 40, shiftY: 160, text: "every run gets a score against people your age", seconds: 3.0 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "what's a good 5k time for your age? rough guide by decade — where are you? 👇",
  hashtags: ["#5k", "#5ktime", "#runtok", "#runningtips", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — it predicts your 5k from your logged runs and scores every run against your sex and age. drop your age and 5k time 👇",
  disclaimer: "general information, not medical advice",
};
