/**
 * Content gap: "how to run faster 5k" (TikTok Creator Search Insights).
 *
 * The weekly shape that moves a 5k, as a saveable list, then the app's real
 * predicted race times card (18:52 on the real account) as the proof, and a
 * real run detail for texture.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const DASH = "real/screens/the-dashboard-3.png";

export const RUN_FASTER_5K: UgcScript = {
  id: "RunFaster5k",
  slug: "how-to-run-faster-5k",
  searchPhrase: "how to run faster 5k",
  rationale: "Evergreen search, mostly answered with sprint drills. A week-shape list is more useful and more saveable, and the predicted-race-time card is a strong proof beat.",
  beats: [
    { kind: "say", text: "how to run a faster 5k 👇", seconds: 2.0, bg: ENGINE, bgFrom: 1.5 },
    { kind: "say", text: "most of your running should feel easy. that's where the engine gets built.", seconds: 3.0, bg: ENGINE, bgFrom: 6.0 },
    {
      kind: "list",
      title: "the week that drops your 5k",
      items: ["3× easy runs · 30–45 min · conversational", "1× intervals · 6 × 800 m hard, 2 min jog", "1× tempo · 20 min comfortably hard", "1× long run · 60 min, easy"],
      seconds: 7.4,
      bg: ENGINE,
      bgFrom: 7.5,
    },
    { kind: "say", text: "then race it every 4–6 weeks. same route, all out. the time is your feedback.", seconds: 3.2, bg: ENGINE, bgFrom: 3.5 },
    { kind: "app", screen: DASH, focusY: 42, text: "split index predicts my 5k from the runs i log — 18:52 right now", seconds: 3.4 },
    { kind: "app", clip: ENGINE, from: 6.0, zoom: 1.0, focusY: 40, text: "every run gets splits, heart rate and a score", seconds: 3.0 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "how to run a faster 5k 🏃 the week that actually drops your time. save it 👇",
  hashtags: ["#5k", "#runfaster", "#runtok", "#runningtips", "#hybridathlete"],
  pinnedComment: "the app is split index (free) — it predicts your 5k from your logged runs and scores every run. drop your current 5k time and i'll tell you which session to add 👇",
  disclaimer: "general information, not medical advice",
};
