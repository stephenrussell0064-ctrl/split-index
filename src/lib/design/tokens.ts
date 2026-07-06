/**
 * Design tokens — premium restrained aesthetic for Split Index.
 * Consumed by globals.css (CSS vars) and TS components (typed references).
 */

export const designTokens = {
  /** Cardio / endurance accent — slate-cyan */
  cardioAccent: "#0e7490",
  cardioAccentSoft: "#0891b2",
  /** Strength / gym accent — muted violet */
  strengthAccent: "#7c3aed",
  strengthAccentSoft: "#8b5cf6",
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
  /** Display typography — large index numbers (Geist via layout) */
  fontDisplay: "var(--font-geist-sans)",
  /** Data / table typography — tabular figures */
  fontData: "var(--font-geist-mono)",
} as const;

export type DesignToken = typeof designTokens;
