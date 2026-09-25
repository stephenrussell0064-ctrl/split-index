/**
 * Content gap: "how to start running" (TikTok Creator Search Insights).
 *
 * Beginner search. A walk/run ladder for the first four weeks, one rule
 * (slower than you think), then the real run detail as the proof that a
 * run gets logged with splits, HR and a score from day one.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const LAB = "real/clips/lab.mp4";

export const START_RUNNING: UgcScript = {
  id: "StartRunning",
  slug: "how-to-start-running",
  searchPhrase: "how to start running",
  rationale: "The biggest beginner search in running. A four-week walk/run ladder is the most saved format for it, and the first logged run is a natural proof beat.",
  beats: [
    { kind: "say", text: "how to start running 👇", seconds: 2.0, bg: ENGINE, bgFrom: 1.5 },
    { kind: "say", text: "3× a week, 20–30 min. walk and run. slower than you think.", seconds: 3.0, bg: ENGINE, bgFrom: 6.0 },
    {
      kind: "list",
      title: "your first 4 weeks",
      items: ["week 1 · run 1 min, walk 2 · ×8", "week 2 · run 2 min, walk 2 · ×6", "week 3 · run 4 min, walk 1 · ×5", "week 4 · run 8 min, walk 1 · ×3", "then · 20 min without stopping"],
      seconds: 8.2,
      bg: LAB,
      bgFrom: 0.5,
    },
    { kind: "say", text: "if you can't talk while running, slow down. every run, until it feels easy.", seconds: 3.2, bg: ENGINE, bgFrom: 3.5 },
    { kind: "app", clip: ENGINE, from: 1.4, zoom: 1.0, focusY: 40, shiftY: 120, text: "i log every run in split index — distance, pace, heart rate", seconds: 3.2 },
    { kind: "app", clip: ENGINE, from: 9.8, zoom: 1.0, focusY: 40, shiftY: 160, text: "and a score from your very first run, so you can watch it climb", seconds: 3.2 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "how to start running 🏃 the first 4 weeks, walk/run, 3× a week. save it 👇",
  hashtags: ["#howtostartrunning", "#beginnerrunner", "#runtok", "#couchto5k", "#runningtips"],
  pinnedComment: "the app is split index (free) — every run gets distance, pace, heart rate and a score from day one. which week are you on? 👇",
  disclaimer: "general information, not medical advice",
};
