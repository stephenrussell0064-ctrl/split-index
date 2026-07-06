/**
 * Maps DOTS / GL raw scores to the Split Index 0–1000 strength scale.
 *
 * Anchor: DOTS 400 → index 500 (competitive regional intermediate total).
 * Slope: 2.5 index points per DOTS point (linear).
 * GL uses the same anchor (GL ~400 ≈ index 500) for consistent UX when toggled.
 *
 * Reference ranges:
 *   DOTS ~250 → index ~125 (novice)
 *   DOTS ~400 → index 500 (intermediate)
 *   DOTS ~550 → index ~875 (advanced)
 *   DOTS ~600+ → index ~999 (elite, clamped)
 */

import { MAX_INDEX, MIN_INDEX } from "@/lib/scoring/constants";

export const DOTS_INDEX_ANCHOR = 400;
export const INDEX_AT_DOTS_ANCHOR = 500;
export const DOTS_TO_INDEX_SLOPE = 2.5;

export function dotsToStrengthIndex(dots: number): number {
  if (dots <= 0) return MIN_INDEX;
  const raw =
    INDEX_AT_DOTS_ANCHOR + (dots - DOTS_INDEX_ANCHOR) * DOTS_TO_INDEX_SLOPE;
  return Math.min(MAX_INDEX, Math.max(MIN_INDEX, Math.round(raw)));
}

/** GL points share the same linear mapping for UI consistency. */
export function glToStrengthIndex(glPoints: number): number {
  return dotsToStrengthIndex(glPoints);
}
