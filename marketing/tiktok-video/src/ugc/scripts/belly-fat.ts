/**
 * Content gap: "how to lose belly fat gym" (TikTok Creator Search Insights).
 *
 * Same shape as arm-fat: a straight, saveable list — big compound lifts,
 * one hard cardio session, steps — one rule, the app as the proof that the
 * lifts are going up.
 */
import type { UgcScript } from "../script";

const LAB = "real/clips/lab.mp4";
const SET = "real/clips/set-scoring.mp4";
const ENGINE = "real/clips/engine.mp4";

export const BELLY_FAT: UgcScript = {
  id: "BellyFat",
  slug: "how-to-lose-belly-fat-gym",
  searchPhrase: "how to lose belly fat gym",
  rationale: "Biggest search of the lot. A gym-floor list with sets and reps is what it wants; the compound lifts are the app's home turf.",
  beats: [
    { kind: "say", text: "how to lose belly fat at the gym 👇", seconds: 2.0, bg: SET, bgFrom: 0.5 },
    { kind: "say", text: "save this. big lifts, one hard cardio session, walk a lot.", seconds: 2.8, bg: LAB, bgFrom: 2.0 },
    {
      kind: "list",
      title: "the belly fat gym plan",
      items: ["squat or leg press · 3×8", "deadlift or romanian deadlift · 3×6", "bench or push-up · 3×10", "row or pulldown · 3×10", "1× a week · 20 min intervals, bike or run", "every day · 8–10k steps"],
      seconds: 8.6,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "3 lifts a week, add weight when you hit the top of the range. that's it.", seconds: 3.2, bg: SET, bgFrom: 9.6 },
    { kind: "app", clip: SET, from: 0.4, zoom: 1.0, focusY: 35, text: "i log every set in split index — it scores it as i type", seconds: 3.2 },
    { kind: "app", clip: ENGINE, from: 1.4, zoom: 1.0, focusY: 40, shiftY: 120, text: "and the cardio session too, with a score", seconds: 2.8 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "how to lose belly fat at the gym 🔥 the plan: 4 lifts, 1 cardio, steps. save it 👇",
  hashtags: ["#bellyfat", "#gymplan", "#fatloss", "#gymtok", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — scores every set and every run so you can see the weight going up. how many days a week can you train? i'll split it for you 👇",
  disclaimer: "general information, not medical advice",
};
