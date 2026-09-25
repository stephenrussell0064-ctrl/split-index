/**
 * Content gap: "hybrid athlete training split" (TikTok Creator Search Insights).
 *
 * A week, day by day, then the real Hybrid Plan week view (Week 1 of 5 ·
 * Base · 64 min of running · 5 sessions · 2 rest) and the real Targets
 * screen (5k 18:22 → 18:00, squat 127 → 150 kg) as the proof that the app
 * builds this for you from your own numbers.
 */
import type { UgcScript } from "../script";

const LAB = "real/clips/lab.mp4";
const ENGINE = "real/clips/engine.mp4";
const WEEK = "real/screens/hybrid-plan-4.png";
const TARGETS = "real/screens/hybrid-plan-3.png";

export const HYBRID_SPLIT: UgcScript = {
  id: "HybridSplit",
  slug: "hybrid-athlete-training-split",
  searchPhrase: "hybrid athlete training split",
  rationale: "People want a copyable week. The Hybrid Plan week view is that week, built from the account's own lifts and runs, so the proof beat is literally the answer.",
  beats: [
    { kind: "say", text: "hybrid athlete training split 👇", seconds: 2.0, bg: LAB, bgFrom: 0.5 },
    { kind: "say", text: "3 lifts, 3 runs, 1 rest. here's the week.", seconds: 2.6, bg: ENGINE, bgFrom: 1.5 },
    {
      kind: "list",
      title: "the hybrid week",
      items: ["mon · upper lift", "tue · easy run 30–45 min", "wed · lower lift", "thu · intervals or tempo", "fri · full body lift", "sat · long run, easy", "sun · rest"],
      seconds: 9.0,
      bg: LAB,
      bgFrom: 4.5,
    },
    { kind: "say", text: "hard run and lower day never back to back. that's the only rule.", seconds: 3.0, bg: ENGINE, bgFrom: 7.5 },
    { kind: "app", screen: WEEK, focusY: 30, text: "split index builds my week — 5 sessions, 2 rest, from my own lifts and runs", seconds: 3.8 },
    { kind: "app", screen: TARGETS, focusY: 40, text: "with the targets on screen: 5k 18:22 → 18:00, squat 127 → 150", seconds: 3.4 },
    { kind: "cta", text: "free on the app store · link in bio", seconds: 2.4 },
  ],
  caption: "hybrid athlete training split 🏋️🏃 3 lifts, 3 runs, 1 rest. save the week 👇",
  hashtags: ["#hybridathlete", "#hybridtraining", "#hyrox", "#gymtok", "#runtok"],
  pinnedComment: "the app is split index (free) — the hybrid plan builds a block toward your event from your own lifts and runs, targets on screen. what's your event? 👇",
  disclaimer: "general information, not medical advice",
};
