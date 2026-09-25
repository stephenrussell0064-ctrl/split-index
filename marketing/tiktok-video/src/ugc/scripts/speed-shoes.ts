/**
 * Content gap: "speed running shoes" (TikTok Creator Search Insights).
 *
 * What a speed shoe is, when to wear one, and the well-known options by
 * budget — named as examples, no performance claims about any of them.
 * Then the proof: the only way to know if a shoe made you faster is the
 * splits on the same route, which is the real run detail in the app.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const LAB = "real/clips/lab.mp4";
const DASH = "real/screens/the-dashboard-3.png";

export const SPEED_SHOES: UgcScript = {
  id: "SpeedShoes",
  slug: "speed-running-shoes",
  searchPhrase: "speed running shoes",
  rationale: "Buying-intent search with heavy comment traffic (everyone has an opinion). A short, honest buyer's guide plus 'log it and check' is the angle nobody else takes, and splits are the proof.",
  beats: [
    { kind: "say", text: "speed running shoes 👇 what to actually buy", seconds: 2.2, bg: ENGINE, bgFrom: 1.5 },
    { kind: "say", text: "a speed shoe = light, firm foam, often a plate. for race day and hard sessions, not easy runs.", seconds: 3.8, bg: ENGINE, bgFrom: 6.0 },
    {
      kind: "list",
      title: "the shortlist",
      items: ["tempo days · saucony endorphin speed, asics magic speed, hoka mach", "race day · nike vaporfly, adidas adios pro, asics metaspeed", "budget · last year's model of any of the above", "keep your daily trainer · speed shoes are for 1–2 runs a week"],
      seconds: 9.4,
      bg: LAB,
      bgFrom: 0.5,
    },
    { kind: "say", text: "then prove it: same route, same effort, compare the splits.", seconds: 3.0, bg: ENGINE, bgFrom: 3.5 },
    { kind: "app", clip: ENGINE, from: 4.4, zoom: 1.0, focusY: 40, shiftY: 120, text: "split index gives me every km split and my fastest stretch at each distance", seconds: 3.6 },
    { kind: "app", screen: DASH, focusY: 42, text: "and a predicted 5k from all of it — 18:52 right now", seconds: 3.0 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "speed running shoes — what they are, when to wear them, the shortlist. then log it and see if it actually helped 👇",
  hashtags: ["#runningshoes", "#speedshoes", "#carbonplate", "#runtok", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — every run gets km splits and best efforts, so you can see whether the new shoes changed anything. what are you racing in? 👇",
  disclaimer: "general information, not medical advice · no shoe brand paid for this",
};
