/**
 * A UGC video is a script, not a composition. Each content gap from TikTok's
 * Creator Search Insights becomes one file in src/ugc/scripts/ that fills
 * this shape; `Ugc.tsx` renders any of them the same way.
 *
 * The look is deliberately un-produced: TikTok's own caption style (heavy
 * sans, white, black outline), lowercase, handheld drift, the app's real
 * screens behind the words. No grade, no bloom, no whip transitions.
 */

export type UgcBeat =
  /** One caption, popped word by word, over a blurred real-app background. */
  | { kind: "say"; text: string; seconds: number; bg?: string; bgFrom?: number }
  /** A numbered/checked list that reveals one item at a time. */
  | { kind: "list"; title: string; items: string[]; seconds: number; bg?: string; bgFrom?: number }
  /** The real app, sharp, full-bleed, with a caption. Recording or screenshot. */
  | { kind: "app"; clip?: string; from?: number; screen?: string; focusY?: number; zoom?: number; /** px to push the footage down (recordings are cropped ~210px top and bottom to fit 9:16). */ shiftY?: number; text: string; seconds: number }
  /** Soft close: wordmark, badge, one line. */
  | { kind: "cta"; text: string; seconds: number };

export interface UgcScript {
  id: string;
  slug: string;
  /** The Creator Search Insights phrase this video is written for. It must appear in the hook and the caption. */
  searchPhrase: string;
  /** Why this gap was picked — printed in the posting kit. */
  rationale: string;
  beats: UgcBeat[];
  /** Posting kit. */
  caption: string;
  hashtags: string[];
  pinnedComment: string;
  /** On-screen disclaimer in the last beat. */
  disclaimer?: string;
}

export const ugcDuration = (s: UgcScript, fps: number) => s.beats.reduce((n, b) => n + Math.round(b.seconds * fps), 0);
