/**
 * The four showreels. Each is ~30 s, the reference ad's length; together
 * they cover everything the app does. Real screens, real numbers, one
 * account (@split_index_ceo), captions only claim what is on screen.
 *
 * Crops were read off the screenshots at 400 px and scaled ×2.9475 back to
 * the 1179-px files; a few px of slack is built into every rectangle.
 */
import type { ShowreelScript } from "../script";

const DASH = "real/screens/the-dashboard-3.png";
const DASH2 = "real/screens/the-dashboard-2.png";
const RISK = "real/screens/data-analytics-1.png";
const RECORDS = "real/screens/data-analytics-2.png";
const FITNESS = "real/screens/data-analytics-3.png";
const ONE_RM = "real/screens/data-analytics-4.png";
const LADDER = "real/screens/data-analytics-5.png";
const SET_SCREEN = "real/screens/the-lab-5.png"; // Incline DB press being logged: 45 kg per hand × 8, RPE 7 → 90.4
const LAB_HQ = "real/screens/app-screens-2.png"; // Strength HQ: strength index 81.7, DOTS / IPF GL
const LAB_PRESETS = "real/screens/the-lab-3.png";
const RADAR = "real/screens/interference-radar-1.png";
const TARGETS = "real/screens/hybrid-plan-3.png";
const LEADERBOARD = "real/screens/leaderboard-bracket.png";
const ENGINE_HISTORY = "real/screens/the-engine-2.png";

const SET_CLIP = "real/clips/set-scoring.mp4";
const DONE_CLIP = "real/clips/session-done.mp4";
const ENGINE_CLIP = "real/clips/engine.mp4";

// The phone sits at x = 490 (the TikTok safe rect's centre). Cards float
// around it; `x` is the card's centre in frame px.
const CX = 490;

export const ONE_SCORE: ShowreelScript = {
  id: "OneScore",
  slug: "one-score",
  title: "One score for strength and endurance",
  beats: [
    {
      vo: "Your lifting and your running, scored in one app.",
      caption: "Your *lifting* and your _running_, scored in one app.",
      screen: { file: DASH, y: 1000, yTo: 1100 },
    },
    {
      vo: "Log a set. It's scored as you type.",
      caption: "Log a set. It's *scored* as you type.",
      clip: { src: SET_CLIP, from: 0.4 },
      cards: [{ file: SET_SCREEN, crop: [88, 1100, 1002, 320], width: 800, x: CX, y: 700, at: 14, rot: -2 }],
    },
    {
      vo: "Finish, and the whole session gets a score.",
      caption: "Finish, and the whole session gets a *score*.",
      clip: { src: DONE_CLIP, from: 0.3 },
    },
    {
      vo: "Strength and endurance become one Split Index.",
      caption: "Strength and endurance become one *Split Index*.",
      screen: { file: DASH, y: 780 },
      cards: [{ file: DASH, crop: [53, 442, 1073, 650], width: 820, x: CX, y: 720, at: 10, rot: 0 }],
    },
    {
      vo: "Ranked against your age, sex and bodyweight.",
      caption: "Ranked against your *age, sex and bodyweight*.",
      screen: { file: LEADERBOARD, size: [720, 1560], y: 780 },
      cards: [{ file: LEADERBOARD, size: [720, 1560], crop: [70, 610, 580, 340], width: 800, x: CX, y: 760, at: 12, rot: 1.5 }],
    },
    {
      vo: "It predicts your races, and your one rep max.",
      caption: "It predicts your _races_, and your *one rep max*.",
      screen: { file: DASH, y: 1500 },
      cards: [
        { file: DASH, crop: [53, 1135, 1073, 312], width: 760, x: CX - 40, y: 560, at: 8, rot: -2 },
        { file: DASH, crop: [53, 1488, 1073, 356], width: 760, x: CX + 40, y: 900, at: 20, rot: 1.5 },
      ],
    },
  ],
  outroVo: "Split Index. Free on the App Store.",
};

export const THE_LAB: ShowreelScript = {
  id: "TheLab",
  slug: "the-lab",
  title: "The Lab — strength",
  beats: [
    {
      vo: "Every set you log gets its own score.",
      caption: "Every set you log gets its own *score*.",
      clip: { src: SET_CLIP, from: 0.4 },
      cards: [{ file: SET_SCREEN, crop: [88, 1100, 1002, 320], width: 800, x: CX, y: 700, at: 14, rot: -2 }],
    },
    {
      vo: "Your strength index, against real standards.",
      caption: "Your *strength index*, against real standards.",
      screen: { file: LAB_HQ, y: 1400 },
      cards: [{ file: LAB_HQ, crop: [53, 1110, 1073, 720], width: 780, x: CX, y: 720, at: 12, rot: 1 }],
    },
    {
      vo: "Adaptive one rep max: what you could lift today, against your best.",
      caption: "*Adaptive 1RM*: what you could lift today, against your best.",
      screen: { file: ONE_RM, y: 900 },
      cards: [
        { file: ONE_RM, crop: [112, 486, 955, 400], width: 760, x: CX - 30, y: 560, at: 10, rot: -2 },
        { file: ONE_RM, crop: [112, 928, 955, 460], width: 760, x: CX + 30, y: 920, at: 22, rot: 1.5 },
      ],
    },
    {
      vo: "Preset plans, or build your own session.",
      caption: "Preset *plans*, or build your own session.",
      screen: { file: LAB_PRESETS, y: 1200 },
    },
    {
      vo: "And it checks whether cardio is costing you strength.",
      caption: "And it checks whether _cardio_ is costing you *strength*.",
      screen: { file: RADAR, y: 1100 },
      cards: [{ file: RADAR, crop: [53, 480, 1073, 640], width: 820, x: CX, y: 720, at: 12, rot: -1 }],
    },
    {
      vo: "Predicted one rep max, from your working sets.",
      caption: "Predicted *1RM*, from your working sets.",
      screen: { file: DASH, y: 1600 },
      cards: [{ file: DASH, crop: [53, 1488, 1073, 356], width: 800, x: CX, y: 700, at: 10, rot: 1 }],
    },
  ],
  outroVo: "Split Index. Free on the App Store.",
};

