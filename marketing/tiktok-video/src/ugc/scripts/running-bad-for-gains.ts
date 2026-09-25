/**
 * Content gap: "is running bad for gains" (TikTok Creator Search Insights).
 *
 * The one gap that lands on the app's own feature. Four rules for running
 * without losing strength, then the real Interference Radar screen: heavy
 * cardio weeks on this account coincide with a +3.7 % strength score over
 * 13 gym sessions. "mine" — the account's own data, quoted as it appears.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const LAB = "real/clips/lab.mp4";
const RADAR = "real/screens/interference-radar-1.png";

export const RUNNING_BAD_FOR_GAINS: UgcScript = {
  id: "RunningBadForGains",
  slug: "is-running-bad-for-gains",
  searchPhrase: "is running bad for gains",
  rationale: "The question the app exists to answer. The radar screen is a direct, real proof beat, and the debate in the comments drives replies.",
  beats: [
    { kind: "say", text: "is running bad for gains? 👇", seconds: 2.0, bg: ENGINE, bgFrom: 1.5 },
    { kind: "say", text: "not if you run it like this. 4 rules.", seconds: 2.6, bg: LAB, bgFrom: 2.0 },
    {
      kind: "list",
      title: "run without losing gains",
      items: ["keep most runs easy · conversational pace", "lift first · or split lift and run by 6+ hours", "eat for both · protein 1.6–2 g per kg, don't cut hard", "one hard run a week · not three"],
      seconds: 8.0,
      bg: ENGINE,
      bgFrom: 6.0,
    },
    { kind: "say", text: "then actually check: do your lifts drop in heavy running weeks, or not?", seconds: 3.2, bg: LAB, bgFrom: 7.5 },
    { kind: "app", screen: RADAR, focusY: 42, text: "split index checks mine — heavy cardio weeks, strength score +3.7%. no loss.", seconds: 3.8 },
    { kind: "app", clip: ENGINE, from: 10.0, zoom: 1.0, focusY: 40, text: "every run and every lift, scored on one timeline", seconds: 3.0 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "is running bad for gains? 4 rules so it isn't — and the app that checks your own numbers 👇",
  hashtags: ["#hybridathlete", "#runningandlifting", "#gymtok", "#runtok", "#cardioandgains"],
  pinnedComment: "the app is split index (free) — its interference radar compares your strength scores in heavy vs light running weeks, from your own logs. do you lift and run the same day? 👇",
  disclaimer: "general information, not medical advice",
};
