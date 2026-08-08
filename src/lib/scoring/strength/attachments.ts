/**
 * Cable/machine attachment picker (user feedback: "equipment/attachment
 * picker for exercises (e.g. tricep pushdown rope vs straight bar) with
 * images/descriptions, and predictions differing per attachment").
 *
 * Scoped to the small set of cable exercises where the attachment
 * genuinely changes how much weight the same true effort can move — a
 * straight bar locks the wrist and lets you move noticeably more weight
 * than a rope for the same triceps effort, so scoring both attachments
 * identically at the same logged weight would silently reward switching
 * to the "easier" attachment. Each attachment carries an `anchorMultiplier`
 * applied to the exercise's calibrated anchor ratio in scoreStrength()
 * (split-strength-engine.ts) — >1 for attachments that let you move more
 * weight for equivalent effort (so the same kg scores a little lower),
 * <1 for attachments that let you move less (so the same kg scores a
 * little higher). The baseline/most common attachment for each exercise
 * is always 1.0 — no adjustment, matching how the exercise was originally
 * calibrated.
 *
 * "Images": no photo library exists for this app and sourcing real
 * equipment photography raises licensing questions this file shouldn't
 * decide unilaterally — each attachment instead gets a distinct Lucide
 * icon (a real visual cue, not just text) plus a plain-language
 * description. Swap `icon` for a real photo/illustration asset later
 * without changing the data shape or the scoring logic.
 */
import type { ExerciseAttachmentIcon } from "./attachment-icons";

// Deliberately does NOT import from split-strength-engine.ts (resolveAnchorKey
// lives there) — that file imports resolveAttachmentMultiplier from here to
// apply it during scoring, so importing back would be circular. Callers
// (scoreStrength() itself, and UI code) resolve the exercise name to its
// anchor key first via resolveAnchorKey(), then pass that key in here.

export interface ExerciseAttachment {
  id: string;
  label: string;
  description: string;
  icon: ExerciseAttachmentIcon;
  /** Applied to the exercise's anchorRatio before scoring. 1.0 = this exercise's original calibration (no change). */
  anchorMultiplier: number;
}

/**
 * Keyed by the exercise's resolved anchor key (same identifier
 * scoreStrength() resolves free-text names to — see resolveAnchorKey).
 */
export const EXERCISE_ATTACHMENTS: Record<string, ExerciseAttachment[]> = {
  tricepPushdown: [
    {
      id: "rope",
      label: "Rope",
      description: "Full wrist rotation and range of motion — the most common, most demanding option.",
      icon: "rope",
      anchorMultiplier: 1.0,
    },
    {
      id: "straight-bar",
      label: "Straight bar",
      description: "Locked wrist position lets you move more weight for the same triceps effort.",
      icon: "straight-bar",
      anchorMultiplier: 1.12,
    },
    {
      id: "v-bar",
      label: "V-bar",
      description: "Neutral grip, shorter range of motion — between rope and straight bar.",
      icon: "v-bar",
      anchorMultiplier: 1.06,
    },
  ],
  latPulldown: [
    {
      id: "wide-bar",
      label: "Wide bar",
      description: "Wide overhand grip — the standard lat pulldown attachment.",
      icon: "wide-bar",
      anchorMultiplier: 1.0,
    },
    {
      id: "close-v-bar",
      label: "Close-grip V-bar",
      description: "Shorter, mechanically-advantaged pull that typically moves more weight.",
      icon: "v-bar",
      anchorMultiplier: 1.1,
    },
    {
      id: "single-handle",
      label: "Single handle",
      description: "One arm at a time — more stabilization demand, noticeably less weight per side.",
      icon: "single-handle",
      anchorMultiplier: 0.75,
    },
  ],
  dbRow: [
    {
      id: "v-bar",
      label: "V-bar",
      description: "Neutral, close grip — the standard cable row attachment.",
      icon: "v-bar",
      anchorMultiplier: 1.0,
    },
    {
      id: "wide-bar",
      label: "Wide bar / rope",
      description: "Wider pull, more rear-delt and upper-back involvement, typically less weight.",
      icon: "rope",
      anchorMultiplier: 0.92,
    },
    {
      id: "single-handle",
      label: "Single handle",
      description: "One arm at a time — more core/stabilization demand, less weight per side.",
      icon: "single-handle",
      anchorMultiplier: 0.65,
    },
  ],
  cableCurl: [
    {
      id: "straight-bar",
      label: "Straight bar",
      description: "The standard cable curl attachment.",
      icon: "straight-bar",
      anchorMultiplier: 1.0,
    },
    {
      id: "ez-bar",
      label: "EZ bar",
      description: "Angled grip, easier on the wrists, comparable load to a straight bar.",
      icon: "v-bar",
      anchorMultiplier: 0.95,
    },
    {
      id: "rope",
      label: "Rope",
      description: "Hammer-style neutral grip with a squeeze at the top — noticeably less weight.",
      icon: "rope",
      anchorMultiplier: 0.85,
    },
  ],
};

/**
 * Attachment options for an already-resolved anchor key (see
 * resolveAnchorKey() in split-strength-engine.ts), or null if this
 * exercise doesn't have any attachment variants.
 */
export function getAttachmentOptionsByKey(resolvedKey: string): ExerciseAttachment[] | null {
  return EXERCISE_ATTACHMENTS[resolvedKey] ?? null;
}

/** The multiplier for a given resolved key + attachment id, or 1.0 (no adjustment) if either is unrecognized. */
export function resolveAttachmentMultiplierByKey(
  resolvedKey: string,
  attachmentId: string | null | undefined
): number {
  if (!attachmentId) return 1.0;
  const options = getAttachmentOptionsByKey(resolvedKey);
  return options?.find((a) => a.id === attachmentId)?.anchorMultiplier ?? 1.0;
}
