/**
 * The REAL account's numbers, as the app rendered them.
 *
 * Source of truth is the screenshots and recordings in public/real/ — each
 * figure below names the file it can be read off. Nothing here is computed by
 * this project; the app computed it from the account's logged training and
 * drew it, and we filmed the screen. A caption may only quote a number while
 * the file that shows it is on screen.
 *
 * Account: @split_index_ceo (profile verified read-only on 24 Sep 2026:
 * male, 78 kg, username matches, id prefix f0c63c26). Screenshots taken
 * 22 Sep 2026. The RECORDINGS are of a second, near-empty test account
 * (StephenTest) and show different session numbers — they are used for
 * motion (logging, the live count-up, the leaderboard) and their captions
 * never quote a figure that belongs to the other account.
 */

export const REAL = {
  handle: "split_index_ceo",
  /** the-dashboard-3.png */
  dashboard: {
    file: "real/screens/the-dashboard-3.png",
    splitIndex: "75.9",
    tier: "Advanced",
    engine: "70.1",
    lab: "81.7",
    predicted: { fiveK: "18:52", tenK: "40:17", half: "1:31:09", full: "3:14:35" },
    oneRM: { squat: "124 kg", bench: "133 kg", deadlift: "200 kg", total: "457 kg" },
    benchBest: "120×4",
  },
  /** data-analytics-2.png */
  records: {
    file: "real/screens/data-analytics-2.png",
    fiveK: "18:25",
    fiveKDate: "Jul 25, 2026 · race",
    tenK: "49:39",
    dots: "319.8",
    ipfGl: "65.3",
    sbdTotal: "456.8 kg",
  },
  /** the-lab-4.png */
  lab: { file: "real/screens/the-lab-4.png", strengthIndex: "81.7", dots: "93.3", ipfGl: "19.1" },
  /** the-engine-3.png */
  engine: { file: "real/screens/the-engine-3.png", blend: "70.1" },
  /**
   * interference-radar-1.png — the lower half of the real account's radar page:
   * "Does cardio weaken your lifting?" +3.7% strength score on heavy-cardio
   * weeks, lighter 777 vs heavy 806, based on 13 gym sessions. (The upper
   * half, interference-radar-2.png, is +2% cardio efficiency on 2 sessions,
   * flagged EARLY DATA by the app — too thin to lead with.)
   */
  radar: {
    file: "real/screens/interference-radar-1.png",
    question: "Does cardio weaken your lifting?",
    delta: "+3.7%",
    sessions: 13,
    verdict: "Heavy cardio weeks coincide with roughly 3.7% strength performance compared to lighter cardio weeks.",
  },
} as const;

/** The test account's recordings — captions describe the UI, never cross-quote numbers. */
export const CLIPS = {
  /** 15 s. 0–6 s: bench sets typed in and scored live (100×6 → 77.5, 110×4 → 79.4). 9.5–12 s: est. 1RM, ×BW, top set. */
  setScoring: "real/clips/set-scoring.mp4",
  /** 9 s. 0.3–2.6 s: "SESSION SCORED" counts 0 → 77.7 live; 77.9 composite below. */
  sessionDone: "real/clips/session-done.mp4",
  /** 13.65 s. 9.27 km run: 1.5 s stats, 6.0 s per-km splits, 7.5 s heart rate, 10 s session index. */
  engine: "real/clips/engine.mp4",
  /** 12.3 s. A Pull session: 4.5 s Lat Pulldown 94 · 1RM 123.5 kg · World Class. */
  lab: "real/clips/lab.mp4",
  /** 8 s. 7–8 s: Leaderboard · Your bracket · Male · 20-24 · 80-90kg · #3 of 6. */
  firstFinding: "real/clips/first-finding.mp4",
} as const;

export const STILLS = {
  /** frame 7.0 s of first-finding.mp4, unedited */
  leaderboard: "real/screens/leaderboard-bracket.png",
  /** frame 1.9 s of session-done.mp4, unedited */
  sessionScored: "real/screens/session-scored.png",
} as const;