export const THE_ENGINE: ShowreelScript = {
  id: "TheEngine",
  slug: "the-engine",
  title: "The Engine — endurance",
  beats: [
    {
      vo: "Record a run. Distance, pace, heart rate, elevation.",
      caption: "Record a run. _Distance, pace, heart rate, elevation_.",
      clip: { src: ENGINE_CLIP, from: 1.4 },
    },
    {
      vo: "Every kilometre: the split, the climb, and the heart rate it cost.",
      caption: "Every kilometre: the _split_, the climb, and the heart rate it cost.",
      clip: { src: ENGINE_CLIP, from: 6.0 },
    },
    {
      vo: "Your best efforts at every distance, found inside any run.",
      caption: "Your *best efforts* at every distance, found inside any run.",
      clip: { src: ENGINE_CLIP, from: 3.5 },
    },
    {
      vo: "Riegel's formula predicts every distance from the runs you've logged.",
      caption: "_Riegel's formula_ predicts every distance from the runs you've logged.",
      screen: { file: LADDER, y: 1700 },
      cards: [{ file: LADDER, crop: [53, 1540, 1073, 570], width: 800, x: CX, y: 700, at: 12, rot: -1.5 }],
    },
    {
      vo: "It estimates your lactate threshold and your VO2 max.",
      caption: "It estimates your _lactate threshold_ and your _VO2 max_.",
      screen: { file: FITNESS, y: 1300 },
      cards: [
        { file: FITNESS, crop: [112, 934, 955, 430], width: 760, x: CX - 30, y: 560, at: 10, rot: -2 },
        { file: FITNESS, crop: [112, 1415, 955, 300], width: 760, x: CX + 30, y: 900, at: 22, rot: 1.5 },
      ],
    },
    {
      vo: "Every sport on one timeline, and your race records kept.",
      caption: "Every sport on one timeline, and your *race records* kept.",
      screen: { file: ENGINE_HISTORY, y: 1200 },
      cards: [{ file: RECORDS, crop: [53, 133, 1073, 740], width: 760, x: CX, y: 700, at: 12, rot: 1 }],
    },
  ],
  outroVo: "Split Index. Free on the App Store.",
};

export const RECOVERY: ShowreelScript = {
  id: "Recovery",
  slug: "recovery-and-planning",
  title: "Recovery, risk and the plan",
  beats: [
    {
      vo: "Every morning, a readiness score.",
      caption: "Every morning, a *readiness* score.",
      screen: { file: DASH2, y: 400 },
      cards: [{ file: DASH2, crop: [53, 147, 1073, 460], width: 800, x: CX, y: 700, at: 12, rot: -1 }],
    },
    {
      vo: "Fatigue, recovery, and when to go hard again.",
      caption: "Fatigue, *recovery*, and when to go hard again.",
      screen: { file: DASH2, y: 1900 },
      cards: [{ file: DASH2, crop: [118, 1760, 950, 480], width: 800, x: CX, y: 700, at: 12, rot: 1 }],
    },
    {
      vo: "Injury risk from your training load, using ACWR.",
      caption: "*Injury risk* from your training load, using ACWR.",
      screen: { file: RISK, y: 1000 },
      cards: [
        { file: RISK, crop: [112, 421, 955, 300], width: 720, x: CX - 40, y: 560, at: 10, rot: -2 },
        { file: RISK, crop: [112, 1120, 955, 300], width: 720, x: CX + 40, y: 880, at: 22, rot: 1.5 },
      ],
    },
    {
      vo: "A plan for today, built around what you did yesterday.",
      caption: "A *plan* for today, built around what you did yesterday.",
      screen: { file: DASH, y: 2000 },
      cards: [{ file: DASH, crop: [53, 1886, 1073, 366], width: 800, x: CX, y: 700, at: 12, rot: -1 }],
    },
    {
      vo: "And a block that builds toward your race, lifting and running together.",
      caption: "And a block that builds toward your *race*, lifting and running together.",
      screen: { file: TARGETS, y: 900 },
      cards: [{ file: TARGETS, crop: [53, 162, 1073, 730], width: 780, x: CX, y: 720, at: 12, rot: 1 }],
    },
  ],
  outroVo: "Split Index. Free on the App Store.",
};

export const SHOWREELS: ShowreelScript[] = [ONE_SCORE, THE_LAB, THE_ENGINE, RECOVERY];
