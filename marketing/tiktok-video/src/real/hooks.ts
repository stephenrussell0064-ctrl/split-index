/**
 * Hooks for the real-footage film. Every number is one the dashboard or
 * records screenshot shows within the first nine seconds.
 */
import type { HookId, HookVariant } from "../hooks";
import { REAL } from "./data";

export const REAL_HOOKS: Record<HookId, HookVariant> = {
  A: {
    id: "A",
    slug: "bench-133-5k-1825",
    text: `${REAL.dashboard.oneRM.bench} bench. ${REAL.records.fiveK} 5k. One score.`,
    lines: [
      [`*${REAL.dashboard.oneRM.bench}*`, "bench."],
      [`_${REAL.records.fiveK}_`, "5k."],
      ["One", "score."],
    ],
  },
  B: {
    id: "B",
    slug: "is-759-good",
    text: `Is ${REAL.dashboard.splitIndex} good for a hybrid athlete?`,
    lines: [
      ["Is", `*${REAL.dashboard.splitIndex}*`, "good"],
      ["for", "a", "hybrid"],
      ["_athlete?_"],
    ],
  },
  C: {
    id: "C",
    slug: "built-an-app",
    text: "I built an app that scores hybrid athletes.",
    lines: [
      ["I", "built", "an", "app"],
      ["that", "scores"],
      ["*hybrid*", "_athletes._"],
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
    slug: "rate-my-bench-and-5k",
    text: "Rate my bench AND my 5k.",
    lines: [
      ["Rate", "my", "*bench*"],
      ["AND", "my", "_5k._"],
    ],
  },
};
