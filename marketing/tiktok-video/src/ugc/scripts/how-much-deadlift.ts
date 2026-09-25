/**
 * Content gap: "how much should I deadlift" (TikTok Creator Search Insights).
 *
 * The answer is a bodyweight multiple, not a number. Rough tiers as a
 * list, one rule, then the real Adaptive 1RM screen (Deadlift 200.0 kg, at
 * all-time best) and the real Lab recording with its "× bodyweight" line.
 * Real account: 200 kg at 78 kg bodyweight — both figures on real screens.
 */
import type { UgcScript } from "../script";

const LAB = "real/clips/lab.mp4";
const SET = "real/clips/set-scoring.mp4";
const ONE_RM = "real/screens/data-analytics-4.png";

export const HOW_MUCH_DEADLIFT: UgcScript = {
  id: "HowMuchDeadlift",
  slug: "how-much-should-i-deadlift",
  searchPhrase: "how much should I deadlift",
  rationale: "Comparison searches are the highest-comment category in gym content. A bodyweight-multiple ladder is saveable, and the app scores lifts as a ratio of bodyweight, so the proof beat is exact.",
  beats: [
    { kind: "say", text: "how much should you deadlift? 👇", seconds: 2.0, bg: SET, bgFrom: 0.5 },
    { kind: "say", text: "forget the number. it's a multiple of your bodyweight. rough guide, men:", seconds: 3.2, bg: LAB, bgFrom: 2.0 },
    {
      kind: "list",
      title: "deadlift × bodyweight",
      items: ["beginner · 1× · first few months", "intermediate · 1.5× · a year in", "advanced · 2× · years of consistent work", "elite · 2.5×+ · competitive", "women · roughly 0.75 / 1 / 1.5 / 2×"],
      seconds: 8.4,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "80 kg? 1.5× is 120 kg. that's the target, not what the guy next to you pulls.", seconds: 3.4, bg: SET, bgFrom: 9.6 },
    { kind: "app", screen: ONE_RM, focusY: 30, text: "split index tracks my deadlift 1RM — 200 kg at 78 kg bodyweight", seconds: 3.4 },
    { kind: "app", clip: LAB, from: 4.4, zoom: 1.0, focusY: 30, text: "and scores every lift as × bodyweight against your sex and age", seconds: 3.2 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "how much should you deadlift? it's a bodyweight multiple, not a number. find yours 👇",
  hashtags: ["#deadlift", "#howmuchshouldilift", "#gymtok", "#strengthtraining", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — every lift is scored as × bodyweight against your sex and age, with a tier. drop your deadlift and bodyweight and i'll tell you your multiple 👇",
  disclaimer: "general information, not medical advice",
};
