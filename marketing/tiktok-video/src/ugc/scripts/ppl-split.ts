/**
 * Content gap: "push pull legs split" (TikTok Creator Search Insights).
 *
 * The three days as a list with the key lifts, one rule (6 days or 3, never
 * 4), then the real Lab session — a Pull day, every lift scored — and the
 * real Adaptive 1RM list as the proof.
 */
import type { UgcScript } from "../script";

const LAB = "real/clips/lab.mp4";
const SET = "real/clips/set-scoring.mp4";
const ONE_RM = "real/screens/data-analytics-4.png";

export const PPL_SPLIT: UgcScript = {
  id: "PplSplit",
  slug: "push-pull-legs-split",
  searchPhrase: "push pull legs split",
  rationale: "The most searched split on gym TikTok. A three-day list with the key lifts is copyable, and a real Pull session with every lift scored is a proof beat nobody else has.",
  beats: [
    { kind: "say", text: "push pull legs split 👇", seconds: 2.0, bg: SET, bgFrom: 0.5 },
    { kind: "say", text: "3 days, repeat. the whole thing on one screen.", seconds: 2.6, bg: LAB, bgFrom: 2.0 },
    {
      kind: "list",
      title: "ppl · 3 sets each",
      items: ["push · bench 6–8 · overhead press 8–10 · incline db 10 · tricep pushdown 12", "pull · deadlift or row 6 · pull-up or pulldown 8–10 · face pull 15 · curl 12", "legs · squat 6–8 · rdl 8–10 · leg press 10–12 · calf raise 15"],
      seconds: 9.0,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "run it 6 days a week, or 3. never 4 — you'll always miss a day.", seconds: 3.2, bg: SET, bgFrom: 9.6 },
    { kind: "app", clip: LAB, from: 3.4, zoom: 1.0, focusY: 30, text: "my pull day in split index — every lift scored, 1RM per exercise", seconds: 3.6 },
    { kind: "app", screen: ONE_RM, focusY: 30, text: "and a 1RM list that tells you which lift is stalling", seconds: 3.0 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "push pull legs split 🏋️ all 3 days with the lifts, sets and reps. save it 👇",
  hashtags: ["#pushpulllegs", "#ppl", "#gymsplit", "#gymtok", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — scores every set and gives every lift its own 1RM, so you can see which day is moving. 6 days or 3? 👇",
  disclaimer: "general information, not medical advice",
};
