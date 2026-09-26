/**
 * Showreel scripts — the reference-ad structure.
 *
 * The reference (a 31 s golf-app ad) is: near-white stage, a black phone
 * centred, real UI cards popping OUT of the phone and stacking beside it, one
 * calm sentence per beat with a single accent word, a natural voiceover that
 * the caption follows, then app icon + "try it free", then a dark handle card.
 *
 * A script is a list of beats. Each beat has a voiceover line (the beat lasts
 * as long as the line takes to say, plus a hold), a caption (markup: *green*
 * and _blue_ accent words), what the phone shows (a screenshot at 1:1 scrolled
 * to `y`, or a recording), and optional cards cropped from real screenshots.
 *
 * Every card is a crop of an unedited screenshot — coordinates are in the
 * file's own pixels (1179×2556 for phone screenshots, 720×1560 for frames
 * pulled from recordings). Nothing is redrawn.
 */

export interface CardSpec {
  file: string;
  /** Natural pixel size of the file. Defaults to 1179×2556. */
  size?: [number, number];
  /** Crop rectangle in file pixels: x, y, w, h. */
  crop: [number, number, number, number];
  /** Rendered width in frame px. */
  width: number;
  /** Centre of the card in frame px. */
  x: number;
  y: number;
  /** Frames after the beat starts. */
  at?: number;
  /** Resting tilt in degrees. */
  rot?: number;
}

export interface Beat {
  /** Voiceover line. Spoken by the VO track; the caption follows it. */
  vo: string;
  /** On-screen caption. Words wrapped *like this* are green, _like this_ blue. Defaults to `vo`. */
  caption?: string;
  /** Screenshot inside the phone, at 1:1, with the given file-pixel y at the centre of the screen. */
  screen?: { file: string; size?: [number, number]; y?: number; yTo?: number };
  /** Or a recording inside the phone, from this second. */
  clip?: { src: string; from: number };
  cards?: CardSpec[];
  /** Fade the phone back while the cards are up (the reference ghosts the phone). Default: true when cards exist. */
  ghost?: boolean;
  /** Extra hold frames after the VO finishes. Default 14. */
  hold?: number;
}

export interface ShowreelScript {
  id: string;
  slug: string;
  title: string;
  beats: Beat[];
  /** The last line, spoken over the icon + badge. */
  outroVo: string;
}
