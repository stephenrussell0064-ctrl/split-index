/**
 * Brand tokens, copied from the app — not from the brief.
 *
 *   src/app/globals.css            --strength-accent, --cardio-accent, --background, …
 *   src/lib/design/tokens.ts       cardioAccent / strengthAccent and the soft variants
 *   src/app/layout.tsx             Unbounded (display), Space Grotesk (body), Geist Mono (data)
 *   public/splitindex-logo.svg     wordmark is Unbounded 900, slash 500
 *
 * The palette is strictly: the two accents (+ their soft variants), black,
 * white, and the app's two surface tones. Nothing else appears in the film.
 */
import { loadFont as loadUnbounded } from "@remotion/google-fonts/Unbounded";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { loadFont as loadGeistMono } from "@remotion/google-fonts/GeistMono";

const unbounded = loadUnbounded("normal", { weights: ["500", "700", "900"], subsets: ["latin"] });
const grotesk = loadGrotesk("normal", { weights: ["400", "500", "700"], subsets: ["latin"] });
const mono = loadGeistMono("normal", { weights: ["500", "700"], subsets: ["latin"] });

export const FONT = {
  /** Unbounded — headlines, the score, the wordmark. */
  display: unbounded.fontFamily,
  /** Space Grotesk — body copy, captions, UI text. */
  body: grotesk.fontFamily,
  /** Geist Mono — tabular data (paces, kg, bpm). */
  mono: mono.fontFamily,
} as const;

export const C = {
  /** --strength-accent · The Lab */
  green: "#3dff6e",
  greenSoft: "#6bff96",
  /** --cardio-accent · The Engine (display/decoration only on light surfaces) */
  blue: "#3ba6ff",
  blueSoft: "#6bb8ff",
  /** --cardio-accent-text — the text-safe blue the app uses on the light Engine surface */
  blueText: "#0b6bb8",
  /** --background */
  black: "#060606",
  /** --gym-bg */
  labBg: "#070908",
  /** --cardio-bg */
  engineBg: "#f7fbff",
  /** --cardio-text */
  engineText: "#0c1a24",
  /** --foreground */
  white: "#fafafa",
  /** --muted */
  muted: "#a1a1aa",
  /** --card / --card-border */
  card: "rgba(18, 18, 18, 0.72)",
  cardBorder: "rgba(255, 255, 255, 0.08)",
  /** --accent-glow */
  greenGlow: "rgba(61, 255, 110, 0.2)",
  blueGlow: "rgba(59, 166, 255, 0.2)",
} as const;

/** rgb triplets for building rgba() strings. */
export const RGB = {
  green: "61,255,110",
  blue: "59,166,255",
  white: "250,250,250",
} as const;

/** The app's `.index-display` rule: tabular numerals, tight tracking, line-height 1. */
export const indexDisplay = {
  fontFamily: FONT.display,
  fontVariantNumeric: "tabular-nums" as const,
  letterSpacing: "-0.04em",
  lineHeight: 1,
  fontWeight: 900,
};

/** The app's `.micro-label`: 10–11px uppercase, wide tracking, muted — scaled for video. */
export const microLabel = (size = 26) => ({
  fontFamily: FONT.body,
  fontSize: size,
  fontWeight: 600,
  letterSpacing: "0.18em",
  textTransform: "uppercase" as const,
  color: C.muted,
});

/** Tier pill, as index-hero.tsx renders it: rounded-full bg-white/[0.07] uppercase tracking-wider. */
export const tierPill = (size = 28) => ({
  fontFamily: FONT.body,
  fontSize: size,
  fontWeight: 700,
  letterSpacing: "0.12em",
  textTransform: "uppercase" as const,
  color: "rgba(250,250,250,0.85)",
  background: "rgba(255,255,255,0.07)",
  borderRadius: 999,
  padding: `${Math.round(size * 0.3)}px ${Math.round(size * 0.7)}px`,
});
