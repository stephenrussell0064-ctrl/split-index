/**
 * Every timing in the film, in one place.
 *
 * The edit is beat-synced. At 30 fps and 120 BPM one beat is exactly 15
 * frames, so every cut lands on an integer frame and a track laid over the
 * top in TikTok at 120 (or 60 / 240) BPM will sit on the cuts.
 *
 * All scene boundaries below are expressed in beats, then converted to frames
 * once. Change BPM and everything re-times itself.
 */

export const FPS = 30;
export const WIDTH = 1080;
export const HEIGHT = 1920;

export const BPM = 120;
/** Frames per beat — 15 at 30 fps / 120 BPM. */
export const BEAT = Math.round((FPS * 60) / BPM);
export const beat = (n: number) => n * BEAT;
export const sec = (s: number) => Math.round(s * FPS);

/** Total length: 44 beats = 22.0 s. */
export const TOTAL_BEATS = 44;
export const DURATION = beat(TOTAL_BEATS);

/**
 * Beat map. Each entry is where a scene STARTS, in beats. The prompt's
 * structure, quantised to the grid:
 *
 *   HOOK     0.0 – 1.5 s    beats  0 – 3
 *   TENSION  1.5 – 4.0 s    beats  3 – 8
 *   REVEAL   4.0 – 9.0 s    beats  8 – 18
 *   USP      9.0 – 14.0 s   beats 18 – 28
 *   STATUS  14.0 – 18.0 s   beats 28 – 36
 *   CTA     18.0 – 21.0 s   beats 36 – 42
 *   LOOP    21.0 – 22.0 s   beats 42 – 44
 */
export const SCENES = {
  hook: { from: beat(0), to: beat(3) },
  tension: { from: beat(3), to: beat(8) },
  reveal: { from: beat(8), to: beat(18) },
  usp: { from: beat(18), to: beat(28) },
  status: { from: beat(28), to: beat(36) },
  cta: { from: beat(36), to: beat(42) },
  loop: { from: beat(42), to: beat(44) },
} as const;

export const dur = (s: { from: number; to: number }) => s.to - s.from;

/** Sub-beats inside the REVEAL scene (relative to its start). */
export const REVEAL = {
  phoneIn: 0, // phone flies in, 3D tilt settles
  setLogged: beat(1), // the bench set appears in the log
  saveTap: beat(2) + 6, // "Save" press, riser starts
  countStart: beat(3), // odometer 0 → score
  countEnd: beat(7),
  badgeSlam: beat(7) + 4, // tier badge, shake, flash
  subScores: beat(8), // Engine / Lab sub-scores fade up
} as const;

/** Sub-beats inside the USP scene. */
export const USP = {
  radarOpen: 0,
  headline: beat(2), // −x.x% and +y bpm land
  typeStart: beat(2) + 8,
  typeEnd: beat(8),
} as const;

/** Sub-beats inside the STATUS scene. */
export const STATUS = {
  scrollStart: 0,
  scrollEnd: beat(3),
  climbStart: beat(3),
  climbEnd: beat(6),
  hold: beat(6),
} as const;

/** Sub-beats inside the CTA scene. */
export const CTA = {
  question: 0,
  badge: beat(2),
  free: beat(3),
} as const;

/** Whip / flash transitions: 3 frames of flash centred on each scene cut. */
export const FLASH_FRAMES = 3;
export const WHIP_FRAMES = 6;

/**
 * TikTok safe zone (1080×1920). Nothing that must be read goes outside this
 * rectangle: the caption, username and music line cover the bottom; the
 * action rail covers the right edge; the top carries the status bar and the
 * Following / For You tabs.
 */
export const SAFE = {
  top: 160,
  bottom: 420,
  right: 140,
  left: 40,
} as const;
export const SAFE_RECT = {
  x: SAFE.left,
  y: SAFE.top,
  w: WIDTH - SAFE.left - SAFE.right,
  h: HEIGHT - SAFE.top - SAFE.bottom,
} as const;

/** The 7–9 s cut-down: hook → reveal → CTA. 8.0 s. */
export const SHORT = {
  hook: { from: 0, to: beat(3) },
  reveal: { from: beat(3), to: beat(12) },
  cta: { from: beat(12), to: beat(16) },
  duration: beat(16),
} as const;
