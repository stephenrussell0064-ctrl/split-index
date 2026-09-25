/**
 * Content gap: "arm fat loss exercises" (TikTok Creator Search Insights).
 *
 * The honest answer is the hook. You cannot spot-reduce fat, so a video that
 * lists "arm fat exercises" is both wrong and a CAP Code problem. The video
 * that wins the gap says so in the first two seconds, then gives the thing
 * that actually works (a deficit for the fat, tricep and bicep work so the
 * arm reads tight as it comes off) and ends on the proof: the weight on the
 * bar going up. That last beat is the app, shown doing exactly that on a
 * real screen.
 *
 * Claims discipline: no rates, no timelines, no "lose X in Y". General
 * exercise information, with a not-medical-advice line on screen.
 */
import type { UgcScript } from "../script";

const LAB = "real/clips/lab.mp4";
const SET = "real/clips/set-scoring.mp4";

export const ARM_FAT: UgcScript = {
  id: "ArmFat",
  slug: "arm-fat-loss-exercises",
  searchPhrase: "arm fat loss exercises",
  rationale:
    "High search volume, low supply of honest answers. Most results promise spot reduction, so an honest 25-second version has a clear angle and the app is the natural proof-of-progress at the end.",
  beats: [
    { kind: "say", text: "arm fat loss exercises 👇 the honest version", seconds: 2.2, bg: SET, bgFrom: 0.5 },
    { kind: "say", text: "you can't pick where fat comes off. no exercise burns arm fat specifically.", seconds: 3.6, bg: SET, bgFrom: 2.5 },
    { kind: "say", text: "so step 1 isn't an exercise. it's eating a bit less than you burn, and enough protein.", seconds: 3.8, bg: LAB, bgFrom: 0.5 },
    { kind: "say", text: "step 2 is building the arm, so it looks tight as the fat drops:", seconds: 2.8, bg: LAB, bgFrom: 2.0 },
    {
      kind: "list",
      title: "3× a week, 3 sets each",
      items: ["tricep pushdown · 10–12", "overhead tricep extension · 10–12", "close-grip bench or dips · 6–8", "curls · 10–12 (yes, biceps too)"],
      seconds: 6.0,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "step 3 is the only proof it's working: the weight goes up over weeks.", seconds: 3.0, bg: LAB, bgFrom: 7.5 },
    { kind: "app", clip: LAB, from: 5.0, zoom: 1.0, focusY: 30, text: "i log mine in split index — every lift gets a score and a 1RM that climbs", seconds: 3.6 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "arm fat loss exercises — the honest version. you can't spot reduce, but you can make the arm look tight while the fat comes off. saved this? 👇",
  hashtags: ["#armfat", "#armworkout", "#fatloss", "#gymtok", "#hybridathlete"],
  pinnedComment: "the app in the video is split index (free). it scores every set and shows your 1RM climbing — which is the only proof step 2 is working. ask me anything about the exercises 👇",
  disclaimer: "general information, not medical advice",
};
