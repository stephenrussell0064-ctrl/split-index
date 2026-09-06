/**
 * Design tokens — premium restrained aesthetic for Split Index.
 * Consumed by globals.css (CSS vars) and TS components (typed references).
 */

export const designTokens = {
  /** Cardio / endurance accent — sky blue. Display and decoration only; see below. */
  cardioAccent: "#3BA6FF",
  cardioAccentSoft: "#6BB8FF",
  /**
   * The Engine blue, tuned for the jobs WCAG has thresholds for.
   *
   * `cardioAccent` measures 2.50:1 against the cardio background, which fails
   * the 4.5:1 text threshold AND the 3:1 non-text one — so it fails as an icon
   * and a border as well as as a word. These are the same hue and saturation
   * walked down in lightness until they clear, with headroom.
   *
   * Use `cardioAccentText` for anything read, `cardioAccentStrong` for anything
   * that carries meaning without being read, and `cardioAccent` only where no
   * threshold applies: large display numerals, fills, glows.
   */
  cardioAccentText: "#006AC2",
  cardioAccentStrong: "#0086F6",
  /** Strength / gym accent — neon green on black */
  strengthAccent: "#3DFF6E",
  strengthAccentSoft: "#6BFF96",
  /** Neutral slate scale for data surfaces */
  slate: {
    50: "#f8fafc",
    100: "#f1f5f9",
    200: "#e2e8f0",
    300: "#cbd5e1",
    400: "#94a3b8",
    500: "#64748b",
    600: "#475569",
    700: "#334155",
    800: "#1e293b",
    900: "#0f172a",
    950: "#09090b",
  },
  /** Display typography — headlines & index numbers */
  fontDisplay: "var(--font-display)",
  /** Data / table typography — tabular figures */
  fontData: "var(--font-geist-mono)",
} as const;

export type DesignToken = typeof designTokens;
