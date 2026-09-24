/**
 * The five hook variants. One composition, one prop.
 *
 * `lines` is what slams in word by word over the first 1.5 s. Each line is
 * a separate slam group; keep a line to ≤ 5 words so it can never breach the
 * on-screen word cap. `subvert` (variant D only) lands at the top of the
 * TENSION beat as the answer to the hook's question.
 *
 * Markup: `*word*` renders in Lab green, `_word_` in Engine blue.
 *
 * Scale note: the brief said "out of 1000". The app computes on a 0–1000
 * scale but DISPLAYS every score out of 100 (`formatIndex`, "Strength +
 * endurance, out of 100" on the dashboard). Hooks C and E therefore say
 * "out of 100" — the number on screen a second later is 55.6, and a hook that
 * promised 1000 would contradict the product it is advertising.
 */
export type HookId = "A" | "B" | "C" | "D" | "E";

export interface HookVariant {
  id: HookId;
  lines: string[][];
  /** Optional second-beat answer (variant D). */
  subvert?: string[];
  /** For the posting kit and file names. */
  slug: string;
  /** Plain-text version for captions / posting kit. */
  text: string;
}

export const HOOKS: Record<HookId, HookVariant> = {
  A: {
    id: "A",
    slug: "bench-elite-5k-beginner",
    text: "Your bench says Elite. Your 5k says Beginner.",
    lines: [
      ["Your", "bench", "says", "*Elite.*"],
      ["Your", "5k", "says", "_Beginner._"],
    ],
  },
  B: {
    id: "B",
    slug: "lifting-slowing-running",
    text: "Your lifting is slowing down your running. Here's proof.",
    lines: [
      ["Your", "*lifting*", "is", "slowing"],
      ["down", "your", "_running._"],
      ["Here's", "proof."],
    ],
  },
  C: {
    id: "C",
    slug: "built-an-app",
    text: "I built an app that scores you out of 100.",
    lines: [
      ["I", "built", "an", "app"],
      ["that", "scores", "you"],
      ["out", "of", "*100.*"],
    ],
  },
  D: {
    id: "D",
    slug: "strong-or-fit",
    text: "Strong or fit? Pick one. — Why not both, measured.",
    lines: [
      ["*Strong*", "or", "_fit?_"],
      ["Pick", "one."],
    ],
    subvert: ["Why", "not", "both,", "measured."],
  },
  E: {
    id: "E",
    slug: "rate-me",
    text: "Rate me out of 100 based on my gym AND my 5k.",
    lines: [
      ["Rate", "me", "out", "of", "100"],
      ["based", "on", "my", "*gym*"],
      ["AND", "my", "_5k._"],
    ],
  },
};

export const HOOK_IDS: HookId[] = ["A", "B", "C", "D", "E"];
