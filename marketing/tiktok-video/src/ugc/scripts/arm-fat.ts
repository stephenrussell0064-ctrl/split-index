/**
 * Content gap: "arm fat loss exercises" (TikTok Creator Search Insights).
 *
 * Straight answer to the search: the exercises, sets and reps, the one rule
 * for progressing, then the app as the way to see the weight going up.
 * Wording stays "for arm fat" / "toned arms" (what people search and want)
 * rather than "burns arm fat" (a claim), and the disclaimer stays on the
 * last beat.
 */
import type { UgcScript } from "../script";

const LAB = "real/clips/lab.mp4";
const SET = "real/clips/set-scoring.mp4";

export const ARM_FAT: UgcScript = {
  id: "ArmFat",
  slug: "arm-fat-loss-exercises",
  searchPhrase: "arm fat loss exercises",
  rationale: "High search volume, thin supply. A clean, saveable list with sets and reps is what the search wants; the app is the natural way to track the weight going up.",
  beats: [
    { kind: "say", text: "best arm exercises for arm fat 👇", seconds: 2.0, bg: SET, bgFrom: 0.5 },
    { kind: "say", text: "save this. 4 moves, 3× a week, 3 sets each.", seconds: 2.6, bg: SET, bgFrom: 2.5 },
    {
      kind: "list",
      title: "the arm fat workout",
      items: ["tricep pushdown · 12–15", "overhead tricep extension · 10–12", "close-grip bench or dips · 8–10", "hammer curls · 10–12"],
      seconds: 7.0,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "hit the top of the rep range? add weight next time. that's what changes your arms.", seconds: 3.4, bg: LAB, bgFrom: 7.5 },
    { kind: "app", clip: LAB, from: 5.0, zoom: 1.0, focusY: 30, text: "i log every set in split index — it scores the lift and shows my 1RM going up", seconds: 3.4 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "arm fat loss exercises 💪 4 moves, sets and reps. save it for your next session 👇",
  hashtags: ["#armfat", "#armworkout", "#tonedarms", "#gymtok", "#fitnesstok"],
  pinnedComment: "the app is split index (free) — it scores every set and tracks your 1RM so you can see the weight going up week to week. which move do you want a form video on? 👇",
  disclaimer: "general information, not medical advice",
};
