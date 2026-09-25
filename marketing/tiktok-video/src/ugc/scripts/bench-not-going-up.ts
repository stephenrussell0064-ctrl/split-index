/**
 * Content gap: "bench press not going up" (TikTok Creator Search Insights).
 *
 * A stalled bench is almost always one of four things. Straight list, one
 * rule, then the app's real Adaptive 1RM screen (a "Steady" lift against its
 * all-time best) as the proof that a plateau is visible before you feel it.
 */
import type { UgcScript } from "../script";

const SET = "real/clips/set-scoring.mp4";
const LAB = "real/clips/lab.mp4";
const ONE_RM = "real/screens/data-analytics-4.png";

export const BENCH_NOT_GOING_UP: UgcScript = {
  id: "BenchNotGoingUp",
  slug: "bench-press-not-going-up",
  searchPhrase: "bench press not going up",
  rationale: "Frustration searches convert to saves. Most answers are technique cues; a four-cause checklist is more useful, and the Adaptive 1RM screen shows a plateau as a flat line, which is the proof beat.",
  beats: [
    { kind: "say", text: "bench press not going up? 👇", seconds: 2.0, bg: SET, bgFrom: 0.5 },
    { kind: "say", text: "it's almost always one of these four. fix the one that's you.", seconds: 2.8, bg: SET, bgFrom: 2.5 },
    {
      kind: "list",
      title: "why your bench is stuck",
      items: ["not enough sets · aim 10–15 hard sets a week", "same weight every session · add 2.5 kg or 1 rep", "no back-off work · 3×8 at 70% after your top set", "sleep + food · you can't recover a bench you don't fuel"],
      seconds: 8.0,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "run the fix for 6 weeks before you change anything else.", seconds: 2.8, bg: SET, bgFrom: 9.6 },
    { kind: "app", screen: ONE_RM, focusY: 30, text: "split index tracks my 1RM per lift — flat line means stalled, before i feel it", seconds: 3.4 },
    { kind: "app", clip: SET, from: 9.5, zoom: 1.0, focusY: 40, text: "and every set gets scored as i type it", seconds: 3.0 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "bench press not going up? it's one of these 4 🔒 save it and fix yours 👇",
  hashtags: ["#benchpress", "#benchpressplateau", "#gymtok", "#strengthtraining", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — it tracks your 1RM per lift and shows whether it's climbing or flat. drop your current bench and how many sets a week you do and i'll tell you which of the 4 it is 👇",
  disclaimer: "general information, not medical advice",
};
