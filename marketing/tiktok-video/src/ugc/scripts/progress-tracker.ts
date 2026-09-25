/**
 * Content gap: "gym progress tracker app" (TikTok Creator Search Insights).
 *
 * The one gap where the app IS the answer, so the format flips: a short
 * list of what a tracker should actually show you, then three real screens
 * doing each of those things — logging with live scoring, the session
 * score counting up, the 1RM per lift — and the dashboard.
 */
import type { UgcScript } from "../script";

const SET = "real/clips/set-scoring.mp4";
const DONE = "real/clips/session-done.mp4";
const LAB = "real/clips/lab.mp4";
const ONE_RM = "real/screens/data-analytics-4.png";
const DASH = "real/screens/the-dashboard-3.png";

export const PROGRESS_TRACKER: UgcScript = {
  id: "ProgressTracker",
  slug: "gym-progress-tracker-app",
  searchPhrase: "gym progress tracker app",
  rationale: "Product-intent search — people are choosing an app. Show the app doing the four things a tracker should, on real screens, and let it sell itself.",
  beats: [
    { kind: "say", text: "gym progress tracker app 👇 what it should actually show you", seconds: 2.6, bg: SET, bgFrom: 0.5 },
    {
      kind: "list",
      title: "4 things a tracker needs",
      items: ["a score per set · as you log it, not after", "a 1RM per lift · that moves when you beat it", "a session score · so a workout has a number", "strength AND running · on one dashboard"],
      seconds: 7.2,
      bg: LAB,
      bgFrom: 2.0,
    },
    { kind: "say", text: "this is the one i use. real screens:", seconds: 2.0, bg: LAB, bgFrom: 7.5 },
    { kind: "app", clip: SET, from: 0.4, zoom: 1.0, focusY: 35, text: "1 · type a set, it's scored on the spot", seconds: 3.6 },
    { kind: "app", clip: DONE, from: 0.3, zoom: 1.0, focusY: 30, shiftY: 230, text: "2 · finish, and the session gets a score", seconds: 3.0 },
    { kind: "app", screen: ONE_RM, focusY: 30, text: "3 · a 1RM per lift, steady or climbing", seconds: 3.0 },
    { kind: "app", screen: DASH, focusY: 30, text: "4 · lifting and running, one score out of 100", seconds: 3.2 },
    { kind: "cta", text: "split index · free on the app store", seconds: 2.4 },
  ],
  caption: "gym progress tracker app — the 4 things it should show you, on real screens 👇",
  hashtags: ["#gymprogress", "#workouttracker", "#gymapp", "#gymtok", "#hybridathlete"],
  pinnedComment: "it's split index (free on the app store). scores every set as you log it, 1RM per lift, session score, and it does running too. what app are you using now? 👇",
  disclaimer: "general information, not medical advice",
};
