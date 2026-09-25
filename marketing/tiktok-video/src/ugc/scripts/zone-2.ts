/**
 * Content gap: "zone 2 running explained" (TikTok Creator Search Insights).
 *
 * What it is, how to find it without a lab, how much of it, and what to
 * watch for. Proof: the real run detail with the heart-rate trace and the
 * zones breakdown, then the run summary with avg HR and pace.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const LAB = "real/clips/lab.mp4";

export const ZONE_2: UgcScript = {
  id: "Zone2",
  slug: "zone-2-running-explained",
  searchPhrase: "zone 2 running explained",
  rationale: "Evergreen, high-intent search from people who have heard the term and want the practical version. The zones chart on a real run is a direct proof beat.",
  beats: [
    { kind: "say", text: "zone 2 running explained 👇", seconds: 2.0, bg: ENGINE, bgFrom: 7.5 },
    { kind: "say", text: "zone 2 = easy. the pace where your body builds the engine instead of just surviving the run.", seconds: 3.6, bg: ENGINE, bgFrom: 1.5 },
    {
      kind: "list",
      title: "how to actually do it",
      items: ["heart rate · roughly 60–70% of your max", "no watch? talk test · full sentences, not gasping", "it will feel too slow · that's correct", "most of your runs · 3–4 a week, 30–60 min", "what you're watching for · same pace, lower heart rate"],
      seconds: 8.6,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "one hard run a week is plenty. the rest stays in zone 2.", seconds: 2.8, bg: ENGINE, bgFrom: 6.0 },
    { kind: "app", clip: ENGINE, from: 6.9, zoom: 1.0, focusY: 45, text: "split index shows my heart-rate trace and zones on every run", seconds: 2.8 },
    { kind: "app", clip: ENGINE, from: 1.4, zoom: 1.0, focusY: 40, text: "pace, avg HR and a score, so i can see the drift week to week", seconds: 3.2 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "zone 2 running explained 🫀 how to find it, how much to do, what to watch for. save it 👇",
  hashtags: ["#zone2", "#zone2running", "#runtok", "#runningtips", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — every run gets a heart-rate trace, zones and a score. what's your easy pace? drop it and your avg HR 👇",
  disclaimer: "general information, not medical advice",
};
