/**
 * Content gap: "hyrox training plan" (TikTok Creator Search Insights).
 *
 * Hyrox is 8 × 1 km runs with a station between each, so the week has to
 * train running under fatigue and the stations as compromised running.
 * A copyable week, one rule, then the real Hybrid Plan block view and the
 * real Targets screen as the proof that the app builds this toward a date.
 */
import type { UgcScript } from "../script";

const ENGINE = "real/clips/engine.mp4";
const LAB = "real/clips/lab.mp4";
const WEEK = "real/screens/hybrid-plan-4.png";
const TARGETS = "real/screens/hybrid-plan-3.png";

export const HYROX_PLAN: UgcScript = {
  id: "HyroxPlan",
  slug: "hyrox-training-plan",
  searchPhrase: "hyrox training plan",
  rationale: "Event-driven search with a deadline behind it — people who search this are ready to follow something. The plan block toward a date is the app's exact fit.",
  beats: [
    { kind: "say", text: "hyrox training plan 👇", seconds: 2.0, bg: ENGINE, bgFrom: 1.5 },
    { kind: "say", text: "8 runs, 8 stations. train running tired, not just running.", seconds: 3.0, bg: ENGINE, bgFrom: 6.0 },
    {
      kind: "list",
      title: "the hyrox week",
      items: ["mon · lower strength · squat, lunges, sled if you have one", "tue · easy run 40 min", "wed · station circuit · ski, row, wall balls, burpee broad jumps", "thu · run + station intervals · 1 km, station, repeat ×4", "fri · upper + carries · farmer's, sandbag", "sat · long run 60–75 min", "sun · rest"],
      seconds: 10.0,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "8 weeks out, make thursday the priority. that's the race.", seconds: 3.0, bg: ENGINE, bgFrom: 3.5 },
    { kind: "app", screen: WEEK, focusY: 30, text: "split index builds the block toward your event date — week 1 of 5, base", seconds: 3.6 },
    { kind: "app", screen: TARGETS, focusY: 40, text: "targets on screen so the gap is visible: 5k 18:22 → 18:00", seconds: 3.2 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "hyrox training plan 🏁 the week, day by day, 8 weeks out. save it 👇",
  hashtags: ["#hyrox", "#hyroxtraining", "#hybridathlete", "#hyroxprep", "#gymtok"],
  pinnedComment: "the app is split index (free) — the hybrid plan builds a block toward your event date from your own lifts and runs. when's your hyrox? 👇",
  disclaimer: "general information, not medical advice",
};
