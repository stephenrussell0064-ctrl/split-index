/**
 * The count-up curve, shared by the odometer (what you see) and the SFX track
 * (the digit ticks you hear), so they cannot drift apart.
 *
 * Pure: `spring()` from remotion is a pure function of its inputs.
 */
import { spring } from "remotion";
import { FPS, REVEAL } from "./timing";

export const COUNT_FRAMES = REVEAL.countEnd - REVEAL.countStart;

/** Speed ramp into the reveal: a heavily damped spring that arrives with a soft overshoot. */
export const countProgress = (frameSinceStart: number): number => {
  if (frameSinceStart <= 0) return 0;
  return spring({
    frame: frameSinceStart,
    fps: FPS,
    config: { damping: 26, stiffness: 38, mass: 1.2 },
    durationInFrames: COUNT_FRAMES,
  });
};

/** Displayed value (0–100 scale) at a frame since count start. */
export const scoreAt = (frameSinceStart: number, target: number): number => target * countProgress(frameSinceStart);

/**
 * Frames (since count start) at which the ONES digit changes — one tick each,
 * never closer than `minGap` frames so the ticks stay a rhythm, not a buzz.
 */
export const tickFrames = (target: number, minGap = 2): number[] => {
  const out: number[] = [];
  let lastDigit = -1;
  let lastTick = -Infinity;
  for (let f = 0; f <= COUNT_FRAMES; f++) {
    const d = Math.floor(scoreAt(f, target));
    if (d !== lastDigit && f - lastTick >= minGap) {
      out.push(f);
      lastTick = f;
    }
    lastDigit = d;
  }
  return out;
};
